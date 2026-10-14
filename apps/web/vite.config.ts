import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@mcopilot/shared-types": fileURLToPath(
        new URL("../../packages/shared-types/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    // Lokal: Functions Core Tools (7071). Besser: `swa start` (inkl. Auth-Emulation).
    proxy: { "/api": "http://localhost:7071" },
  },
  build: { outDir: "dist", sourcemap: true },
});
