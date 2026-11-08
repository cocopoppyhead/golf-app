import { defineConfig } from 'vite';
// base is the GitHub Pages sub-path (https://<user>.github.io/golf-app/)
export default defineConfig({
  base: process.env.BASE_PATH || '/golf-app/',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
