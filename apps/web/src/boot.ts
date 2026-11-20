// The web app's entry module (index.html). It loads the game's styles and starts the game as the web version
// plays it. The Discord app has its own boot.js.
import '@thick-shift/game/styles.css';
import { start } from '@thick-shift/game';

start();
