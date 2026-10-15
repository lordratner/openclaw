#!/usr/bin/env bash
set -euo pipefail
mode="$1"
proof="$RUNNER_TEMP/nextcloud-missing-$mode"
mkdir -p "$proof"
export OPENCLAW_BUNDLED_PLUGIN_BUILD_IDS=nextcloud-talk
export OPENCLAW_E2E_USE_PREBUILT_DIST=1
export OPENCLAW_VITEST_MAX_WORKERS=2
export NODE_OPTIONS=--max-old-space-size=8192
if [ "$mode" = release ]; then
  git apply --check "$RUNNER_TEMP/nextcloud-release-payload/release-port.patch"
  git apply "$RUNNER_TEMP/nextcloud-release-payload/release-port.patch"
  test -f node_modules/.pnpm/saxes@6.0.0/node_modules/saxes/package.json
  ln -s .pnpm/saxes@6.0.0/node_modules/saxes node_modules/saxes
fi
python3 - "$mode" <<'PY'
import hashlib,json,os,sys
from pathlib import Path
mode=sys.argv[1]
if mode=='pr':
 m=json.loads(Path('.qa/nextcloud-refresh/retained-source-manifest.json').read_text());hashes=m['files']
else:
 m=json.loads((Path(os.environ['RUNNER_TEMP'])/'nextcloud-release-payload/release-port-manifest.json').read_text());hashes={x['path']:x['candidate_sha256'] for x in m['files']}
for p,h in hashes.items():assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==h,p
(Path(os.environ['RUNNER_TEMP'])/('nextcloud-missing-'+mode)/'source-binding.json').write_text(json.dumps({'mode':mode,'files':hashes,'sourceBytesEqualRetainedPassingProof':True},indent=2)+'\n')
PY
# New runner needs canonical runtime workers; do not repeat retained types/lint/profile suites.
pnpm build qaRuntime 2>&1 | tee "$proof/runtime-worker-build.log"
if [ "$mode" = release ]; then
  pnpm config:channels:gen 2>&1 | tee "$proof/channel-config.log"
  node scripts/lib/plugin-npm-runtime-build.mjs extensions/nextcloud-talk 2>&1 | tee "$proof/plugin-export-recovery.log"
  node --import ./scripts/tsx.mjs "$RUNNER_TEMP/nextcloud-release-payload/stage-release-plugin.mts"
  python3 - <<'PY_RECOVERY'
import json,os,shutil
from pathlib import Path
root=Path(os.environ['RUNNER_TEMP']);out=root/'nextcloud-release-proof'
actual=json.loads((out/'plugin-artifact-manifest.json').read_text());expected=json.loads(Path('.qa/nextcloud-refresh/retained-plugin-artifact-manifest.json').read_text()) if Path('.qa/nextcloud-refresh/retained-plugin-artifact-manifest.json').exists() else json.loads((root/'nextcloud-refresh-payload/retained-plugin-artifact-manifest.json').read_text())
assert actual['files']==expected['files'],'Rebuilt plugin bytes differ from retained qualified artifact'
proof=root/'nextcloud-missing-release'
shutil.copytree(out/'plugin-overlay',proof/'plugin-overlay')
shutil.copy2(out/'plugin-artifact-manifest.json',proof/'plugin-artifact-manifest.json')
(proof/'artifact-export-recovery.json').write_text(json.dumps({'status':'PASS','allFilesByteIdenticalToRetainedQualifiedArtifact':True,'includeHiddenFilesRequired':True,'files':len(actual['files'])},indent=2)+'\n')
PY_RECOVERY
fi
files=(extensions/nextcloud-talk/src/inbound.room-info-retry.test.ts extensions/nextcloud-talk/src/webhook-spool.test.ts)
if [ "$mode" = pr ]; then
  files+=(extensions/nextcloud-talk/src/inbound.authz.test.ts extensions/nextcloud-talk/src/inbound.behavior.test.ts)
fi
node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-database-workers.config.ts --passWithNoTests=false --reporter=json --outputFile="$proof/test-results.json" "${files[@]}" 2>&1 | tee "$proof/missing-worker-tests.log"
python3 - "$mode" <<'PY'
import hashlib,json,os,sys
from pathlib import Path
mode=sys.argv[1];p=Path(os.environ['RUNNER_TEMP'])/('nextcloud-missing-'+mode);d=json.loads((p/'test-results.json').read_text())
expected={'inbound.room-info-retry.test.ts','webhook-spool.test.ts'}
if mode=='pr':expected|={'inbound.authz.test.ts','inbound.behavior.test.ts'}
selected={Path(t['name']).name for t in d['testResults']}
assert selected==expected,(selected,expected)
assert d['success'] is True and d['numFailedTests']==0 and d['numPassedTests']>0,d
binding=json.loads((p/'source-binding.json').read_text())
for f,h in binding['files'].items():assert hashlib.sha256(Path(f).read_bytes()).hexdigest()==h,f
(p/'qualification.json').write_text(json.dumps({'status':'PASS','mode':mode,'files':sorted(selected),'passedTests':d['numPassedTests'],'failedTests':0,'sourceBytesEqualRetainedPassingProof':True},indent=2)+'\n')
PY
