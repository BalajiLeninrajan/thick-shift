// The page's entry module (index.html). It starts the game as the web version plays it. An app that runs the game
// somewhere else ships its own boot.js, which replaces this one in that app's build (assemble.mjs).
import { start } from './src/main.js';

start();
