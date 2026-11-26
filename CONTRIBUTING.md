# Contributing

Open an issue before starting on anything bigger than a small fix.

## Setup

You need Node 22.18 or later and pnpm (`corepack enable` installs the version `package.json` pins).

```sh
pnpm install
pnpm dev           # the web game on localhost:5173, rooms included
pnpm dev:discord   # the Discord Activity build
```

Add `?dev` to the URL for the dev menu (god mode, time skips, mascot controls).

## Before you open a pull request

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

CI runs these and both builds on every pull request. If you change the simulation on purpose, `pnpm test -u` updates the seeded-night snapshots. Say in the pull request which nights moved and why.

To check balance, `node tools/balance/floor.ts` plays every scenario through the real sim. Run it for any change to the rules.

[docs/internals.md](docs/internals.md) covers the code layout, how rooms run a night, and the rules and numbers behind the game.
