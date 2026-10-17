import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The SPA talks to the gateway on the same origin (/api). In development Vite proxies /api to
// the local FastAPI backend; in production FastAPI/Caddy on IBM LinuxONE serves dist/ itself.
const backend = process.env.INTENTGATE_DEV_BACKEND ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: backend,
        changeOrigin: false,
        // Server-sent events must stream through unbuffered.
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if ((proxyRes.headers["content-type"] ?? "").includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
    },
  },
  preview: {
    port: 4173,
    proxy: { "/api": { target: backend, changeOrigin: false } },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Shared by the shell and the lazy 3D scene: keep them in the core chunk so the entry
          // never has to import (and preload) the three.js / r3f chunks.
          if (id.includes("vite/preload-helper") || id.includes("commonjsHelpers")) return "react";
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("zustand") || id.includes("use-sync-external-store")) return "react";
          if (id.includes("postprocessing")) return "postfx";
          if (id.includes("/three/") || id.includes("\\three\\")) return "three";
          if (id.includes("@react-three") || id.includes("three-stdlib") || id.includes("camera-controls") || id.includes("troika")) return "r3f";
          if (id.includes("react-dom") || id.includes("/react/") || id.includes("\\react\\") || id.includes("scheduler")) return "react";
          if (id.includes("motion") || id.includes("framer")) return "motion";
          return undefined;
        },
      },
    },
  },
});
