#!/usr/bin/env bash
set -euo pipefail
proof="$RUNNER_TEMP/nextcloud-outbound-proof"
prior="$RUNNER_TEMP/nextcloud-outbound-prior"
mkdir -p "$proof"
export OPENCLAW_BUNDLED_PLUGIN_BUILD_IDS=nextcloud-talk
export OPENCLAW_VITEST_MAX_WORKERS=1
export NODE_OPTIONS=--max-old-space-size=8192
run() { local label="$1"; shift; "$@" 2>&1 | tee "$proof/$label.log"; }
python3 - <<'PY'
import hashlib,json,os,re,shutil,subprocess
from pathlib import Path
proof=Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-proof'
prior=Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-prior'
manifest=json.loads((prior/'source-manifest.json').read_text())
assert manifest['candidate']=='f9b2dd6a8c97bdae694f95017420a6480ffd3e2e'
test='extensions/nextcloud-talk/src/outbound-media.test.ts'
for name,digest in manifest['files'].items():
 if name!=test: assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==digest,name
old=(prior/'formatted'/test).read_text()
assert old.count('message!.send.media!')==1 and old.count('accounts!.work.mediaMaxMb')==1
assert old.replace('message!.send.media!','message!.send!.media!').replace('accounts!.work.mediaMaxMb','accounts!.work!.mediaMaxMb')==Path(test).read_text()
baseline=json.loads((prior/'baseline-tests.json').read_text())
failed=[a for s in baseline['testResults'] for a in s['assertionResults'] if a['status']=='failed']
assert len(failed)==2 and all('delivers a real file share' in a['fullName'] and any('undefined' in m and 'equal' in m for m in a['failureMessages']) for a in failed)
log=re.sub(r'\x1b\[[0-9;]*m','',(prior/'focused-tests.log').read_text())
assert re.search(r'Tests\s+86 passed',log)
for name in ['baseline-tests.json','baseline-tests.log','focused-tests.log','extension-types.log']:
 shutil.copy2(prior/name,proof/('retained-'+name))
(proof/'retained-proof.json').write_text(json.dumps({'producerRun':38852156084,'productionBytesUnchanged':True,'delta':'two TypeScript-only fixture non-null assertions','passingTestsRetained':72,'supersededPassingTests':14,'productionTypesRetained':True,'baselineControlsRetained':2},indent=2)+'\n')
paths=list(manifest['files'])
subprocess.run(['pnpm','exec','oxfmt','--write',*paths],check=True)
(proof/'source-manifest.json').write_text(json.dumps({'candidate':os.environ['CANDIDATE_SHA'],'base':manifest['base'],'files':{p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in paths}},indent=2)+'\n')
PY
git diff --binary > "$proof/format.patch"
run affected-tests node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-messaging.config.ts extensions/nextcloud-talk/src/outbound-media.test.ts --maxWorkers=1
run extension-test-types pnpm tsgo:extensions:test
run extension-lint node scripts/run-oxlint.mjs --tsconfig extensions/tsconfig.json extensions/nextcloud-talk/src/outbound-media.ts extensions/nextcloud-talk/src/outbound-media.test.ts extensions/nextcloud-talk/src/message-adapter.ts extensions/nextcloud-talk/src/inbound.ts extensions/nextcloud-talk/src/inbound-media.ts extensions/nextcloud-talk/src/webdav.ts extensions/nextcloud-talk/src/send.handoff.test.ts
run docs-format pnpm exec oxfmt --check docs/channels/nextcloud-talk.md
run docs-list pnpm docs:list
run docs-links pnpm docs:check-links
run whitespace git diff --check
run package node scripts/package-openclaw-for-docker.mjs --bundle-plugin nextcloud-talk --allow-unreleased-changelog --output-dir "$proof" --output-name openclaw-outbound.tgz --pack-json "$proof/pack.json"
run runtime-workers pnpm build qaRuntime
run mentions-and-auth node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-database-workers.config.ts extensions/nextcloud-talk/src/inbound-media.mentions.test.ts extensions/nextcloud-talk/src/inbound.authz.test.ts --maxWorkers=1
run plugin-profile env OPENCLAW_LOCAL_CHECK=0 node --import ./scripts/tsx.mjs scripts/profile-extension-memory.mts --extension nextcloud-talk --skip-combined --concurrency 1
python3 - <<'PY'
import hashlib,json,os
from pathlib import Path
proof=Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-proof'
manifest=json.loads((proof/'source-manifest.json').read_text())
for name,digest in manifest['files'].items():assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==digest,name
(proof/'qualification.json').write_text(json.dumps({'status':'PASS','candidate':os.environ['CANDIDATE_SHA'],'sourceManifestSha256':hashlib.sha256((proof/'source-manifest.json').read_bytes()).hexdigest(),'packageSha256':hashlib.sha256((proof/'openclaw-outbound.tgz').read_bytes()).hexdigest(),'retainedProof':'retained-proof.json'},indent=2)+'\n')
PY
