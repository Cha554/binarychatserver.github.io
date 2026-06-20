#!/bin/bash
# Builds a standalone BinaryChat client executable for the CURRENT platform.
# Requires Node.js 20+ installed.
# Run this ON each target OS (Windows/Mac/Linux) — Node's SEA feature builds
# natively per-platform, it doesn't cross-compile.
set -e

echo "Installing dependencies..."
npm install

echo "Bundling client.js + dependencies into a single file..."
npx esbuild client.js --bundle --platform=node --target=node18 --outfile=bundle.js

echo "Generating SEA prep blob..."
node --experimental-sea-config sea-config.json

mkdir -p dist
OUT="dist/binarychat"
case "$(uname -s)" in
  Darwin) OUT="dist/binarychat-macos" ;;
  Linux)  OUT="dist/binarychat-linux" ;;
esac

echo "Copying node binary..."
cp "$(command -v node)" "$OUT"

echo "Injecting application code..."
if [ "$(uname -s)" = "Darwin" ]; then
  codesign --remove-signature "$OUT" 2>/dev/null || true
fi

npx postject "$OUT" NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  $([ "$(uname -s)" = "Darwin" ] && echo "--macho-segment-name NODE_SEA")

if [ "$(uname -s)" = "Darwin" ]; then
  codesign --sign - "$OUT" 2>/dev/null || true
fi

chmod +x "$OUT"
rm -f bundle.js sea-prep.blob

echo ""
echo "Done! Executable created at: $OUT"
echo "Run it with: $OUT --server=ws://your-server-address:8080"
