#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/src" "$scratch/test"
cp src/parse.js "$scratch/src/parse.js"
cp test/parse.test.js "$scratch/test/parse.test.js"
perl -0pi -e 's/url\.hostname === effectiveBase\.hostname/HOSTS.has(url.hostname)/' "$scratch/src/parse.js"
set +e
NODE_PATH="$(pwd)/node_modules" node --test "$scratch/test/parse.test.js" >"$scratch/output.log" 2>&1
status=$?
set -e
if [ "$status" -eq 0 ]; then
  echo "negative control unexpectedly passed"
  exit 1
fi
grep -q 'crossing from the current' "$scratch/output.log"
echo "✓ negative control caught a broken same-origin guard"
