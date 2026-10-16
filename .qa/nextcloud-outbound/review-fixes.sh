#!/usr/bin/env bash
set -euo pipefail
proof="$RUNNER_TEMP/nextcloud-outbound-proof"
mkdir -p "$proof"
export OPENCLAW_BUNDLED_PLUGIN_BUILD_IDS=nextcloud-talk
export OPENCLAW_VITEST_MAX_WORKERS=1
export NODE_OPTIONS=--max-old-space-size=8192
case "$1" in
messaging)
 node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-messaging.config.ts extensions/nextcloud-talk/src/outbound-media.test.ts extensions/nextcloud-talk/src/send.handoff.test.ts extensions/nextcloud-talk/src/inbound-media.test.ts extensions/nextcloud-talk/src/inbound-media.behavior.test.ts extensions/nextcloud-talk/src/inbound-media.security.test.ts --maxWorkers=1 --reporter=json --outputFile="$proof/messaging-tests.json" 2>&1 | tee "$proof/messaging-tests.log"
 ;;
automatic)
 node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-database-workers.config.ts extensions/nextcloud-talk/src/inbound.behavior.test.ts extensions/nextcloud-talk/src/inbound.authz.test.ts extensions/nextcloud-talk/src/inbound-media.mentions.test.ts --maxWorkers=1 --reporter=json --outputFile="$proof/automatic-and-auth-tests.json" 2>&1 | tee "$proof/automatic-and-auth-tests.log"
 ;;
review-negative)
 git fetch --no-tags --depth=1 origin ca18124c8a500d2507103741414a02f6f313c52b
 restore_review_source() {
   for name in src/outbound-media.ts src/message-adapter.ts; do
     cp "$proof/formatted/extensions/nextcloud-talk/$name" "extensions/nextcloud-talk/$name"
   done
 }
 trap restore_review_source EXIT
 for name in src/outbound-media.ts src/message-adapter.ts; do
   git show "ca18124c8a500d2507103741414a02f6f313c52b:extensions/nextcloud-talk/$name" > "extensions/nextcloud-talk/$name"
 done
 set +e
 node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-messaging.config.ts extensions/nextcloud-talk/src/outbound-media.test.ts --maxWorkers=1 --testNamePattern 'explains recovery without sharing|preserves bot-only web attachment links' --reporter=json --outputFile="$proof/review-baseline-direct.json" > "$proof/review-baseline-direct.log" 2>&1
 direct_code=$?
 node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-database-workers.config.ts extensions/nextcloud-talk/src/inbound.behavior.test.ts --maxWorkers=1 --testNamePattern 'preserves a bot-only automatic' --reporter=json --outputFile="$proof/review-baseline-automatic.json" > "$proof/review-baseline-automatic.log" 2>&1
 automatic_code=$?
 set -e
 test "$direct_code" -ne 0
 test "$automatic_code" -ne 0
 python3 - <<'PYREVIEW'
import json,os
from pathlib import Path
root=Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-proof'
for name,count in [('direct',6),('automatic',3)]:
 result=json.loads((root/f'review-baseline-{name}.json').read_text())
 failed=[a for s in result['testResults'] for a in s['assertionResults'] if a['status']=='failed']
 assert result['numFailedTests']==count and len(failed)==count,(name,result)
 assert all(('explains recovery without sharing' in a['fullName'] or 'preserves bot-only web attachment links' in a['fullName'] or 'preserves a bot-only automatic' in a['fullName']) for a in failed),(name,failed)
 for a in failed:
  messages=' '.join(a['failureMessages'])
  assert ('upload failed' in messages and 'match' in messages) if 'explains recovery' in a['fullName'] else ('apiUser' in messages and 'apiPassword' in messages),(name,a)
PYREVIEW
 restore_review_source
 trap - EXIT
 ;;
finalize)
 python3 - <<'PY'
import hashlib,json,os,subprocess,tarfile
from pathlib import Path
r=Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-proof'
gates=json.loads(os.environ['QUALIFICATION_GATES']);(r/'gate-status.json').write_text(json.dumps(gates,indent=2)+'\n');assert all(v=='success' for v in gates.values()),gates
m=json.loads((r/'source-manifest.json').read_text())
for name,digest in m['files'].items():assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==digest,name
core='src/auto-reply/reply/agent-runner-core.ts'
upstream=subprocess.check_output(['git','show',os.environ['BASE_SHA']+':'+core]);assert Path(core).read_bytes()==upstream,'Do not alter upstream core for feature proof'
assert b'if (sourceDelivery === "delivered" || params.sourceReplyDeliveryState !== undefined)' not in upstream
results={}
for name,files,count in [('messaging-tests',5,99),('automatic-and-auth-tests',3,35)]:
 t=json.loads((r/(name+'.json')).read_text());assert t['success'] and t['numPassedTests']==count and t['numFailedTests']==0 and t['numPendingTests']==0 and len(t['testResults'])==files
 assert all(s['assertionResults'] and all(a['status']=='passed' for a in s['assertionResults']) for s in t['testResults'])
 results[name]={'passed':count,'files':files}
with tarfile.open(r/'openclaw-outbound.tgz') as tf:
 build=json.load(tf.extractfile('package/dist/build-info.json'));assert build['commit']==os.environ['CANDIDATE_SHA']
 for p in ['nextcloud-talk','openai']:assert tf.getmember(f'package/dist/extensions/{p}/index.js').size>0
(r/'qualification.json').write_text(json.dumps({'status':'PASS','candidate':os.environ['CANDIDATE_SHA'],'base':os.environ['BASE_SHA'],'upstreamDependencyFixPR':173798,'upstreamCoreUnmodified':True,'sourceManifestSha256':hashlib.sha256((r/'source-manifest.json').read_bytes()).hexdigest(),'packageSha256':hashlib.sha256((r/'openclaw-outbound.tgz').read_bytes()).hexdigest(),'tests':results,'baselineMissingNativeUploadControls':5,'reviewRegressionControls':9,'bundledPluginsVerified':['nextcloud-talk','openai']},indent=2)+'\n')
PY
 ;;
*) exit 2 ;;
esac
