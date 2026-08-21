#!/bin/sh
# Deploy the site to GitHub Pages (staging URL).
# Builds with the Pages base path, then force-pushes dist/ to the gh-pages
# branch of this repo's origin. Idempotent; run from anywhere in the repo.
set -eu

cd "$(git rev-parse --show-toplevel)"
REMOTE="$(git remote get-url origin)"
SHA="$(git rev-parse --short HEAD)"

# A stale dist mixes bundle hashes across builds; always start clean.
rm -rf dist

npm run build:pages
touch dist/.nojekyll

rm -rf dist/.git
git -C dist init -q -b gh-pages
git -C dist add -A
git -C dist commit -q -m "deploy ${SHA}"
git -C dist push -q -f "${REMOTE}" gh-pages
rm -rf dist/.git

echo "deployed ${SHA} to gh-pages"
