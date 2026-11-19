import { fileURLToPath } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import { game } from '@thick-shift/game/vite';
import { defineConfig } from 'vite';

const page = name => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  // The web app's Worker inspector takes the default port, 9229. Both servers started at once would race for it.
  plugins: [game(), cloudflare({ inspectorPort: 9230 })],
  // Discord reaches a local dev server through a tunnel (README.md), and Vite turns away hosts it does not know.
  server: { allowedHosts: ['.trycloudflare.com'] },
  environments: {
    // The Terms of Service and Privacy Policy pages the Developer Portal links to, built beside the game and
    // served at /terms and /privacy. Only the client gets these inputs; the Worker's entry is wrangler.jsonc's main.
    client: {
      build: {
        rolldownOptions: {
          input: { index: page('index.html'), terms: page('terms.html'), privacy: page('privacy.html') },
        },
      },
    },
  },
});
