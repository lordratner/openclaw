#!/usr/bin/env bash
set -euo pipefail
phase="$1"
proof="$RUNNER_TEMP/nextcloud-outbound-proof"
mkdir -p "$proof"
export OPENCLAW_BUNDLED_PLUGIN_BUILD_IDS=nextcloud-talk
export OPENCLAW_VITEST_MAX_WORKERS=1
export NODE_OPTIONS=--max-old-space-size=8192
run() { local label="$1"; shift; "$@" 2>&1 | tee "$proof/$label.log"; }
case "$phase" in
prepare)
  python3 - <<'PY'
import hashlib,json,os,subprocess
from pathlib import Path
paths=json.load(open('.proof-tools/.qa/nextcloud-outbound/paths.json'))
subprocess.run(['pnpm','exec','oxfmt','--write',*paths],check=True)
proof=Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-proof'
for name in paths:
 target=proof/'formatted'/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(Path(name).read_bytes())
(proof/'source-manifest.json').write_text(json.dumps({'candidate':os.environ['CANDIDATE_SHA'],'base':os.environ['BASE_SHA'],'files':{p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in paths}},indent=2)+'\n')
subprocess.run(['git','diff','--check'],check=True)
PY
  git diff --binary > "$proof/format.patch"
  run lint node scripts/run-oxlint.mjs --tsconfig extensions/tsconfig.json extensions/nextcloud-talk
  ;;
workers)
  run runtime-workers pnpm build qaRuntime
  ;;
negative)
  git fetch --no-tags --depth=1 origin "$BASE_SHA"
  restore_source() {
    for name in src/inbound.ts src/message-adapter.ts runtime-api.ts; do
      cp "$proof/formatted/extensions/nextcloud-talk/$name" "extensions/nextcloud-talk/$name"
    done
  }
  trap restore_source EXIT
  for name in src/inbound.ts src/message-adapter.ts runtime-api.ts; do
    git show "$BASE_SHA:extensions/nextcloud-talk/$name" > "extensions/nextcloud-talk/$name"
  done
  set +e
  node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-messaging.config.ts extensions/nextcloud-talk/src/outbound-media.test.ts --maxWorkers=1 --testNamePattern 'delivers a real file share' --reporter=json --outputFile="$proof/baseline-direct.json" > "$proof/baseline-direct.log" 2>&1
  direct_code=$?
  node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-database-workers.config.ts extensions/nextcloud-talk/src/inbound.behavior.test.ts --maxWorkers=1 --testNamePattern 'uploads an automatic' --reporter=json --outputFile="$proof/baseline-automatic.json" > "$proof/baseline-automatic.log" 2>&1
  automatic_code=$?
  set -e
  test "$direct_code" -ne 0
  test "$automatic_code" -ne 0
  python3 - <<'PY'
import json,os
from pathlib import Path
root=Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-proof'
for name,count,needle in [('direct',2,'delivers a real file share'),('automatic',3,'uploads an automatic')]:
 result=json.loads((root/f'baseline-{name}.json').read_text())
 failed=[a for s in result['testResults'] for a in s['assertionResults'] if a['status']=='failed']
 assert result['numFailedTests']==count and len(failed)==count,(name,result)
 assert all(needle in a['fullName'] and any('undefined' in m and 'equal' in m for m in a['failureMessages']) for a in failed),(name,failed)
PY
  restore_source
  trap - EXIT
  ;;
tests)
  run messaging-tests node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-messaging.config.ts extensions/nextcloud-talk/src/outbound-media.test.ts extensions/nextcloud-talk/src/send.handoff.test.ts extensions/nextcloud-talk/src/inbound-media.test.ts extensions/nextcloud-talk/src/inbound-media.behavior.test.ts extensions/nextcloud-talk/src/inbound-media.security.test.ts --maxWorkers=1 --reporter=json --outputFile="$proof/messaging-tests.json"
  run automatic-and-auth-tests node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-database-workers.config.ts extensions/nextcloud-talk/src/inbound.behavior.test.ts extensions/nextcloud-talk/src/inbound.authz.test.ts extensions/nextcloud-talk/src/inbound-media.mentions.test.ts --maxWorkers=1 --reporter=json --outputFile="$proof/automatic-and-auth-tests.json"
  ;;
types)
  run production-types pnpm tsgo:extensions
  run test-types pnpm tsgo:extensions:test
  ;;
docs)
  run docs-format pnpm exec oxfmt --check docs/channels/nextcloud-talk.md
  run docs-list pnpm docs:list
  run docs-links pnpm docs:check-links
  run whitespace git diff --check
  ;;
package)
  run package node scripts/package-openclaw-for-docker.mjs --bundle-plugin nextcloud-talk --allow-unreleased-changelog --output-dir "$proof" --output-name openclaw-outbound.tgz --pack-json "$proof/pack.json"
  ;;
profile)
  run plugin-profile env OPENCLAW_LOCAL_CHECK=0 node --import ./scripts/tsx.mjs scripts/profile-extension-memory.mts --extension nextcloud-talk --skip-combined --concurrency 1
  python3 - <<'PY'
import hashlib,json,os,tarfile
from pathlib import Path
proof=Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-proof'
manifest=json.loads((proof/'source-manifest.json').read_text())
for name,digest in manifest['files'].items():assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==digest,name
tests={}
for name,expected in [('messaging-tests',5),('automatic-and-auth-tests',3)]:
 result=json.loads((proof/(name+'.json')).read_text());assert result['success'] is True and result['numFailedTests']==0
 assert len(result['testResults'])==expected,(name,result)
 tests[name]={'passed':result['numPassedTests'],'files':len(result['testResults'])}
with tarfile.open(proof/'openclaw-outbound.tgz') as archive:
 build=json.load(archive.extractfile('package/dist/build-info.json'))
 assert build['commit']==os.environ['CANDIDATE_SHA'],build
 for plugin_id in ['nextcloud-talk','openai']:
  plugin=json.load(archive.extractfile(f'package/dist/extensions/{plugin_id}/openclaw.plugin.json'))
  assert plugin['id']==plugin_id
(proof/'qualification.json').write_text(json.dumps({'status':'PASS','candidate':os.environ['CANDIDATE_SHA'],'sourceManifestSha256':hashlib.sha256((proof/'source-manifest.json').read_bytes()).hexdigest(),'packageSha256':hashlib.sha256((proof/'openclaw-outbound.tgz').read_bytes()).hexdigest(),'tests':tests,'baselineMissingNativeUploadControls':5,'bundledPluginsVerified':['nextcloud-talk','openai']},indent=2)+'\n')
PY
  ;;
*) exit 2 ;;
esac
