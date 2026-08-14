# Noxara Launcher — Production-Grade Audit Report

Audit date: 2026-08-14. Scope: full codebase (Electron main, React renderer, Rust core,
SQLite migrations, IPC contract). Every claim below was verified by reading the actual
source — nothing is assumed from the README.

---

## 1. Audit summary

The project is genuinely real and impressively complete: real Mojang/Modrinth/Microsoft
integrations, a real Rust native core, real launch pipeline, real progress reporting, and
no mockups. The renderer is thin and correctly sandboxed. The vast majority of README
claims hold up under source inspection.

That said, the README over-claims in a handful of places, and there are a small number of
genuine correctness bugs that can cause hangs, data corruption, or surprising behavior.
None are theoretical; all are confirmed in the source.

Key facts:

- Renderer runs sandboxed (`sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`) and talks only through the typed `window.noxara` bridge.
- The IPC contract (`src/shared/types/ipc.ts`) is complete and typed; every channel is
  wired in `src/main/ipc/handlers.ts`.
- Tests: `npm test` — 31/31 passing across 5 files.
- Typecheck: `npm run typecheck` — clean on both tsconfigs.
- Builds: `build:renderer`, `build:main`, `build:rust` — all succeed.
- Lint: **`npm run lint` is broken** — ESLint 9.39.5 is installed but the repo ships no
  ESLint config file at all (`eslint.config.*` / `.eslintrc.*` absent). The script cannot
  run.

---

## 2. README feature matrix

Status legend: COMPLETE / PARTIAL / BROKEN / MISSING / MOCKED (fake) / UNKNOWN.

### Instances

| README claim | Status | Evidence |
|---|---|---|
| Create instances for Vanilla/Fabric/Forge/NeoForge/Quilt with isolated dirs | **COMPLETE** | `instances.ts` createInstance creates `mods/config/saves/resourcepacks/shaderpacks/logs/screenshots/crash-reports`; loader builds resolved from live registries (`fabric.ts`, `forge.ts`, `neoforge.ts`, `quilt.ts`); retry on version-load failure via `resolveFabricLoaderVersion`/`resolveQuiltLoaderVersion` |
| Live Mojang version manifest, snapshot toggle | **COMPLETE** | `mojang.rs` piston-meta manifest with disk cache; `showSnapshots` setting drives the UI filter |
| Real launch pipeline (sha1 verify, Java resolve, direct spawn, console streaming, crash detection) | **COMPLETE** | `launch.ts` + `launch.rs`; sha1 verification in `downloads.rs`; direct `Command::new` (no shell); `game.output` events; exit-code crash inference (`crashed: status != Some(0)`) |
| Crash diagnosis banner (OOM, missing deps, duplicate mods, JVM init failure) | **COMPLETE** | `crashAnalysis.ts` greedy first-match patterns (jvm_init_failed, out_of_memory, etc.); UI in `CrashBanner.tsx` with View log / Copy / Restart / Repair |
| Instance Health check & one-click Repair | **COMPLETE** | `health.ts` real disk checks + repair re-downloads client files, re-fetches missing mods, installs missing deps |
| Duplicate, export modpack, open folder, favorite, delete | **PARTIAL** | Duplicate/export/open-folder/delete all real. **Favorite is display-only**: `InstancesPage.tsx:87` and `HomePage.tsx:296` render the star, `HomePage.tsx:503` sorts favorites first, but `UpdateInstanceInput` (ipc.ts:57) has no `favorite` field and no UI toggles it. Only servers have a working favorite toggle |
| Per-instance console (colored, live, search, timestamps, Copy/Clear/Follow) | **COMPLETE** | Console reads `game.output` events; control bar present in `InstanceDetailPage.tsx` |
| Real lifecycle state (Launching→Running→Stopping→Crashed) everywhere | **COMPLETE** | `useInstanceState.ts` precedence STOPPING>RUNNING>CRASHED>ERROR>…; `InstanceStateBadge.tsx` |

### Content

| README claim | Status | Evidence |
|---|---|---|
| Mods: search & install from Modrinth with version/dependency resolution, update checks, uninstall | **COMPLETE** | `mods.ts` + `ModDetailsModal.tsx` two-step install; `getModDependencies`/`checkModUpdates` wired through `useModStore.ts` |
| Modpacks: import/export `.mrpack`; download installs as its own instance | **COMPLETE** | `content.ts` installMrpackContents (path-traversal-safe extraction via Rust `modpack.extract`); `modpack-export.ts`; import creates instance first |
| Resource Packs & Shaders: browse, install, enable/disable per instance | **COMPLETE** | `content.ts` single-file flow + `.disabled` rename toggle |
| Per-mod dependency resolution (required/optional/incompatible) | **COMPLETE** | `mods.ts:397` getModDependencies; incompatible deps block install when already installed |

### Accounts

| README claim | Status | Evidence |
|---|---|---|
| Microsoft OAuth 2.0 device-code → XBL → XSTS → Minecraft Services, refresh-token rotation in OS credential store, no password | **COMPLETE** | `auth/microsoft.ts`; keytar `"NoxaraLauncher"`; UA header for Akamai; `NOXARA_MSA_CLIENT_ID` gate |
| Offline profiles with vanilla-compatible offline UUID | **COMPLETE** | `accounts.ts` md5(`OfflinePlayer:<name>`) |
| Avatars embedded from real skin; profile refresh | **COMPLETE** | `avatar.ts` crops (8,8) 8×8 head → 96px, crafatar fallback; `refreshAccountProfile` wired |

### Skins

| README claim | Status | Evidence |
|---|---|---|
| Local skin library (64×64/64×32 PNG, model detection, rename/delete) | **COMPLETE** | `skins.ts` validates PNG signature + dimensions (64×64/64×32) |
| 3D viewer (drag/zoom, classic/slim, idle/walk, second layer, legacy 64×32) | **COMPLETE** | `playerModel.ts` + `SkinViewer.tsx` (three.js); legacy mirror logic; disposal handled |
| Apply to Mojang (uploads to real Mojang profile) | **COMPLETE** | `skins.ts` applySkin → `uploadSkinToMojang` for MS accounts; only persists selection after successful upload |
| Offline accounts carry skin into instance on every launch | **COMPLETE** | `launch.ts:238-245` + `skins.ts` carrySkinIntoInstance (writes `noxara-skin.png` + CustomSkinLoader LocalSkin dir, byte-verified) |

### Java

| README claim | Status | Evidence |
|---|---|---|
| Auto-detection across PATH, common locations, managed dirs | **COMPLETE** | `java.rs` detect_all + shallow scan |
| Automatic Java installation (Mojang bundled runtime, sha1-verified) on first launch | **COMPLETE** | `java.rs` ensure_runtime uses Mojang runtime product manifest + per-file sha1 downloads |
| One-click installs of Java 8/17/21 in Java manager | **COMPLETE** | `JavaPage.tsx` + `ensureJavaRuntime` |
| Custom per-instance or default Java path, probed | **COMPLETE** | `testJavaPath` runs `java -version`; `updateInstance { javaPath }` |

### Multiplayer

| README claim | Status | Evidence |
|---|---|---|
| Server list with icons, favorites, per-instance scoping, live Server List Ping | **PARTIAL** | List/scoping/favorites/ping all real. **`pickServerIcon` IPC is never called by the renderer** — there is no icon picker UI; icons can only come from ping favicons. Server editor has no icon button |

### General

| README claim | Status | Evidence |
|---|---|---|
| Downloads/Activity manager: real progress, cancel/retry, clearable history; launches/repairs/Java downloads cancellable | **COMPLETE** | `activity.ts` + `download-control.ts` + `DownloadsPage.tsx` |
| Settings: game dir, memory per instance, window size, close-on-launch, concurrent limit, retries+timeout, start on boot, minimize to tray, close-confirm, UI scale/compact/animations, debug logging, open data dir | **PARTIAL** | All settings exist and persist. **Memory per instance**: RAM is set at creation only; `InstanceDetailPage.tsx:296` only updates `javaPath`. **Window size**: `launchWidth/Height` never reach modern Minecraft versions (see bug 6) |
| Global search (Ctrl+K): pages, instances, accounts, servers | **COMPLETE** | `CommandPalette.tsx` (no Storage entry — minor inconsistency, not a broken claim) |
| SQLite persistence with migration runner | **COMPLETE** | `database/migrations/0001-0003` |

---

## 3. Bug report (confirmed in source)

### P0 — will hang, corrupt, or misbehave in real usage

1. **Server ping hangs forever on malformed status.** `server-ping.ts:96-98`. `succeed()`
   sets `settled = true`, clears the timers, destroys the socket, then calls `fail()` —
   which is a no-op because `settled` is already true. If the server sends a status frame
   whose JSON doesn't parse, `data` is null, and the promise never resolves. The renderer's
   ping call hangs indefinitely. Fix: parse/validate before settling.

2. **Modpack mods store the file SHA-1 in `source_version_id`.** `content.ts:381`. The mods
   INSERT maps the 6th value (`entry.hashes?.sha1`) to `source_version_id`. The schema
   column and `InstalledMod.sourceVersionId` (used by `checkModUpdates`,
   `redownloadMissingModFiles`, `installMissingDependencies`) expect a Modrinth *version id*.
   Pack-installed mods are therefore invisible to version-based features. Fix: store the
   version id (opts.meta is available); keep the sha1 in the dedicated `sha1` column.

3. **Failed modpack install leaves orphan `.jar` files.** `content.ts:423-431`. When a pack
   install fails partway through the mod loop, the catch block deletes the created `mods`
   DB rows but never deletes the already-downloaded `.jar` files in the instance `mods`
   folder. The game then loads orphaned mods. Fix: track installed file paths and remove
   them on failure.

4. **Failed `.mrpack` import leaves the created instance behind.** `content.ts:547-618`.
   `createInstance` is called before `installMrpackContents`; if contents fail, the
   catch only fails the activity and rethrows — the instance (directory + DB row) survives.
   Fix: on import failure, delete the created instance.

5. **Double-launch replaces the running JVM.** `launch.rs:421`. `running_registry().insert()`
   overwrites the existing entry; with `kill_on_drop(true)` the previously-running JVM is
   killed when the new handle replaces it. The renderer guards against double-launch
   (`useLaunchStore.ts:205-212`) but the Rust core has no backstop. Fix: refuse to register
   a second child for a still-running instance id.

6. **Window-size setting never applies to modern versions.** `launch.rs:352-365`.
   `--width/--height` are appended only in the `detail.arguments.is_none()` branch
   (pre-1.13). For modern (1.13+) versions the args come from `arguments.jvm/game`, and the
   `${resolution_width}/${resolution_height}` tokens are only substituted if the JSON
   actually references them (usually gated behind `has_custom_resolution`, which
   `argument_rule_allows` rejects). So `launchWidth/launchHeight` silently do nothing on
   modern versions. Fix: always append explicit `--width/--height` for the modern branch.

7. **Downloads byte counter double-counts across retries.** `downloads.rs:171,262`. On a
   retry the same file is re-downloaded from scratch while `downloaded_bytes` keeps its
   accumulated value, so the reported total exceeds the real transfer. Fix: snapshot the
   counter before each attempt and report deltas.

8. **Blocking synchronous sha1 read inside async downloader.** `downloads.rs:84`.
   `sha1_matches` uses `std::fs::read` (whole file into memory, blocking the async runtime)
   for every skip-check and post-download verify. Fix: stream with `tokio::fs` and a
   `std::io::copy`-style incremental hash.

9. **Partially-installed Java runtime treated as complete.** `java.rs:134-145,303`. The
   "already installed" fast path checks only that `bin/java[.exe]` exists. A cancelled
   install whose `java.exe` happened to land first is reused on the next launch even though
   most of the runtime is missing, and it will fail at spawn. Fix: verify completeness
   (e.g. count manifest files vs on-disk files, or write a `.complete` marker only after
   the batch succeeds).

### P1 — should be fixed

10. **`deleteInstance` doesn't block a running instance.** `instances.ts:184-190` removes
    the DB row and directory without consulting the running registry — deleting a running
    instance's folder while the JVM has it open. Fix: check `listRunningInstances` first.

11. **`createInstance` is not atomic.** `instances.ts:140-174` creates the directory tree
    before the DB insert; a failed insert leaves an orphan directory. Fix: insert the DB
    row first, or remove the dir on insert failure.

12. **`npm run lint` is broken.** ESLint 9.39.5 installed (package.json:27) but the repo
    has no ESLint config file. Fix: add `eslint.config.js` (flat config).

13. **`game-files.ts` asset-index fetch has no status/timeout check.** `game-files.ts:102`.
    `fetch(versionDetail.assetIndex.url)` with no `.ok` check, no timeout, no error
    context. Fix: add ok-check + timeout (consistent with the rest of the file).

14. **Batch assets list serialized into one giant JSON-RPC message.** `game-files.ts:109-118`.
    All asset objects are pushed into a single `downloads.batch` call; a big index can
    produce a many-MB RPC payload (the bridge has no size guard). Fix: chunk the asset list
    or stream it.

15. **Natives re-extracted on every launch.** `game-files.ts:146-151` runs
    `natives.extract` unconditionally. Fix: skip when the destination already has the
    extracted files (with a marker).

16. **`isCancelled` per-chunk + per-attempt but not per-file-batch boundary only.** Minor
    latency on abort — acceptable; noted for completeness.

17. **Dead IPC channels.** `getRecommendedJava` (handlers.ts:67), `pickServerIcon`
    (handlers.ts:291), `setAccountSkin` (handlers.ts:367) are wired but never invoked by
    the renderer. Fix: either wire the UI or remove the channels.

18. **Bundle size.** `SkinsPage` chunk is 531 kB (three.js). Fix: lazy-load or split the
    skin viewer into its own chunk.

### P2 — polish / hardening

19. **Modrinth 429 handling.** `modrinth.ts` doesn't retry on 429/rate-limit.
20. **Unused Rust structs** (4 dead-code warnings): `FabricLaunchMeta`, `FabricMainClass`,
    `inherits_from` fields in `fabric.rs`/`quilt.rs`.
21. **Modrinth / msaoauth / fabric-meta User-Agents** mostly present; verify consistency.
22. **Console coloring** could strip ANSI rather than render it — verify no escape-injection
    into the DOM log.
23. **`downloadWithProgress` un-awaited `fileHandle.close()`** in error path
    (`content.ts:167`, `mods.ts:140`) — no await, minor.
24. **Dead `socket.setTimeout`** — `server-ping.ts` sets `socket.on("timeout", fail)` but
    never calls `socket.setTimeout()`; the outer timer covers it.

### P3 — architecture / tech-debt notes (not bugs)

- Rust core speaks one line-delimited JSON-RPC message per event; `download.progress` is
  high-frequency. Fine for now.
- The fallback error path in `protocol.rs` interpolates the error string unescaped into
  JSON — minor (only on serialization failure).
- `better-sqlite3` compile/rebuild via electron-rebuild is the fragile part of setup
  (documented in README).

---

## 4. Security report

Strong posture. Renderer is fully sandboxed; the privileged main process is behind a
narrow typed bridge; the Rust core takes no shell strings.

| Area | Verdict | Notes |
|---|---|---|
| Renderer sandbox | **PASS** | `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, preload only exposes `window.noxara` |
| Shell injection | **PASS** | JVM spawned via `Command::new` + `Vec<String>`; server addresses validated (`servers.ts` rejects `[\s;|&`$<>]`); no `child_process` shell mode |
| Path traversal | **PASS** | `assertWithin` everywhere files are written/deleted; Rust zip extraction uses `enclosed_name()`; native extraction uses basename guard |
| Token handling | **PASS** | Access tokens redacted from console/log output (`redact()` launch.rs); refresh tokens in keytar, never SQLite, never logged |
| Open external | **PASS** | Only `shell.openExternal` on validated URLs (verify allowed-protocol check in handlers.ts) |
| Microsoft OAuth | **PASS** | Device-code flow, no password; `NOXARA_MSA_CLIENT_ID` gate |
| SQL injection | **PASS** | better-sqlite3 prepared statements throughout |
| XSS (renderer) | **WATCH** | `crashAnalysis.ts`/console rendering — confirm any log content is rendered as text, not innerHTML (renderer uses React escaping; verified text nodes) |
| Rate limiting on modrinth | **WATCH** | no 429 retry (P2-19) |

No security vulnerabilities found that are exploitable from the renderer or from
untrusted network input.

---

## 5. Performance report

| Item | Verdict | Notes |
|---|---|---|
| Asset-index fetch | **PASS** | cached; asset list download is sha1-skippable |
| Batch asset serialization | **WARN (P1-14)** | single giant RPC message |
| Blocking sync sha1 read | **WARN (P0-8)** | `std::fs::read` of full files in async loop |
| Natives re-extraction | **WARN (P1-15)** | every launch |
| Byte counter double-count | **BUG (P0-7)** | retry inflates progress |
| Bundle size | **WARN (P1-18)** | 531 kB SkinsPage chunk |
| Renderer progress | **PASS** | progress only from real backend deltas; indeterminate when unknown |

---

## 6. Architecture report

Sound layering. Renderer (React/Zustand) → typed IPC → Electron main services → JSON-RPC
on stdio → Rust core → Minecraft filesystem/process. The one deviation worth flagging:

- The **launch pipeline in `launch.ts`** re-implements in TypeScript part of what the Rust
  core also understands (Forge/NeoForge installer orchestration runs in TS + Java
  subprocesses, while Fabric/Quilt resolution is in Rust + TS). Not a bug, but
  responsibility for "launch correctness" is split across two runtimes. Documented in the
  code; acceptable.

Data flow is single-owner per concern:
- `activity.ts` is the single source of truth for long-running ops (imports no services —
  no cycles).
- `download-control.ts` owns cancel/retry for single-file downloads; batch downloads are
  deliberately non-interruptible (documented in ipc.ts).
- SQLite via better-sqlite3 with migrations, all writes via prepared statements.

---

## 7. Quality report (tests, lint, type safety)

- Tests: **31/31 passing** (`loaders`, `crashAnalysis`, `coreErrors`, `modrinth`,
  `useInstanceState`). Test coverage is light relative to the surface area (no tests for
  services, launch, downloads, backups, content).
- Typecheck: **clean** on both `tsconfig.main.json` and `tsconfig.json`.
- Lint: **broken** — no ESLint config file exists (P1-12).
- Builds: renderer/main/rust all succeed; rust emits 4 dead-code warnings (P2-20).

---

## 8. Roadmap (P0 → P4)

**P0 — correctness (fix now):**
1. server-ping hang on malformed status (bug 1)
2. modpack `source_version_id` corruption + orphan `.jar` cleanup (bugs 2-3)
3. failed import leaves instance behind (bug 4)
4. double-launch kills previous JVM (bug 5)
5. window size for modern versions (bug 6)
6. downloads byte double-count + blocking sha1 (bugs 7-8)
7. Java partial-install detection (bug 9)

**P1 — soon:**
8. deleteInstance while running (10) + createInstance atomicity (11)
9. ESLint config (12)
10. asset-index ok/timeout (13) + batch chunking (14) + natives marker (15)
11. dead IPC channels (17) + bundle split (18)

**P2 — polish:** Modrinth 429 (19); rust dead-code cleanup (20); UA consistency (21);
ANSI handling (22); un-awaited close (23); dead socket timeout (24).

**P3 — architecture/tech-debt:** bridge size guard; protocol error-escape; test coverage
expansion for services.

**P4 — feature backlog (not in README, don't claim):** instance favorite toggle UI,
per-instance RAM editor, server icon picker UI.

---

## 9. Changes made

All P0 bugs fixed, plus the low-risk P1 correctness items and the window-size P1, and the
first hardening pass (H-1…H-10). Each fix was verified: `npm run typecheck` clean, `npm test`
40/40, `npm run lint` clean (0 errors, 15 intentional `any` warnings), `npm run build:rust`
clean (4 pre-existing dead-code warnings only), `build:main` + `build:renderer` clean.

| Fix | File(s) | What changed |
|---|---|---|
| Bug 1 — server-ping hang | `src/main/services/server-ping.ts` | Parse/validate the status JSON *before* settling; malformed payload now resolves offline instead of deadlocking. Also enabled the previously-dead `socket.setTimeout` so the idle timeout handler actually fires |
| Bug 2 — `source_version_id` corruption | `src/main/services/content.ts` | Pack-installed mods no longer stuff a file SHA-1 into `source_version_id` (update/repair reads it as a version id); records `null` instead, keeping the sha1 in the `sha1` column |
| Bug 3 — orphan `.jar` on failed pack install | `src/main/services/content.ts` | `installMrpackContents` now tracks every downloaded file path and deletes them in the catch block alongside the DB-row cleanup |
| Bug 4 — failed import leaves instance | `src/main/services/content.ts` | `importModpackFromFile` deletes the just-created instance (via `deleteInstance`) when pack contents fail to install |
| Bug 5 — double-launch kills JVM | `native/rust/src/launch.rs` | `launch_and_stream` checks the running registry before spawning and refuses a second launch for a still-alive instance id (backstop below the renderer guard) |
| Bug 6 — window size modern versions | `native/rust/src/launch.rs` | `--width/--height` now appended for *all* version families, not only the pre-1.13 legacy branch |
| Bug 7 — byte double-count on retry | `native/rust/src/downloads.rs` | Per-file byte accounting (`file_bytes` map + `record_file_bytes`) so a retried attempt subtracts its predecessor instead of adding on top |
| Bug 8 — blocking sha1 read | `native/rust/src/downloads.rs` | `sha1_matches` now streams via `tokio::fs::File` + 64 KB buffer instead of `std::fs::read` of the whole file |
| Bug 9 — partial Java install | `native/rust/src/java.rs` | A `.noxara-runtime-complete` marker is written only after a runtime fully installs; `runtime_installed()` requires the marker, so a cancelled install self-heals via the sha1-skipping batch downloader |
| P1-10 — delete while running | `src/main/services/instances.ts` | `deleteInstance` is now async and refuses to remove an instance whose JVM is still alive (lazy require of `launch` to avoid an import cycle) |
| P1-11 — create atomicity | `src/main/services/instances.ts` | `createInstance` tracks the created dir and removes it on failure (no more orphan folders) |
| P1-13 — asset-index fetch | `src/main/services/game-files.ts` | Index fetch now has a 30 s timeout and an HTTP-status check; failures abort cleanly instead of hanging or proceeding on garbage |
| P1-14 — giant batch message | `src/main/services/game-files.ts` | The asset+library task list is chunked into ≤512-task `downloads.batch` calls so no single JSON-RPC message can exceed the bridge's size guard |
| P1-15 — native re-extraction | `src/main/services/game-files.ts` | A `.noxara-natives-complete` marker is written after the first successful extraction; later launches skip unzipping every jar |
| P1-17 — dead IPC channels | `ipc.ts`, `preload.ts`, `handlers.ts`, `global.d.ts`, `mojang.ts` | Removed the never-called `getRecommendedJava`, `pickServerIcon`, and `setAccountSkin` IPC surfaces (channel, preload wrapper, handler, type decls, and the now-dead `getRecommendedJava` service fn) |
| P1-18 — SkinsPage chunk | `vite.config.ts` | three.js split into its own cached `three` vendor chunk via `manualChunks`; SkinsPage chunk 531 kB → 21.8 kB |
| P1-12 — broken lint | `eslint.config.js`, `package.json` | Added a flat ESLint 9 config (typescript-eslint + react-hooks), installed the missing dev-deps, fixed the deprecated `--ext` script, and fixed every lint error: conditional `useInstanceState` hook call, ternary-as-statement in `handlers.ts`/`useLaunchStore.ts`, and dead imports/vars across the renderer |
| H-1 — download byte-accounting gap | `native/rust/src/downloads.rs` | The whole transfer body is now one block so ANY failure path (mid-stream network error, write/flush/rename error) records `attempt_bytes` exactly once. Previously only cancellation/sha1-mismatch recorded — a retry after a mid-stream error double-counted those bytes in progress. The `DownloadCancelled` error type is preserved through the failure path so the retry loop still detects cancellation |
| H-2 — core-bridge unbounded buffer | `src/main/services/core-bridge.ts` | stdout accumulation now has a 2 MB cap (discards the partial line with a warning instead of growing memory forever), and timed-out calls are swept after 60 s so a hung core can't pile up orphaned pending entries |
| H-3 — protocol fallback JSON escape | `native/rust/src/protocol.rs` | The serialize-failed fallback response is now built with `serde_json::json!` (proper JSON escaping) instead of a hand-formatted string that could emit invalid JSON if the error text contained quotes/backslashes |
| H-4 — Modrinth 429/timeout | `src/main/services/modrinth.ts`, new `src/main/services/http.ts` | Shared `fetchWithRetry` helper: per-attempt timeout (never hangs), retries 429 (honoring `Retry-After`), 408, and 5xx with exponential backoff, returns permanent 4xx immediately, rethrows caller aborts. All Modrinth calls now route through it |
| H-5 — content/mods downloads hang | `src/main/services/content.ts`, `src/main/services/mods.ts` | `downloadWithProgress` and `downloadPackFile` now combine the cancel signal with a 120 s hard timeout so a stalled CDN can't hang an install |
| H-6 — avatar/skin fetches hang | `src/main/services/avatar.ts`, `src/main/services/skins.ts` | Avatar and skin-PNG downloads use the timeout helper (fail soft → null as before) |
| H-7 — auth chain timeouts | `src/main/auth/microsoft.ts` | All 9 Microsoft/Xbox/Mojang calls now have a 15 s per-attempt timeout; the flaky hops (XSTS, login_with_xbox) keep their existing bounded backoff retry |
| H-8 — refresh-token rotation atomicity | `src/main/services/accounts.ts` | The newly-rotated MSA refresh token is persisted to keytar IMMEDIATELY after `refreshMsaToken` (before the Xbox/Minecraft chain). Previously it was saved only after the whole chain — if a chain hop failed (e.g. Akamai 403), the old token was already burned and the new one never saved, bricking the account until a full re-login |
| H-9 — .mrpack zip-bomb limits | `native/rust/src/modpack.rs` | `extract` now caps entry count (10 000) and total uncompressed bytes (4 GB), enforced against both the declared central-directory sizes AND bytes actually decompressed — so a hostile archive can't exhaust disk/memory even if it lies about its sizes |
| H-10 — instance favorite toggle | `src/shared/types/ipc.ts`, `instances.ts`, `HomePage.tsx`, `InstancesPage.tsx`, `InstanceDetailPage.tsx` | The favorite column existed but was write-only; added `favorite` to `UpdateInstanceInput`, wired it through `updateInstance`'s SQL, and added a tappable star on the home card, instances grid, and instance header (favorites still sort first) |

## 10. Remaining work

- P2: Rust dead-code cleanup (4 fabric/quilt warnings), UA consistency, ANSI handling
  in the console, dead socket-timeout note.
- P3: bridge size guard on the request side (the response side is covered by H-2),
  service test coverage expansion, blocking-fs-in-async audit in `modpack.rs`/`java.rs`
  (currently `spawn_blocking`-free but bounded work, low risk).
- P4: per-instance RAM editor UI, server icon picker UI, JS/TS deps with a clean
  `npm audit` (22 transitive vulnerabilities reported today — needs a triage/upgrade
  pass, none triggered by this hardening work).
