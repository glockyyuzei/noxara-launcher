# Noxara Launcher

A minimalist, monochrome Minecraft launcher by Noxara Labs. Electron + React + TypeScript +
Tailwind renderer, talking over a secure typed IPC bridge to a privileged Electron main
process, which drives a Rust native core (`noxara-core`) for all Minecraft-specific work
(version resolution, Java detection, downloading, and launching).

## Status: Phase 1 (of the roadmap in the original spec)

This is a **real, working foundation**, not a mockup:

- ✅ Live Mojang version manifest + version detail fetch (cached), no hardcoded versions
- ✅ Real Java detection across Windows/macOS/Linux common install locations + PATH
- ✅ Real instance creation with an isolated directory per instance (mods/config/saves/etc.)
- ✅ Real launch flow: downloads client jar + libraries + assets with sha1 verification,
  resolves a compatible Java runtime, builds JVM args, spawns Java (no shell), streams
  live console output back to the UI, detects crashes by exit code
- ✅ SQLite persistence with a real migration runner
- ✅ Offline profiles with vanilla-compatible offline UUID derivation
- ✅ Microsoft auth: the full OAuth device-code → Xbox Live → XSTS → Minecraft Services
  chain is implemented in `src/main/auth/microsoft.ts`, but is **inert until Noxara Labs
  registers a real Azure AD application** and sets `NOXARA_MSA_CLIENT_ID`. There is no way
  to fake this credential, so the UI clearly disables the button and explains why.
- 🚧 Not yet built: Fabric/Forge/NeoForge/Quilt installers, Modrinth/CurseForge browsing,
  mod dependency resolution, modpack import/export, resource packs, shaders, servers,
  backups, instance sharing, dedup/sync. Each has an honest "not implemented yet" screen
  in the UI rather than a fake one — see `ComingSoonPage.tsx`.

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
native/rust/      noxara-core: Mojang metadata, Java detection, downloads, launch, spoken
                  over line-delimited JSON-RPC on stdio (see native/rust/src/protocol.rs)
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
