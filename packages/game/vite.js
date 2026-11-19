// The game's share of an app's Vite config. Each app lists it before the Cloudflare plugin:
//
//   plugins: [game(), cloudflare()]
//
// It serves public/ (models and sound) as the app's static files, as-is.
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('public', import.meta.url));

export function game() {
  return {
    name: 'thick-shift:game',
    config: () => ({ publicDir }),
  };
}
