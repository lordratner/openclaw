#!/usr/bin/env bash
set -euo pipefail
proof="$RUNNER_TEMP/nextcloud-outbound-proof"
mkdir -p "$proof"
export OPENCLAW_BUNDLED_PLUGIN_BUILD_IDS=nextcloud-talk
export OPENCLAW_VITEST_MAX_WORKERS=1
export NODE_OPTIONS=--max-old-space-size=8192
case "$1" in
prepare)
  python3 - <<'PY'
import hashlib,json,os,shutil,subprocess
from pathlib import Path
prior=Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-prior';out=Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-proof'
manifest=json.loads((prior/'source-manifest.json').read_text())
assert manifest['candidate']=='9f32c6d84a807ebc1aff1eed3cef68d1e4ef46cd'
for name,digest in manifest['files'].items():assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==digest,name
for label,count in [('direct',2),('automatic',3)]:
 result=json.loads((prior/f'baseline-{label}.json').read_text());assert result['numFailedTests']==count
 for suffix in ['json','log']:shutil.copy2(prior/f'baseline-{label}.{suffix}',out/f'retained-baseline-{label}.{suffix}')
result=json.loads((prior/'messaging-tests.json').read_text());assert result['numPassedTests']==85 and result['numFailedTests']==1
shutil.copy2(prior/'messaging-tests.json',out/'retained-messaging-tests.json')
shutil.copy2(prior/'lint.log',out/'retained-lint.log')
paths=json.load(open('.proof-tools/.qa/nextcloud-outbound/paths.json'))
subprocess.run(['pnpm','exec','oxfmt','--write',*paths],check=True)
for name in paths:
 target=out/'formatted'/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(Path(name).read_bytes())
(out/'source-manifest.json').write_text(json.dumps({'candidate':os.environ['CANDIDATE_SHA'],'base':manifest['base'],'files':{p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in paths}},indent=2)+'\n')
(out/'retained-proof.json').write_text(json.dumps({'producerRun':38857234209,'productionBytesUnchanged':True,'passingMessagingTestsRetained':80,'securityCasesSuperseded':6,'baselineControlsRetained':5,'lintRetainedExceptUpdatedSecurityFixture':True},indent=2)+'\n')
PY
  git diff --binary > "$proof/format.patch"
  ;;
security)
  node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-messaging.config.ts extensions/nextcloud-talk/src/inbound-media.security.test.ts --maxWorkers=1 --reporter=json --outputFile="$proof/security-tests.json" 2>&1 | tee "$proof/security-tests.log"
  ;;
automatic)
  node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-database-workers.config.ts extensions/nextcloud-talk/src/inbound.behavior.test.ts extensions/nextcloud-talk/src/inbound.authz.test.ts extensions/nextcloud-talk/src/inbound-media.mentions.test.ts --maxWorkers=1 --reporter=json --outputFile="$proof/automatic-and-auth-tests.json" 2>&1 | tee "$proof/automatic-and-auth-tests.log"
  ;;
lint)
  node scripts/run-oxlint.mjs --tsconfig extensions/tsconfig.json extensions/nextcloud-talk/src/inbound-media.security.test.ts 2>&1 | tee "$proof/security-fixture-lint.log"
  ;;
profile)
  OPENCLAW_LOCAL_CHECK=0 node --import ./scripts/tsx.mjs scripts/profile-extension-memory.mts --extension nextcloud-talk --skip-combined --concurrency 1 2>&1 | tee "$proof/plugin-profile.log"
  ;;
finalize)
  python3 - <<'PY'
import hashlib,json,os,tarfile
from pathlib import Path
root=Path(os.environ['RUNNER_TEMP'])/'nextcloud-outbound-proof'
gates=json.loads(os.environ['QUALIFICATION_GATES'])
(root/'gate-status.json').write_text(json.dumps(gates,indent=2)+'\n')
assert all(value=='success' for value in gates.values()),gates
manifest=json.loads((root/'source-manifest.json').read_text())
for name,digest in manifest['files'].items():assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==digest,name
tests={}
for name,count in [('security-tests',1),('automatic-and-auth-tests',3)]:
 result=json.loads((root/(name+'.json')).read_text());assert result['success'] and result['numFailedTests']==0 and len(result['testResults'])==count
 assert all(suite['assertionResults'] and all(case['status']=='passed' for case in suite['assertionResults']) for suite in result['testResults']),(name,result)
 assert result['numPassedTests']==6 if name=='security-tests' else result['numPassedTests']>=6,(name,result)
 tests[name]={'passed':result['numPassedTests'],'files':count}
with tarfile.open(root/'openclaw-outbound.tgz') as archive:
 build=json.load(archive.extractfile('package/dist/build-info.json'));assert build['commit']==os.environ['CANDIDATE_SHA']
 for name in ['nextcloud-talk','openai']:
  assert json.load(archive.extractfile(f'package/dist/extensions/{name}/openclaw.plugin.json'))['id']==name
  assert archive.getmember(f'package/dist/extensions/{name}/index.js').size>0
(root/'qualification.json').write_text(json.dumps({'status':'PASS','candidate':os.environ['CANDIDATE_SHA'],'sourceManifestSha256':hashlib.sha256((root/'source-manifest.json').read_bytes()).hexdigest(),'packageSha256':hashlib.sha256((root/'openclaw-outbound.tgz').read_bytes()).hexdigest(),'freshTests':tests,'retainedPassingTests':80,'retainedBaselineControls':5,'bundledPluginsVerified':['nextcloud-talk','openai']},indent=2)+'\n')
PY
  ;;
*) exit 2 ;;
esac
