// The game's share of an app's Vite config. Each app lists it before the Cloudflare plugin:
//
//   plugins: [game(), cloudflare()]
//
// It serves public/ (models and sound) as the app's static files, and the three.js Draco decoder at draco/,
// where three/assets.js looks for it. The decoder is a wasm file and its loader script, fetched at runtime,
// so it is served from node_modules in dev and copied into the client build.
import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('public', import.meta.url));
const require = createRequire(import.meta.url);
const draco = join(dirname(require.resolve('three')), '../examples/jsm/libs/draco/gltf');
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm' };

export function game() {
  return {
    name: 'thick-shift:game',
    config: () => ({ publicDir }),
    configureServer(server) {
      server.middlewares.use('/draco', (req, res, next) => {
        const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
        if (!readdirSync(draco).includes(name)) return next();
        res.setHeader('Content-Type', types[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream');
        createReadStream(join(draco, name)).pipe(res);
      });
    },
    generateBundle() {
      if (this.environment && this.environment.name !== 'client') return;
      for (const name of readdirSync(draco)) {
        this.emitFile({ type: 'asset', fileName: `draco/${name}`, source: readFileSync(join(draco, name)) });
      }
    },
  };
}
