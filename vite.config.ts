import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  base: '/pong-wars/',
  plugins: [wasm()],
  worker: {
    format: 'es',
    plugins: () => [wasm()],
  },
});
