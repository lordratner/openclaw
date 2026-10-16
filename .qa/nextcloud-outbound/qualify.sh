#!/usr/bin/env bash
set -euo pipefail
proof="$RUNNER_TEMP/nextcloud-outbound-proof"
mkdir -p "$proof"
export OPENCLAW_BUNDLED_PLUGIN_BUILD_IDS=nextcloud-talk
export OPENCLAW_VITEST_MAX_WORKERS=1
export NODE_OPTIONS=--max-old-space-size=8192
run() { local label="$1"; shift; "$@" 2>&1 | tee "$proof/$label.log"; }
python3 - <<'PY'
import json,subprocess
paths=json.load(open('.qa/nextcloud-outbound/paths.json'))
subprocess.run(['pnpm','exec','oxfmt','--write',*paths],check=True)
PY
git diff --binary > "$proof/format.patch"
python3 - <<'PY'
import hashlib,json,os,subprocess
from pathlib import Path
paths=json.load(open('.qa/nextcloud-outbound/paths.json'))
proof=Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-proof'
saved=proof/'formatted';saved.mkdir()
for name in paths:
 p=saved/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(Path(name).read_bytes())
(proof/'source-manifest.json').write_text(json.dumps({'candidate':os.environ['CANDIDATE_SHA'],'base':os.environ['BASE_SHA'],'files':{p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in paths}},indent=2)+'\n')
for name in ['extensions/nextcloud-talk/src/message-adapter.ts','extensions/nextcloud-talk/src/inbound.ts','extensions/nextcloud-talk/src/inbound-media.ts']:
 Path(name).write_bytes(subprocess.check_output(['git','show',os.environ['BASE_SHA']+':'+name]))
for name in ['extensions/nextcloud-talk/src/outbound-media.ts','extensions/nextcloud-talk/src/webdav.ts']:
 Path(name).unlink()
PY
set +e
node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-messaging.config.ts extensions/nextcloud-talk/src/outbound-media.test.ts --maxWorkers=1 --testNamePattern 'delivers a real file share' --reporter=json --outputFile="$proof/baseline-tests.json" > "$proof/baseline-tests.log" 2>&1
baseline_code=$?
set -e
test "$baseline_code" -ne 0
python3 - <<'PY'
import json,os
from pathlib import Path
proof=Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-proof'
result=json.loads((proof/'baseline-tests.json').read_text())
assert result['numFailedTests']==2,result
assert result['numRuntimeErrorTestSuites']==0,result
failed=[a for s in result['testResults'] for a in s['assertionResults'] if a['status']=='failed']
assert len(failed)==2 and all('delivers a real file share' in a['fullName'] for a in failed)
assert all(any('undefined' in message and 'equal' in message for message in a['failureMessages']) for a in failed),failed
for name in json.load(open('.qa/nextcloud-outbound/paths.json')):
 Path(name).write_bytes((proof/'formatted'/name).read_bytes())
PY
run focused-tests node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-messaging.config.ts extensions/nextcloud-talk/src/outbound-media.test.ts extensions/nextcloud-talk/src/send.handoff.test.ts extensions/nextcloud-talk/src/inbound-media.test.ts extensions/nextcloud-talk/src/inbound-media.behavior.test.ts extensions/nextcloud-talk/src/inbound-media.security.test.ts extensions/nextcloud-talk/src/inbound-media.mentions.test.ts --maxWorkers=1
run extension-types pnpm tsgo:extensions
run extension-test-types pnpm tsgo:extensions:test
run extension-lint node scripts/run-oxlint.mjs --tsconfig extensions/tsconfig.json extensions/nextcloud-talk/src/outbound-media.ts extensions/nextcloud-talk/src/outbound-media.test.ts extensions/nextcloud-talk/src/message-adapter.ts extensions/nextcloud-talk/src/inbound.ts extensions/nextcloud-talk/src/inbound-media.ts extensions/nextcloud-talk/src/webdav.ts extensions/nextcloud-talk/src/send.handoff.test.ts
run docs-format pnpm exec oxfmt --check docs/channels/nextcloud-talk.md
run docs-list pnpm docs:list
run docs-links pnpm docs:check-links
run whitespace git diff --check
run package node scripts/package-openclaw-for-docker.mjs --bundle-plugin nextcloud-talk --allow-unreleased-changelog --output-dir "$proof" --output-name openclaw-outbound.tgz --pack-json "$proof/pack.json"
run plugin-profile env OPENCLAW_LOCAL_CHECK=0 node --import ./scripts/tsx.mjs scripts/profile-extension-memory.mts --extension nextcloud-talk --skip-combined --concurrency 1
python3 - <<'PY'
import hashlib,json,os
from pathlib import Path
proof=Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-proof'
manifest=json.loads((proof/'source-manifest.json').read_text())
for name,digest in manifest['files'].items():assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==digest,name
(proof/'qualification.json').write_text(json.dumps({'status':'PASS','candidate':os.environ['CANDIDATE_SHA'],'sourceManifestSha256':hashlib.sha256((proof/'source-manifest.json').read_bytes()).hexdigest(),'packageSha256':hashlib.sha256((proof/'openclaw-outbound.tgz').read_bytes()).hexdigest()},indent=2)+'\n')
PY
