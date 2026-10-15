#!/usr/bin/env bash
set -euo pipefail
payload="$RUNNER_TEMP/nextcloud-release-payload"
proof="$RUNNER_TEMP/nextcloud-release-proof"
mkdir -p "$proof"
export OPENCLAW_BUNDLED_PLUGIN_BUILD_IDS=nextcloud-talk
export OPENCLAW_VITEST_MAX_WORKERS=2
export NODE_OPTIONS=--max-old-space-size=8192
run() { local label="$1"; shift; "$@" 2>&1 | tee "$proof/$label.log"; }
python3 - <<'PY'
import hashlib,json,os,subprocess
from pathlib import Path
payload=Path(os.environ['RUNNER_TEMP'])/'nextcloud-release-payload'
m=json.loads((payload/'release-port-manifest.json').read_text())
assert subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()==m['release_commit']
for f in m['files']:
 p=Path(f['path']); h=hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
 assert h==f['release_sha256'],f['path']
assert hashlib.sha256((payload/'release-port.patch').read_bytes()).hexdigest()==m['patch_sha256']
PY
run core-stock-build pnpm build qaRuntime
python3 - <<'PY'
from pathlib import Path
import os,shutil
shutil.copytree('dist',Path(os.environ['RUNNER_TEMP'])/'nextcloud-release-stock-dist',symlinks=True,ignore=shutil.ignore_patterns('node_modules'))
PY
git apply --check "$payload/release-core-seam.patch"
git apply "$payload/release-core-seam.patch"
run core-seam-build pnpm build qaRuntime
python3 "$payload/release-artifacts.py"
git apply --reverse "$payload/release-core-seam.patch"
git apply --check "$payload/release-port.patch"
git apply "$payload/release-port.patch"
python3 - <<'PY'
import hashlib,json,os
from pathlib import Path
payload=Path(os.environ['RUNNER_TEMP'])/'nextcloud-release-payload'
m=json.loads((payload/'release-port-manifest.json').read_text())
for f in m['files']:assert hashlib.sha256(Path(f['path']).read_bytes()).hexdigest()==f['candidate_sha256'],f['path']
import subprocess
subprocess.run(['pnpm','exec','oxfmt','--check',*[f['path'] for f in m['files']]],check=True)
PY
test -f node_modules/.pnpm/saxes@6.0.0/node_modules/saxes/package.json
test ! -e node_modules/saxes
ln -s .pnpm/saxes@6.0.0/node_modules/saxes node_modules/saxes
run channel-config pnpm config:channels:gen
run plugin-build node scripts/lib/plugin-npm-runtime-build.mjs extensions/nextcloud-talk
node --import ./scripts/tsx.mjs "$payload/stage-release-plugin.mts"
run talk-tests node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-messaging.config.ts extensions/nextcloud-talk
run matrix-consumer-tests node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-matrix.config.ts --passWithNoTests=false extensions/matrix/src/test-runtime.test.ts extensions/matrix/src/matrix/monitor/handler.media-failure.test.ts
run core-types pnpm tsgo:core
run extension-types pnpm tsgo:extensions
run extension-test-types pnpm tsgo:extensions:test
run extension-lint node scripts/run-oxlint.mjs --tsconfig extensions/tsconfig.json extensions/nextcloud-talk extensions/matrix/src/test-runtime.ts
run plugin-profile env OPENCLAW_LOCAL_CHECK=0 node --import ./scripts/tsx.mjs scripts/profile-extension-memory.mts --extension nextcloud-talk --skip-combined --concurrency 1
cp "$payload/release-port-manifest.json" "$proof/source-manifest.json"
python3 - <<'PY'
from pathlib import Path
import json,os
proof=Path(os.environ['RUNNER_TEMP'])/'nextcloud-release-proof'
(proof/'qualification.json').write_text(json.dumps({'status':'PASS','release':'59cb44796b0f1f0daa0e37af8b1495abb45d9bc1','scope':'exact-release-plugin-and-additive-runtime-seam','activationApproved':False},indent=2)+'\n')
PY
