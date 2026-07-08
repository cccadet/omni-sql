import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Tauri expects a fixed port;rollable port. Quando a CLI estiver pronta,
// `tauri dev` cuida de empacotar isto; em pnpm dev isolado, 1420 basta.
const frontendPort = 1420;

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  resolve: {
    conditions: ["browser"],
  },
  server: {
    port: frontendPort,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    outDir: "dist",
  },
});