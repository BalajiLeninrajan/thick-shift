// Builds an app's static site: the game's public/ with the app's own files laid over it, so an app can add
// pages and replace boot.js, the page's entry module. Run from the app's directory, as its build script:
//
//   node ../../packages/game/assemble.mjs public dist
//
// dist/ is emptied first. Files are hard-linked where the filesystem allows, so this takes a moment even with
// the models, and copied where it does not.
import { cpSync, linkSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [own, out] = process.argv.slice(2);
if (!own || !out) throw new Error('usage: node assemble.mjs <app public dir> <out dir>');
const game = fileURLToPath(new URL('public', import.meta.url));

function lay(from, to) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, e.name), dst = join(to, e.name);
    if (e.isDirectory()) { lay(src, dst); continue; }
    rmSync(dst, { force: true });   // an app file replacing one of the game's
    try { linkSync(src, dst); } catch (err) { cpSync(src, dst); }
  }
}

rmSync(out, { recursive: true, force: true });
lay(game, out);
lay(own, out);
