# Noxara Launcher — Production Audit Report

Date: 2026-08-17
Scope: `src/main` (Electron main), `src/renderer` (React renderer), `native/rust` (noxara-core sidecar), shared IPC contract.
Outcome: **6 fixes applied**, all verification suites green (`cargo test`, `tsc` typecheck, `vitest`, `eslint`, production builds for renderer/main/rust).

---

## 1. Priority issue — random Minecraft/launcher crashes a few minutes after launch

Root cause is a **backpressure deadlock + IPC/renderer saturation chain** triggered by
log-flooding games and modpacks, plus two correctness bugs that made exits misreport as
crashes or never get reported at all.

### 1a. Stdio backpressure deadlock (core) — FIXED

`native/rust/src/protocol.rs:89` `write_event` uses a blocking `println!` to the core's
stdout. The game-output reader tasks in `native/rust/src/launch.rs` called it **per line**,
unthrottled. Chain of failure:

1. A verbose mod / crash loop emits thousands of lines/sec.
2. The core writes a JSON line per line to stdout. If the Electron main process is even
   momentarily slow to consume it, the pipe fills and `println!` **blocks a tokio worker
   thread**.
3. That stalls the core's JVM-reader tasks, which stops draining Minecraft's
   stdout/stderr pipes.
4. The JVM blocks on its own stdout write → the game freezes/hangs → looks like a random
   crash a few minutes in.

**Fix** (`native/rust/src/launch.rs`): game output is now pushed into a shared bounded
queue (`GAME_OUTPUT_QUEUE_CAP = 5000`, drop-oldest so the crash tail survives) and emitted
by a single rate-limited forwarder (`GAME_OUTPUT_FLUSH_MS = 50`, `GAME_OUTPUT_MAX_PER_FLUSH = 400`).
The JVM's pipes are always drained eagerly (cheap, non-blocking mutex pushes), the game
never stalls, the core's own stdout writes are bounded, and memory stays bounded.

### 1b. IPC + renderer saturation (main + renderer) — FIXED

Even with 1a bounded, `src/main/ipc/handlers.ts` forwarded every line as its own
`webContents.send`, and `src/renderer/stores/useLaunchStore.ts` `appendLog` did a zustand
`set()` per line (copying a 2000-entry array each time). A chatty game pushed thousands of
IPC messages and React re-renders per second → renderer freeze / OOM / "launcher crashed".

**Fixes:**
- `src/main/ipc/handlers.ts`: `game.output` events are coalesced and delivered as a single
  `eventGameOutputBatch` message at most every 100 ms or once 500 lines accumulate
  (`flushGameOutput`). The pending batch is flushed **before** the `game.exit` forward so
  crash analysis always sees the complete log tail.
- `src/renderer/stores/useLaunchStore.ts`: new `appendLogs(batch)` performs **one** zustand
  set per batch (cap now exactly `MAX_LOG_LINES = 2000`).
- `src/renderer/App.tsx`: subscribes to `onGameOutputBatch`, marks an instance running once
  per unique instance per batch.
- New IPC contract: `eventGameOutputBatch` + `onGameOutputBatch` in `src/shared/types/ipc.ts`,
  `src/main/preload.ts`, `src/renderer/types/global.d.ts`.

### 1c. Exit-code race → false "crashed" banner — FIXED

`native/rust/src/launch.rs` `running_instances()` used `reg.retain(...)` to **remove** exited
children from the registry. The renderer polls `launch.running` every ~4 s; if that poll
observed the exit before `launch_and_stream`'s waiter did, the waiter's `get_mut` returned
`None` → `status = None` → `crashed: true` even for a normal exit. A normal quit looked
like a crash.

**Fix**: `running_instances()` now only *reports* (via `iter_mut` + `try_wait`) and never
removes; the waiter is the sole owner of registry removal after observing the true exit
code. The reaping is idempotent, so the waiter still gets the real `status.code()`.

### 1d. `game.exit` never fires when a grandchild holds the pipes — FIXED

`launch_and_stream` awaited `out_task`/`err_task` to EOF **after** the process exited. If a
grandchild (e.g. a Forge server process or an orphaned helper) inherited the stdout/stderr
handles, EOF never arrived → `game.exit` never emitted → launcher stuck on "running", the
`runningGames` counter, activity, and presence sessions leaked, and the close-on-launch quit
never happened.

**Fix**: after the exit status is observed, reader and forwarder tasks are awaited under a
`5 s` bound (`tokio::time::timeout`); `game.exit` is always emitted on time, and buffered
lines flushed first so the crash tail is preserved.

### 1e. Over-aggressive RAM cap — FIXED

`src/main/services/instances.ts` allowed `-Xmx` up to **90% of system RAM**. On 8–16 GB
machines a heap that large starved the OS + launcher + Discord of memory → OOM /
instability a few minutes into a session. New policy (`src/shared/ram.ts`): the JVM gets at
most 75% of total RAM, and never more than total − 2 GB. Enforced in both create and update
validation, and mirrored in the renderer's `MemoryEditor` (`src/renderer/pages/InstanceDetailPage.tsx`)
via the same shared helper so the UI and backend can never disagree.

---

## 2. Default skin is now fully white — FIXED

`src/renderer/components/skin-viewer/playerModel.ts` `makeDefaultSkinCanvas()` generated a
Steve-like skin. It now produces a fully opaque 64×64 white canvas, which is the only
default-skin path (used by `createDefaultTexture` when no account/stored skin exists, for
every account type). Real user skins are unaffected.

---

## 3. Things audited and verified safe

- **No shell is ever invoked** for Java; args are `Vec<String>` → `Command` directly
  (`native/rust/src/launch.rs`). Path validation is constrained to the instance root
  (`src/main/filesystem/paths.ts` `assertWithin`).
- **Tokens are never logged**: `redact()` scrubs the access token from every console line
  before it reaches events/logs (`native/rust/src/launch.rs:424`); `src/main/services/logger.ts`
  scrubs `token`/`password`/`secret` keys; Microsoft tokens live only in keytar
  (`NoxaraLauncher` service, `src/main/services/accounts.ts`).
- **IPC surface is narrow**: only `src/main/preload.ts` exposes a typed `contextBridge` API;
  no raw `ipcRenderer`/Node globals reach the renderer; `openExternal` validates the host is
  a Microsoft domain (`src/main/ipc/handlers.ts`).
- **Sidecar lifecycle**: 2 MB line caps on both the request and response sides
  (`core-bridge.ts`, `main.rs` `read_line_bounded`), settled-flag on pending calls, timeout
  sweep — no orphaned pending entries.
- **Downloads** are SHA-1 verified with `.part` staging and cancellation propagation
  (`native/rust/src/downloads.rs`).
- **Discord RPC** (`src/main/services/discord-rpc.ts`) is env-gated, never throws, and uses
  capped exponential backoff; presence sessions are keyed off `game.started`/`game.exit`
  and now always clean up thanks to fix 1d.
- **Instance deletion** refuses to delete a running instance and only removes paths under the
  known instances root (`src/main/services/instances.ts`).

## 4. Low-priority observations (not changed)

- `onGameOutput` / `eventGameOutput` remain in the API but are no longer emitted by main
  (superseded by the batch channel). Harmless; could be removed in a future cleanup.
- A couple of `@typescript-eslint/no-explicit-any` warnings exist in loader/launch services
  (pre-existing, cosmetic).
- `playerModel.ts` `loadIdRef` cleanup warnings in `SkinViewer.tsx` are pre-existing React
  lint suggestions, not bugs.

## 5. Verification

- `cargo test` (native/rust): **18 passed**.
- `npm run test` (vitest): **112 passed** across 15 files.
- `npm run typecheck`: clean (main + renderer tsconfigs).
- `npm run lint`: **0 errors** (only pre-existing warnings).
- `npm run build:renderer` / `build:main` / `build:rust`: all succeed.