import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port; when running standalone via `pnpm dev`, 1420 is fine.
const frontendPort = 1420;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    conditions: ["browser"],
  },
  optimizeDeps: {
    include: ["monaco-editor"],
  },
  server: {
    port: frontendPort,
    strictPort: true,
    // Cargo writes and locks Windows executables while Vite is running under
    // `tauri dev`. Watching those generated files can raise EBUSY and stop the
    // frontend dev server during the final link step.
    watch: {
      ignored: ["**/src-tauri/target/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    outDir: "dist",
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ["monaco-editor"],
          fluent: ["@fluentui/react-components", "@fluentui/react-icons"],
        },
      },
    },
  },
});
