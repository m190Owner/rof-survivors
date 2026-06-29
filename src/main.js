// Bootstrap: generate/load sprites, build the game, start the loop.
// (style.css is linked from index.html and bundled by Vite.)
import { initSprites } from './sprites.js';
import { Game } from './game.js';

async function boot() {
  await initSprites(); // procedural placeholders + any /assets PNG overrides
  const canvas = document.getElementById('game-canvas');
  const game = new Game(canvas);
  game.run(); // sits on the START screen until DEPLOY is pressed
  // Expose the game object for console debugging in DEV only. In production this
  // line is dead-code-eliminated, so players can't poke the game from the console.
  if (import.meta.env.DEV) window.__game = game;
}

boot();
