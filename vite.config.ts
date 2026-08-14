import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/renderer"),
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // three.js is large (~500 kB) and pinned; give it its own chunk so it's
          // cached independently of the app code and only fetched when the SkinsPage
          // route is actually opened.
          three: ["three"],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
