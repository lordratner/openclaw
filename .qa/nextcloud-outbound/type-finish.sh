#!/usr/bin/env bash
set -euo pipefail
proof="$RUNNER_TEMP/nextcloud-outbound-proof"
mkdir -p "$proof"
export OPENCLAW_BUNDLED_PLUGIN_BUILD_IDS=nextcloud-talk
export OPENCLAW_VITEST_MAX_WORKERS=1
export NODE_OPTIONS=--max-old-space-size=8192
case "$1" in
prepare)
 python3 - <<'INNER'
import hashlib,json,os,shutil,subprocess
from pathlib import Path
prior=Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-prior';out=Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-proof'
gates=json.loads((prior/'gate-status.json').read_text());assert gates['types']=='failure' and all(v=='success' for k,v in gates.items() if k!='types'),gates
assert 'TS2339' in (prior/'test-types.log').read_text() and 'error TS' not in (prior/'production-types.log').read_text()
manifest=json.loads((prior/'source-manifest.json').read_text());assert manifest['candidate']=='04aadd6b3aa638815eb7c4ac48b8a30b531ba4ca'
changed='extensions/nextcloud-talk/src/inbound.behavior.test.ts'
for name,digest in manifest['files'].items():
 if name!=changed:assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==digest,name
old=(prior/'formatted'/changed).read_text()
helper='// The dispatch mock exposes its last (core-managed) overload. Resolve the\n// captured callback through both supported contracts for native/baseline proof.\nfunction resolveReplyDelivery(delivery: ChannelInboundTurnPlan["delivery"] | ProviderReplyDelivery) {\n  return isProviderReplyDelivery(delivery)\n    ? delivery.deliverWithProviderMessageSending\n    : delivery.deliver;\n}\n\n'
expected=old.replace('type AutomaticReplyContext = {',helper+'type AutomaticReplyContext = {')
expected=expected.replace('          const deliver = isProviderReplyDelivery(request.delivery)\n            ? request.delivery.deliverWithProviderMessageSending\n            : request.delivery.deliver;','          const deliver = resolveReplyDelivery(request.delivery);')
assert expected!=old and Path(changed).read_text()==expected,'Unexpected fixture delta'
paths=json.load(open('.proof-tools/.qa/nextcloud-outbound/paths.json'))
subprocess.run(['pnpm','exec','oxfmt','--write',*paths],check=True)
for name in paths:
 target=out/'formatted'/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(Path(name).read_bytes())
(out/'source-manifest.json').write_text(json.dumps({'candidate':os.environ['CANDIDATE_SHA'],'base':manifest['base'],'files':{p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in paths}},indent=2)+'\n')
for name in ['openclaw-outbound.tgz','pack.json','package.log','plugin-profile.log','production-types.log','security-tests.json','security-tests.log','automatic-and-auth-tests.json','automatic-and-auth-tests.log','retained-messaging-tests.json','retained-proof.json','retained-lint.log','docs-format.log','docs-list.log','docs-links.log','retained-baseline-direct.json','retained-baseline-direct.log']:
 shutil.copy2(prior/name,out/name)
(out/'package-source-manifest.json').write_bytes((prior/'source-manifest.json').read_bytes())
(out/'retained-type-repair-proof.json').write_text(json.dumps({'producerRun':38860463628,'packageCandidate':manifest['candidate'],'productionBytesUnchanged':True,'passingTestsRetained':101,'freshFixtureCases':14,'productionTypesRetained':True,'docsPackageProfileRetained':True},indent=2)+'\n')
INNER
 git diff --binary > "$proof/format.patch"
 ;;
checks)
 node scripts/run-oxlint.mjs --tsconfig extensions/tsconfig.json extensions/nextcloud-talk/src/inbound.behavior.test.ts 2>&1 | tee "$proof/type-fixture-lint.log"
 pnpm tsgo:extensions:test 2>&1 | tee "$proof/test-types.log"
 node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-database-workers.config.ts extensions/nextcloud-talk/src/inbound.behavior.test.ts --maxWorkers=1 --reporter=json --outputFile="$proof/type-fixture-tests.json" 2>&1 | tee "$proof/type-fixture-tests.log"
 ;;
negative)
 git fetch --no-tags --depth=1 origin "$BASE_SHA"
 restore_source() { for name in src/inbound.ts src/message-adapter.ts runtime-api.ts; do cp "$proof/formatted/extensions/nextcloud-talk/$name" "extensions/nextcloud-talk/$name"; done; }
 trap restore_source EXIT
 for name in src/inbound.ts src/message-adapter.ts runtime-api.ts; do git show "$BASE_SHA:extensions/nextcloud-talk/$name" > "extensions/nextcloud-talk/$name"; done
 set +e
 node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-database-workers.config.ts extensions/nextcloud-talk/src/inbound.behavior.test.ts --maxWorkers=1 --testNamePattern 'uploads an automatic' --reporter=json --outputFile="$proof/baseline-automatic.json" > "$proof/baseline-automatic.log" 2>&1
 result=$?
 set -e
 test "$result" -ne 0
 python3 - <<'INNER'
import json,os
from pathlib import Path
r=json.loads((Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-proof/baseline-automatic.json').read_text())
f=[a for s in r['testResults'] for a in s['assertionResults'] if a['status']=='failed']
assert r['numFailedTests']==3 and len(f)==3
assert all('uploads an automatic' in a['fullName'] and any('undefined' in m and 'equal' in m for m in a['failureMessages']) for a in f)
INNER
 restore_source
 trap - EXIT
 ;;
finalize)
 python3 - <<'INNER'
import hashlib,json,os,tarfile
from pathlib import Path
root=Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-proof'
gates=json.loads(os.environ['QUALIFICATION_GATES']);(root/'gate-status.json').write_text(json.dumps(gates,indent=2)+'\n');assert all(v=='success' for v in gates.values()),gates
manifest=json.loads((root/'source-manifest.json').read_text())
for name,digest in manifest['files'].items():assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==digest,name
r=json.loads((root/'type-fixture-tests.json').read_text());assert r['success'] and r['numPassedTests']==14 and r['numFailedTests']==0
assert all(a['status']=='passed' for s in r['testResults'] for a in s['assertionResults'])
old=json.loads((root/'package-source-manifest.json').read_text())
with tarfile.open(root/'openclaw-outbound.tgz') as archive:
 build=json.load(archive.extractfile('package/dist/build-info.json'));assert build['commit']==old['candidate']
 for name in ['nextcloud-talk','openai']:assert archive.getmember(f'package/dist/extensions/{name}/index.js').size>0
(root/'qualification.json').write_text(json.dumps({'status':'PASS','candidate':os.environ['CANDIDATE_SHA'],'packageCandidate':old['candidate'],'productionBytesUnchanged':True,'sourceManifestSha256':hashlib.sha256((root/'source-manifest.json').read_bytes()).hexdigest(),'packageSha256':hashlib.sha256((root/'openclaw-outbound.tgz').read_bytes()).hexdigest(),'freshPassingTests':14,'retainedPassingTests':101,'baselineMissingNativeUploadControls':5,'bundledPluginsVerified':['nextcloud-talk','openai']},indent=2)+'\n')
INNER
 ;;
*) exit 2 ;;
esac
