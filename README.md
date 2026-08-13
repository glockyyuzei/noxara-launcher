# Noxara Launcher

A minimalist, monochrome Minecraft launcher by Noxara Labs. Electron + React + TypeScript +
Tailwind renderer, talking over a secure typed IPC bridge to a privileged Electron main
process, which drives a Rust native core (`noxara-core`) for all Minecraft-specific work
(version resolution, Java detection/installation, downloading, and launching).

## Features

Everything below is real — there are no mockups or fake "coming soon" placeholders in the
working flows.

**Instances**
- Create instances for **Vanilla, Fabric, Forge, NeoForge, and Quilt** with isolated
  directories (mods, configs, saves, screenshots live per-instance); all loader builds
  come from the live registries (with a Retry on version-load failures)
- Live Mojang version manifest (cached, no hardcoded version lists) with snapshot toggle
- Real launch pipeline: downloads client jar + libraries + assets with **sha1
  verification**, resolves a compatible Java runtime, builds JVM args, spawns Java
  directly (no shell), streams live console output, and detects crashes by exit code
- **Crash diagnosis**: when the game exits unexpectedly, the launcher analyzes the log
  tail (OOM, missing deps, duplicate mods, JVM init failure, …) and shows an actionable
  banner with View log / Copy error / Restart / Repair
- **Instance Health check & one-click Repair** (client files, Java runtime, mods, deps)
- Duplicate, export as a modpack, open folder, favorite, delete
- **Per-instance console**: colored, live output with stderr/error highlighting, search,
  timestamps, Copy / Clear / Follow controls — launch failures are logged right into it
- Every instance shows its real lifecycle state (Launching → Running → Stopping →
  Crashed) everywhere it appears

**Content**
- **Mods**: search & install from Modrinth with version/dependency resolution, update
  checks, and uninstall
- **Modpacks**: import/export Modrinth `.mrpack` archives; downloading a pack from the
  Modrinth tab installs it as its own instance
- **Resource Packs** and **Shaders**: browse, install, enable/disable per instance
- Per-mod dependency resolution (required/optional/incompatible)

**Accounts**
- **Microsoft**: full OAuth 2.0 **device-code** flow → Xbox Live → XSTS → Minecraft
  Services, with refresh-token rotation persisted in the OS credential store. No
  password ever touches the app
- **Offline** profiles with vanilla-compatible offline UUID derivation
- Account avatars embedded from the real skin; profile refresh

**Skins**
- Local skin library (64×64 and legacy 64×32 PNG uploads, classic/slim model detection,
  rename/delete)
- **3D skin viewer** on every account: drag to rotate, scroll to zoom, classic/slim body
  swap, idle/walk animation, second-layer (hat/jacket/sleeves) rendering and legacy
  64×32 support
- **Apply to Mojang** — uploads the skin to your real Mojang profile so it shows in
  vanilla Minecraft and any other launcher, not just Noxara
- Offline accounts carry their selected skin into the instance on every launch

**Java**
- Automatic detection across PATH, common install locations, and managed directories
- **Automatic Java installation**: if no compatible Java exists, Noxara downloads
  Mojang's own bundled official runtime (sha1-verified) on first launch — no manual
  setup required. The Java manager also offers one-click installs of Java 8/17/21
- Custom per-instance or default Java path, verified by probing the binary

**Multiplayer**
- Server list with icons, favorites, per-instance scoping, and live Minecraft
  Server List Ping (latency, version, player count, MOTD, favicon)

**General**
- Global **Downloads/Activity manager**: real progress, cancel/retry, clearable history —
  launches, loader installs, repairs, and Java runtime downloads are also cancellable
- First-class settings: game directory, memory per instance, window size, close-on-
  launch behavior, concurrent download limit, download retries + per-request timeout,
  **start on boot, minimize to tray, close-with-running-instances confirmation**,
  **UI scale / compact mode / animations**, debug logging, open-data-directory
- **Global search (Ctrl+K)**: jump to pages, instances, accounts, and servers
- SQLite persistence with a real migration runner

## Requirements

- **Node.js 18–22** (Node 24 is too new — `better-sqlite3` has no prebuilt binary for it yet
  and will try to compile from source, which is more likely to fail). Use
  [nvm-windows](https://github.com/coreybutler/nvm-windows) or [nvm](https://github.com/nvm-sh/nvm)
  to install Node 20 LTS if you're on something newer.
- Rust 1.75+ (`rustup`) for `noxara-core`
- **Windows**: Visual Studio 2022 Build Tools with the **"Desktop development with C++"**
  workload — specifically the **MSVC v143 - VS 2022 C++ x64/x86 build tools** component.
  If `npm install` fails with an MSBuild error mentioning `ClangCL` or
  `The build tools for ClangCL ... cannot be found`, it means only the Clang toolset is
  installed and not the standard MSVC one. Fix: open **Visual Studio Installer** → Modify →
  check **Desktop development with C++** (this pulls in MSVC v143) → Modify/Install. Then
  re-run `npm install`.
- **Linux**: `libgtk-3-dev`, `libnss3-dev`, `build-essential`
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)

> Microsoft sign-in requires Noxara Labs to have a registered Azure AD "public client"
> application set via `NOXARA_MSA_CLIENT_ID` — without it, Microsoft sign-in is disabled
> with a clear message (offline profiles still work). There is no way to fake this
> credential.

Native modules (`better-sqlite3`, `keytar`) compile against your system Node during
`npm install`, then get rebuilt for Electron's bundled Node ABI automatically via the
`postinstall` script (`electron-rebuild`) — don't skip `npm install`'s postinstall step.

## Setup

```bash
npm install
npm run build:rust      # builds native/rust/target/release/noxara-core
```

## Run in development

```bash
npm run dev
```

This runs the Vite dev server for the renderer and `tsc --watch` + Electron for the main
process concurrently. `noxara-core` is spawned automatically by the main process from
`native/rust/target/release/noxara-core` — make sure you've run `npm run build:rust` first
(there's no dev-mode `cargo watch` wiring yet; rebuild the Rust binary manually after
changes to `native/rust/src/**`).

## Build a distributable

```bash
npm run build            # renderer + main + rust, in that order
npm run package:win      # or package:mac / package:linux
```

Packaged binaries land in `release/`.

## Project layout

```
src/main/        Electron main process (privileged): IPC handlers, services, auth, filesystem
src/renderer/     React UI (sandboxed, no Node access — talks only through window.noxara)
src/shared/       Types shared between main and renderer (the IPC contract)
native/rust/      noxara-core: Mojang metadata, Java detection + runtime install, downloads,
                  launch, spoken over line-delimited JSON-RPC on stdio
                  (see native/rust/src/protocol.rs)
database/migrations/  Versioned SQL migrations, applied automatically on startup
```

## Security notes

- The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
  It can only reach main-process functionality through the narrow API in `src/main/preload.ts`.
- Microsoft refresh tokens are stored in the OS credential store via `keytar`, never in SQLite,
  never logged. Access tokens are redacted from any game console output before it's ever
  written to an event or file (see `redact()` in `native/rust/src/launch.rs`).
- The JVM is spawned directly (`Command::new` in Rust / no `child_process` shell mode in Node)
  — arguments are passed as an array, never interpolated into a shell string.
- Every file write, extraction, and deletion derived from user/network input is constrained
  with `assertWithin` / `enclosed_name()` to block path traversal.