import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  resolve: {
    alias: {
      "@tauri-apps/api/core": path.resolve(__dirname, "src/__mocks__/@tauri-apps/api/core.ts"),
      "@tauri-apps/api/event": path.resolve(__dirname, "src/__mocks__/@tauri-apps/api/event.ts"),
      "@tauri-apps/plugin-dialog": path.resolve(__dirname, "src/__mocks__/@tauri-apps/plugin-dialog.ts"),
      "@tauri-apps/plugin-opener": path.resolve(__dirname, "src/__mocks__/@tauri-apps/plugin-opener.ts"),
      "@tauri-apps/plugin-os": path.resolve(__dirname, "src/__mocks__/@tauri-apps/plugin-os.ts"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/vite-env.d.ts", "src/test/**", "src/__mocks__/**"],
    },
  },
}));
