#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm test
for file in src/*.js popup/*.js test/*.js; do node --check "$file"; done
node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync("manifest.json"));if(m.manifest_version!==3)process.exit(1);for(const p of [m.background.service_worker,m.action.default_popup,...Object.values(m.icons),...Object.values(m.action.default_icon)])if(!fs.existsSync(p))throw new Error(`missing ${p}`)'
./scripts/negative-control.sh
./scripts/prepublish-check.sh
echo "✓ all checks passed"
