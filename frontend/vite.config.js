import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ["buffer", "process", "util", "stream"],
      globals: { Buffer: true, process: true },
    }),
  ],
  define: {
    "process.env": {},
  },
  server: {
    port: 5173,
    // TxLINE's /api/scores/stream and /api/odds/stream don't send an
    // Access-Control-Allow-Origin header (unlike its other endpoints, which
    // do allow direct browser fetches) — a browser preflight to them fails
    // with a CORS error no matter what the client sends. Only the server
    // can fix that with a header; from the client side, the standard dev
    // workaround is to route through Vite's own dev server instead: the
    // browser's request becomes same-origin (http://localhost:5173/...),
    // and Vite's Node process makes the actual cross-origin request to
    // TxLINE — which isn't subject to browser CORS at all.
    // NOTE: this only covers local dev (`vite dev`). A production build has
    // no Vite dev server to proxy through, so a deployed version of this
    // app still needs an equivalent server-side proxy (e.g. a small
    // serverless function) in front of these two endpoints.
    proxy: {
      "/txline-stream": {
        target: "https://txline-dev.txodds.com", // must match TXLINE_CONFIG.devnet.apiOrigin
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/txline-stream/, ""),
      },
    },
  },
  build: { sourcemap: true },
});