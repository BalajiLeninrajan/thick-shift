#!/bin/sh
# Copies the Discord Embedded App SDK's ES module build from node_modules into
# public/vendor/discord-sdk, where discord/activity.js imports it. Discord's sandbox
# refuses scripts from any other host, so the Activity serves the SDK itself.
# Run after changing its version in package.json: pnpm vendor
set -e
dst=public/vendor/discord-sdk
rm -rf "$dst" && mkdir -p "$dst"
# The build imports its parts by relative path, so the whole directory goes.
(cd node_modules/@discord/embedded-app-sdk/output && find . -name '*.mjs' | cpio -pdm --quiet "$OLDPWD/$dst")
