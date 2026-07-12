import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { spotifyPlaylistProxy } from './scripts/spotifyPlaylistProxy';

export default defineConfig({
  plugins: [react(), spotifyPlaylistProxy()],
  // Pin the dev-server port. localStorage/IndexedDB (repertoire, swaps, uploads) is
  // scoped to the origin *including the port*, so a floating port makes saved data
  // "disappear" whenever Vite hops to a new one. strictPort fails loudly if 5173 is
  // busy instead of silently moving and splitting your data across origins.
  server: { port: 5173, strictPort: true },
  // @sqlite.org/sqlite-wasm ships a .wasm loaded relative to its JS; the dep
  // pre-bundler rewrites that URL and breaks it, so exclude it from optimization.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
});
