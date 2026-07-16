import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  base: "/pong-wars/",
  plugins: [wasm()],
  worker: {
    format: "es",
    plugins: () => [wasm()],
  },
  resolve: {
    alias: {
      worker: fileURLToPath(new URL("./worker/pkg/worker.js", import.meta.url)),
    },
  },
});
