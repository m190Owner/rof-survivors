import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Serve the /assets folder at the site root so dropping a PNG in there
  // (e.g. assets/player.png -> /player.png) overrides the placeholder sprite.
  publicDir: 'assets',
  // Dev-only: forward the PHP backends (leaderboard + co-op signaling) to a local
  // PHP server so they work under `npm run dev`. Set GAME_PHP to override the target.
  server: {
    proxy: {
      '/leaderboard.php': process.env.GAME_PHP || 'http://127.0.0.1:8801',
      '/signaling.php': process.env.GAME_PHP || 'http://127.0.0.1:8801',
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist'
  }
});
