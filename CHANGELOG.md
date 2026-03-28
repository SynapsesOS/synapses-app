# Changelog

All notable changes to the Synapses desktop app. This project adheres to [Semantic Versioning](https://semver.org/).

---

## [0.8.0] - 2026-03-28

Version aligned with the synapses CLI (v0.8.0).

### Changed
- **Version alignment** — App version now matches the synapses binary version for clarity.
- **Windows support removed** — Dropped Windows build targets. macOS and Linux only for now.
- **Bundled resources** — Removed Windows binary from Tauri resource map.

### Added
- **Updater signing** — Tauri updater configured with Ed25519 signing key for secure auto-updates.

### Security
- Fixed 8 vulnerabilities identified in security audit.

---

## [0.1.0] - 2026-03-22

Initial public release of the Synapses desktop app.

### Added
- **Native window** — Tauri v2 shell wrapping the Synapses web console (1100×720 default, min 900×600).
- **Bundled synapses binary** — Ships `synapses` for macOS (arm64, x86_64) and Linux (x86_64). The daemon starts automatically when the app opens.
- **Web console** — Shared React/TypeScript UI from `synapses/web/console/`. Same UI as `http://localhost:11435` in a browser.
- **Auto-updater** — Tauri updater plugin checks `synapses-app` GitHub Releases on startup and prompts for install.
- **Shell integration** — External links open in the system browser via Tauri's shell plugin.

---

[0.8.0]: https://github.com/SynapsesOS/synapses-app/releases/tag/v0.8.0
[0.1.0]: https://github.com/SynapsesOS/synapses-app/releases/tag/v0.1.0
