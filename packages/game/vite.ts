// The game's share of an app's Vite config. Each app lists it before the Cloudflare plugin:
//
//   plugins: [game(), cloudflare()]
//
// It serves public/ (models and sound) as the app's static files, as-is.
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const publicDir = fileURLToPath(new URL('public', import.meta.url));

// DRACOLoader names two sets of decoder files with import.meta.url, so the build emits both. The game asks only for
// the glTF set in libs/draco/gltf/ (src/three/assets.ts). These are the general-purpose ones, which nothing fetches.
const unusedDraco = /\/three\/examples\/jsm\/libs\/draco\/draco_[^/]+$/;

export function game(): Plugin {
  return {
    name: 'thick-shift:game',
    config: () => ({
      publicDir,
      // app.ts, the lazy three.js chunk, is about 800 kB on its own.
      build: { chunkSizeWarningLimit: 900 },
    }),
    generateBundle(_, bundle) {
      for (const [file, out] of Object.entries(bundle)) {
        if (out.type === 'asset' && out.originalFileNames.some(name => unusedDraco.test(name))) delete bundle[file];
      }
    },
  };
}
