# Changelog

All notable changes to the Synapses desktop app. This project adheres to [Semantic Versioning](https://semver.org/).

App version is independent of the `synapses` binary version bundled inside it.

---

## [0.1.0] - 2026-03-22

Initial public release of the Synapses desktop app.

### Added
- **Native window** — Tauri v2 shell wrapping the Synapses web console (1100×720 default, min 900×600).
- **Bundled synapses binary** — Ships `synapses` for macOS (arm64, x86_64) and Linux (x86_64). The daemon starts automatically when the app opens.
- **Web console** — Shared React/TypeScript UI from `synapses/web/console/`. Same UI as `http://localhost:11435` in a browser.
- **Auto-updater** — Tauri updater plugin checks `synapses-app` GitHub Releases on startup and prompts for install.
- **Shell integration** — External links open in the system browser via Tauri's shell plugin.
- **Cross-platform build** — macOS `.dmg`, Linux `.AppImage`/`.deb`, Windows `.exe` (via Tauri bundler).

---

[0.1.0]: https://github.com/SynapsesOS/synapses-app/releases/tag/v0.1.0
