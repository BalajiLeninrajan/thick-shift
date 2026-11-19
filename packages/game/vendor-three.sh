#!/bin/sh
# Copies the parts of three.js the 3D mode uses from node_modules into
# public/vendor/three, where the import map in index.html points.
# Run after changing the three version: pnpm vendor
set -e
src=node_modules/three dst=public/vendor/three
rm -rf "$dst" && mkdir -p "$dst/addons"
cp "$src/build/three.module.js" "$src/build/three.core.js" "$dst/"
cd "$src/examples/jsm"
for f in loaders/GLTFLoader.js loaders/DRACOLoader.js utils/BufferGeometryUtils.js utils/SkeletonUtils.js libs/draco/gltf postprocessing shaders math/SimplexNoise.js; do
  mkdir -p "$OLDPWD/$dst/addons/$(dirname $f)" && cp -r "$f" "$OLDPWD/$dst/addons/$f"
done
