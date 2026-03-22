# Synapses — Desktop App

[![Release](https://img.shields.io/github/v/release/SynapsesOS/synapses-app?style=for-the-badge&color=00ADD8)](https://github.com/SynapsesOS/synapses-app/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

**Synapses Desktop** is a native desktop wrapper around the [Synapses](https://github.com/SynapsesOS/synapses) web console. It bundles the `synapses` binary and presents the management UI in a native window — no browser tab required.

> **Most users do not need this.** The web console is already built into the `synapses` binary and accessible at `http://localhost:11435` in any browser. Install the desktop app only if you prefer a native window.

---

## What's inside

| Component | Description |
|-----------|-------------|
| **Tauri shell** | Native window (Rust + WebView) — macOS, Linux, Windows |
| **Web console** | The same React/TypeScript UI bundled in `synapses/web/console/` |
| **synapses binary** | Bundled per-platform — the full Synapses engine |
| **Auto-updater** | Tauri updater checks `synapses-app` releases on startup |

The app is a thin wrapper. All intelligence — code graph, MCP server, brain, scout — lives inside the `synapses` binary that ships alongside the app.

---

## Download

Get the latest release for your platform from [GitHub Releases](https://github.com/SynapsesOS/synapses-app/releases/latest):

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `Synapses_aarch64.dmg` |
| macOS (Intel) | `Synapses_x86_64.dmg` |
| Linux (x86_64) | `Synapses_amd64.AppImage` or `.deb` |
| Windows | `Synapses_x64-setup.exe` |

After installing, launch **Synapses** from your Applications folder / launcher. The app starts the `synapses` daemon automatically.

---

## Development Setup

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Rust](https://rustup.rs) | stable | Tauri native shell |
| [Tauri CLI](https://tauri.app/start/) | v2 | Build and dev commands |
| [Node.js](https://nodejs.org) | 18+ | Web console build |
| [npm](https://npmjs.com) | 9+ | Package manager |
| [Go](https://golang.org/dl) | 1.22+ | Building the bundled synapses binary |

Install Tauri CLI:
```bash
cargo install tauri-cli --version "^2"
```

### Clone

This repo is a monorepo sibling of `synapses`. Both must be checked out under the same parent directory:

```
synapses-os/
├── synapses/           # Core engine — github.com/SynapsesOS/synapses
└── synapses-app/       # This repo — github.com/SynapsesOS/synapses-app
```

```bash
mkdir synapses-os && cd synapses-os
git clone https://github.com/SynapsesOS/synapses.git
git clone https://github.com/SynapsesOS/synapses-app.git
```

### Run in Dev Mode

```bash
cd synapses-app

# Install Tauri dependencies (one-time)
cd src-tauri && cargo fetch && cd ..

# Start dev mode — Vite hot-reload + native window
cargo tauri dev
```

This automatically:
1. Runs `cd ../../synapses/web/console && npm run dev` (Vite at `http://localhost:5173`)
2. Opens a native Tauri window pointed at the Vite dev server

> The dev window connects to the Vite dev server, so React changes hot-reload without restarting the native window.

### Build Production App

```bash
# Build the web console
cd ../synapses/web/console
npm ci && npm run build
cd ../../../synapses-app

# Build the Tauri app (produces installers in src-tauri/target/release/bundle/)
cargo tauri build
```

The bundled `synapses` binary must be placed in `src-tauri/resources/` before building. See [Bundling the synapses binary](#bundling-the-synapses-binary) below.

---

## Architecture

```
synapses-app/
├── src-tauri/               # Rust / Tauri native shell
│   ├── src/                 # Tauri commands and main.rs
│   ├── tauri.conf.json      # App config (window size, bundle, updater)
│   ├── resources/           # Bundled synapses binaries (per platform)
│   └── Cargo.toml
└── (no separate frontend)   # UI lives in synapses/web/console/
```

**Key design choice**: the frontend code lives in `synapses/web/console/`, not in this repo. This keeps the web console and desktop app in sync — the same bundle is:
- Embedded in the `synapses` binary (served at `http://localhost:11435`)
- Loaded by the Tauri window in the desktop app

Changes to the UI only need to happen once.

---

## Bundling the synapses Binary

The desktop app ships the `synapses` binary inside the Tauri bundle. Before building a release:

```bash
# Build synapses for the current platform
cd ../synapses
make build

# Copy to synapses-app resources (example for macOS ARM)
cp bin/synapses ../synapses-app/src-tauri/resources/synapses-aarch64-apple-darwin
```

For CI/CD cross-compilation, the GitHub Actions workflow in `.github/workflows/` handles this automatically — it builds the synapses binary matrix first, then runs `cargo tauri build` per platform.

---

## Auto-Updates

The app checks for new releases using the Tauri updater plugin. On startup it hits:

```
https://github.com/SynapsesOS/synapses-app/releases/latest/download/latest.json
```

If a newer version is available, a dialog prompts the user to install it. The update is signed with an Ed25519 key; the public key is baked into `tauri.conf.json`.

> **Note for maintainers**: to generate a signing key pair: `cargo tauri signer generate`. Store the private key securely and update `TAURI_SIGNING_PRIVATE_KEY` in the repo secrets.

---

## Configuration

`src-tauri/tauri.conf.json` is the single source of truth for the app:

| Field | Value | Notes |
|-------|-------|-------|
| `productName` | `Synapses` | Display name |
| `version` | `0.1.0` | App version (independent of synapses binary version) |
| `identifier` | `com.synapsesos.app` | macOS bundle ID |
| `devUrl` | `http://localhost:5173` | Vite dev server |
| `frontendDist` | `../../synapses/web/console/dist` | Production build output |
| `beforeDevCommand` | `cd ../../synapses/web/console && npm run dev` | Auto-starts Vite |
| `beforeBuildCommand` | `npm ci && npm run build` | Auto-builds UI |
| `minWidth` / `minHeight` | 900 / 600 | Window constraints |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

Short version:
1. Fork and clone both `synapses` and `synapses-app` under the same parent
2. Run `cargo tauri dev` to open a hot-reloading dev window
3. Make changes, test, open a PR against `main`

---

## Relationship to synapses

```
synapses (core)
  └── web/console/          ← shared frontend
        ↑ built by:
synapses-app (this repo)    ← Tauri native window
synapses binary             ← embeds the same frontend, serves it at :11435
```

Both the desktop app and the browser path serve the **same React app**. If you only have the `synapses` binary (no desktop app), open `http://localhost:11435` after running `synapses init`.

---

## License

MIT License — See [LICENSE](LICENSE) for details.

---

## Links

- **synapses (core engine)**: https://github.com/SynapsesOS/synapses
- **Issues**: https://github.com/SynapsesOS/synapses-app/issues
- **Security**: security@synapsesos.dev
