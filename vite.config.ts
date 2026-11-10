import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the whole game into one self-contained dist/index.html
// (Rapier's wasm is inlined by rapier3d-compat).
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2022', chunkSizeWarningLimit: 8000 },
});
