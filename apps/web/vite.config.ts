import { cloudflare } from '@cloudflare/vite-plugin';
import { game } from '@thick-shift/game/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [game(), cloudflare()],
});
