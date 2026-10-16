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
for name,files,count in [('messaging-tests',5,86),('automatic-and-auth-tests',3,29)]:
 t=json.loads((r/(name+'.json')).read_text());assert t['success'] and t['numPassedTests']==count and t['numFailedTests']==0 and t['numPendingTests']==0 and len(t['testResults'])==files
 assert all(s['assertionResults'] and all(a['status']=='passed' for a in s['assertionResults']) for s in t['testResults'])
 results[name]={'passed':count,'files':files}
with tarfile.open(r/'openclaw-outbound.tgz') as tf:
 build=json.load(tf.extractfile('package/dist/build-info.json'));assert build['commit']==os.environ['CANDIDATE_SHA']
 for p in ['nextcloud-talk','openai']:assert tf.getmember(f'package/dist/extensions/{p}/index.js').size>0
(r/'qualification.json').write_text(json.dumps({'status':'PASS','candidate':os.environ['CANDIDATE_SHA'],'base':os.environ['BASE_SHA'],'upstreamDependencyFixPR':173798,'upstreamCoreUnmodified':True,'sourceManifestSha256':hashlib.sha256((r/'source-manifest.json').read_bytes()).hexdigest(),'packageSha256':hashlib.sha256((r/'openclaw-outbound.tgz').read_bytes()).hexdigest(),'tests':results,'baselineMissingNativeUploadControls':5,'bundledPluginsVerified':['nextcloud-talk','openai']},indent=2)+'\n')
PY
 ;;
*) exit 2 ;;
esac
