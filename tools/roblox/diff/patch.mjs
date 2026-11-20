// Patches a scratch copy of packages/game/src and tools/balance (never the repo's own) so a balance-harness night can be
// recorded for apps/roblox/test/diff-sim.luau. Usage: node patch.mjs <work dir>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const work = process.argv[2];
const swap = (file, from, to) => {
  const path = join(work, file), text = readFileSync(path, 'utf8');
  if (!text.includes(from)) throw new Error(`${file}: did not find ${from}`);
  writeFileSync(path, text.replace(from, to));
};

// The port shuffles the night's battery spots with Fisher-Yates instead of a random sort.
swap('packages/game/src/three/sim3d.js',
  'const spots = BATTERY_SPOTS.map((_, i) => i).sort(() => Math.random() - .5);',
  'const spots = BATTERY_SPOTS.map((_, i) => i); for (let i = spots.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [spots[i], spots[j]] = [spots[j], spots[i]]; }');
// The step's real elapsed time, before the sim caps it, so the replay steps by the same amount.
swap('packages/game/src/three/sim3d.js',
  'lastStep = now;\n  S.players = guards();',
  'if (globalThis.__REC) globalThis.__REC.dt = (now - lastStep) / 1000;\n  lastStep = now;\n  S.players = guards();');
// Record the draws the sim makes, and wrap its entry points.
swap('tools/balance/floor.mjs',
  "return ((t ^ t >>> 14) >>> 0) / 4294967296; };",
  "const v = ((t ^ t >>> 14) >>> 0) / 4294967296; if (globalThis.__REC?.on) globalThis.__REC.rands.push(v); return v; };");
swap('tools/balance/floor.mjs',
  "const sim = await import(new URL('three/sim3d.js', src).href);",
  "const { wrapSim } = await import(new URL('../roblox-rec.mjs', import.meta.url));\nconst sim = wrapSim(await import(new URL('three/sim3d.js', src).href), game);");
