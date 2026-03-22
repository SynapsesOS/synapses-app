# Contributing to Synapses Desktop App

Thank you for contributing to the Synapses desktop app. This guide covers setting up the development environment, project structure, and the PR workflow.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| [Rust](https://rustup.rs) | stable | `rustup update stable` |
| [Tauri CLI](https://tauri.app/start/) | v2 | `cargo install tauri-cli --version "^2"` |
| [Node.js](https://nodejs.org) | 18+ | nodejs.org |
| [npm](https://npmjs.com) | 9+ | Comes with Node.js |
| [Go](https://golang.org/dl) | 1.22+ | golang.org/dl (needed to rebuild the synapses binary) |

## Repo Layout

Both `synapses` and `synapses-app` must be checked out side-by-side:

```
synapses-os/
├── synapses/               # Core engine (Go binary + web console source)
└── synapses-app/           # This repo (Tauri native shell)
```

The web console source lives in `synapses/web/console/` — **not** in this repo. Tauri's build commands (`beforeDevCommand`, `beforeBuildCommand`) cross-reference it by relative path.

## Development Setup

```bash
# Clone both repos
mkdir synapses-os && cd synapses-os
git clone https://github.com/SynapsesOS/synapses.git
git clone https://github.com/SynapsesOS/synapses-app.git

# Install web console dependencies (one-time)
cd synapses/web/console && npm install && cd ../../..

# Fetch Rust dependencies (one-time)
cd synapses-app/src-tauri && cargo fetch && cd ..

# Start the dev window
cargo tauri dev
```

`cargo tauri dev` starts the Vite dev server automatically and opens a native window with hot-reload enabled.

## Making Changes

### Frontend (web console)

All UI changes go in `synapses/web/console/src/`. The Tauri window loads directly from the Vite dev server when in dev mode, so changes hot-reload instantly.

```bash
# You can also run the web console standalone (no native window needed):
cd synapses/web/console
npm run dev
# Open http://localhost:5173
```

### Tauri Shell (native code)

Tauri-specific code lives in `src-tauri/src/`. This is where you'd add:
- Native Tauri commands (invoked from the frontend via `@tauri-apps/api`)
- App lifecycle hooks (`app.run()`, system tray, etc.)
- Platform-specific window behaviour

When you change Rust code, the Tauri dev server automatically recompiles and refreshes the window.

### App Config (`tauri.conf.json`)

- `version` — bump this when releasing a new version of the app
- `bundle.resources` — paths to the bundled `synapses` platform binaries
- `plugins.updater.pubkey` — Ed25519 public key for update verification

## Building for Production

```bash
# 1. Build the web console
cd synapses/web/console && npm ci && npm run build && cd ../../..

# 2. Place synapses binary in resources/ (build from the synapses repo or download from releases)
mkdir -p synapses-app/src-tauri/resources
cp synapses/bin/synapses synapses-app/src-tauri/resources/synapses-$(uname -m)-apple-darwin  # example

# 3. Build the Tauri bundle
cd synapses-app
cargo tauri build
# Output: src-tauri/target/release/bundle/
```

## Testing

There are currently no automated tests for the Tauri shell itself. Test the native window manually after any Rust changes:
1. `cargo tauri dev` — verify the window opens and UI loads
2. Click through the web console — verify no JS errors in the DevTools console
3. Verify the `synapses` binary starts correctly via the app

Frontend (web console) tests run in the `synapses` repo:
```bash
cd synapses/web/console
npm test
```

## Submitting a Pull Request

1. Fork and branch from `main`:
   ```bash
   git checkout -b fix/my-tauri-fix
   ```
2. Make changes, test manually in dev mode.
3. If you changed the web console, verify it still builds: `npm run build`.
4. If you changed Rust code, verify it compiles: `cargo build`.
5. Push and open a PR against `main`. Describe what changed and why.
6. CI runs on Linux, macOS. All checks must pass.

## Reporting Issues

- **Bug reports**: Include OS, app version, and steps to reproduce.
- **Frontend bugs**: If the issue also appears at `http://localhost:11435` (browser), report it in the [synapses repo](https://github.com/SynapsesOS/synapses/issues) instead — it's a core bug, not a Tauri-specific one.
- **Security**: Report privately to security@synapsesos.dev, not in public issues.

## Code Style

- **Rust**: `cargo fmt` before committing. Follow standard Rust idioms.
- **Frontend**: Handled by the `synapses` repo conventions (ESLint + Prettier).
- **Config**: Keep `tauri.conf.json` minimal — avoid adding fields that are only needed in one environment.
