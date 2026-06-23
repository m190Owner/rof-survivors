import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Serve the /assets folder at the site root so dropping a PNG in there
  // (e.g. assets/player.png -> /player.png) overrides the placeholder sprite.
  publicDir: 'assets',
  build: {
    target: 'es2020',
    outDir: 'dist'
  }
});
