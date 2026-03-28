#!/usr/bin/env bash
# bundle-binary.sh — Build the synapses Go binary and copy it into
# src-tauri/resources/ so that `tauri build` bundles a real binary.
#
# Usage:
#   ./scripts/bundle-binary.sh              # build for current platform
#   ./scripts/bundle-binary.sh all          # cross-compile for all platforms
#   SYNAPSES_BIN=/path/to/synapses ./scripts/bundle-binary.sh  # use pre-built binary
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SYNAPSES_DIR="$(cd "$APP_DIR/../synapses" && pwd)"
RESOURCES_DIR="$APP_DIR/src-tauri/resources"

# Detect current platform triple
detect_triple() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Darwin)
      case "$arch" in
        arm64|aarch64) echo "aarch64-apple-darwin" ;;
        x86_64)        echo "x86_64-apple-darwin" ;;
        *) echo "unsupported-$os-$arch"; return 1 ;;
      esac ;;
    Linux)
      case "$arch" in
        x86_64)        echo "x86_64-unknown-linux-gnu" ;;
        aarch64|arm64) echo "aarch64-unknown-linux-gnu" ;;
        *) echo "unsupported-$os-$arch"; return 1 ;;
      esac ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "x86_64-pc-windows-msvc" ;;
    *) echo "unsupported-$os-$arch"; return 1 ;;
  esac
}

# Build synapses binary for a given GOOS/GOARCH and copy to resources
build_for() {
  local goos="$1" goarch="$2" triple="$3" ext=""
  [[ "$goos" == "windows" ]] && ext=".exe"

  local dest="$RESOURCES_DIR/synapses-${triple}${ext}"

  # If caller provided a pre-built binary, just copy it
  if [[ -n "${SYNAPSES_BIN:-}" ]]; then
    echo "  Copying pre-built binary to $dest"
    cp "$SYNAPSES_BIN" "$dest"
    chmod +x "$dest"
    return
  fi

  echo "  Building synapses for $goos/$goarch..."
  cd "$SYNAPSES_DIR"

  local version
  version="$(git describe --tags --always 2>/dev/null || echo 'dev')"

  GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 \
    go build -ldflags "-s -w -X main.version=$version" \
    -o "$dest" ./cmd/synapses

  chmod +x "$dest"
  local size
  size="$(du -h "$dest" | cut -f1)"
  echo "  Built: $dest ($size)"
}

# Main
mkdir -p "$RESOURCES_DIR"

if [[ "${1:-}" == "all" ]]; then
  echo "Cross-compiling synapses for all platforms..."
  build_for darwin  arm64 "aarch64-apple-darwin"
  build_for darwin  amd64 "x86_64-apple-darwin"
  build_for linux   amd64 "x86_64-unknown-linux-gnu"
  # Windows disabled by default (CGO_ENABLED=0 should work but untested)
  # build_for windows amd64 "x86_64-pc-windows-msvc"
  echo "Done. All binaries in $RESOURCES_DIR/"
else
  triple="$(detect_triple)"
  echo "Building synapses for current platform ($triple)..."
  case "$triple" in
    aarch64-apple-darwin)        build_for darwin  arm64 "$triple" ;;
    x86_64-apple-darwin)         build_for darwin  amd64 "$triple" ;;
    x86_64-unknown-linux-gnu)    build_for linux   amd64 "$triple" ;;
    aarch64-unknown-linux-gnu)   build_for linux   arm64 "$triple" ;;
    x86_64-pc-windows-msvc)      build_for windows amd64 "$triple" ;;
    *) echo "Error: unsupported platform $triple"; exit 1 ;;
  esac
  echo "Done. Binary in $RESOURCES_DIR/"
fi

ls -la "$RESOURCES_DIR"/synapses-*
