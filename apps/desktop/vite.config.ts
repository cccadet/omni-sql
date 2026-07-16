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
