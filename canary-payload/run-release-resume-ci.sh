#!/usr/bin/env bash
# GitHub-only exact-input continuation. No source/policy changes or local fallback.
set -euo pipefail
payload="$RUNNER_TEMP/canary-payload"
proof="$RUNNER_TEMP/release-canary-proof"
prior="$RUNNER_TEMP/prior-ci7"
mkdir -p "$proof" "$prior"
cp "$payload/workflow-commit.txt" "$proof/workflow-commit.txt"
gh api repos/lordratner/openclaw/actions/artifacts/11454831223 > "$proof/prior-artifact-metadata.json"
gh api repos/lordratner/openclaw/actions/runs/37551148253/artifacts > "$proof/prior-run-artifacts.json"
python3 - <<'METADATA'
import json,os
from pathlib import Path
m=json.loads((Path(os.environ['RUNNER_TEMP'])/'release-canary-proof/prior-artifact-metadata.json').read_text())
assert m['id']==11454831223 and not m['expired']
assert m['name']=='nextcloud-talk-release-9_8-37551148253'
assert m['digest']=='sha256:38fd6848e0bd4c1abff3fed4dd60eb3340f21cc3a8de81fee270c952a469ed7f'
assert m['workflow_run']['id']==37551148253
assert m['workflow_run']['head_sha']=='28ac6f88653680ee138c1902b9d4ac4de1e0d40b'
xs=json.loads((Path(os.environ['RUNNER_TEMP'])/'release-canary-proof/prior-run-artifacts.json').read_text())['artifacts']
assert [x['id'] for x in xs if x['name']==m['name'] and not x['expired']]==[11454831223]
METADATA
gh run download 37551148253 --repo lordratner/openclaw --name nextcloud-talk-release-9_8-37551148253 --dir "$prior"
python3 "$payload/verify-prior-qualification.py"
python3 "$payload/verify-source.py" release
git apply --check "$payload/release-canary-source.patch"
git apply "$payload/release-canary-source.patch"
python3 "$payload/verify-source.py" candidate
test -f node_modules/.pnpm/saxes@6.0.0/node_modules/saxes/package.json
test ! -e node_modules/saxes
ln -s .pnpm/saxes@6.0.0/node_modules/saxes node_modules/saxes
pnpm config:channels:gen 2>&1 | tee "$proof/channel-config-generator.log"
pnpm config:docs:gen 2>&1 | tee "$proof/config-doc-baseline-generator.log"
python3 - <<'BASELINE'
import hashlib,os
from pathlib import Path
p=Path(os.environ['RUNNER_TEMP'])/'prior-ci7/generated-doc-baseline'
for file in p.iterdir():
    assert file.read_bytes()==(Path('docs/.generated')/file.name).read_bytes(), file.name
print('All approved generated baseline bytes match the exact-source prior build.')
BASELINE
# Rebuild only the canonical plugin, then require every emitted byte to match
# CI7. Reused core compilation remains diagnostic input, never live deployment.
node scripts/lib/plugin-npm-runtime-build.mjs extensions/nextcloud-talk 2>&1 | tee "$proof/plugin-build.log"
node --import ./scripts/tsx.mjs "$payload/stage-plugin.mts"
python3 - <<'OVERLAY'
import json,os
from pathlib import Path
b=Path(os.environ['RUNNER_TEMP']);a=b/'prior-ci7';p=b/'release-canary-proof'
assert json.loads((a/'plugin-artifact-manifest.json').read_text())==json.loads((p/'plugin-artifact-manifest.json').read_text())
assert (a/'generated-metadata-boundary.json').read_bytes()==(p/'generated-metadata-boundary.json').read_bytes()
m=json.loads((p/'plugin-artifact-manifest.json').read_text())
for name in m['files']:assert (a/'plugin-overlay'/name).read_bytes()==(p/'plugin-overlay'/name).read_bytes(),name
print('Canonical candidate plugin and generated schema remain byte-identical to CI7.')
OVERLAY
node --import ./scripts/tsx.mjs "$payload/resume-canonical-checks.mjs" 2>&1 | tee "$proof/resumed-check.log"
# The profiler prefers dist/extensions stock output. Move that stale diagnostic
# plugin aside ONLY ON THE RUNNER so its public resolver selects the canonical
# candidate package-local build. Assert the selected entry and all14 bytes.
python3 - <<'PROFILE_INPUT'
import hashlib,json,os
from pathlib import Path
b=Path(os.environ['RUNNER_TEMP']);p=b/'release-canary-proof';m=json.loads((p/'plugin-artifact-manifest.json').read_text())
stock=Path('dist/extensions/nextcloud-talk');assert stock.is_dir()
stock.rename(b/'diagnostic-stock-nextcloud-root-output')
assert sum(name.startswith('dist/') for name in m['files'])==14
for name,entry in m['files'].items():
    if name.startswith('dist/'):
        f=Path('extensions/nextcloud-talk')/name
        assert hashlib.sha256(f.read_bytes()).hexdigest()==entry['sha256'],name
PROFILE_INPUT
node --import ./scripts/tsx.mjs --input-type=module - <<'SELECTED'
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { findBuiltExtensionMemoryEntries } from './scripts/ensure-extension-memory-build.mts';
const actual=findBuiltExtensionMemoryEntries().find(x=>x.dir==='nextcloud-talk');
assert(actual);
assert.equal(path.resolve(actual.file),path.resolve('extensions/nextcloud-talk/dist/index.js'));
writeFileSync(path.join(process.env.RUNNER_TEMP,'release-canary-proof/profile-candidate-entry-proof.json'),JSON.stringify({status:'PASS',entry:actual.file,canonicalOverlayFilesVerified:14,staleStockRootOutputSelected:false,liveChange:false},null,2)+'\n');
SELECTED
OPENCLAW_LOCAL_CHECK=0 node --import ./scripts/tsx.mjs scripts/profile-extension-memory.mts --extension nextcloud-talk --skip-combined --concurrency 1 --json "$proof/plugin-profile.json" 2>&1 | tee "$proof/plugin-profile.log"
python3 "$payload/verify-source.py" candidate
python3 - <<'QUALIFIED'
import json,os
from pathlib import Path
p=Path(os.environ['RUNNER_TEMP'])/'release-canary-proof'
g=json.loads((p/'resumed-canonical-checks.json').read_text());r=json.loads((p/'plugin-profile.json').read_text());e=json.loads((p/'profile-candidate-entry-proof.json').read_text())
assert g['status']=='PASS' and g['totalChecks']==41
assert r['qualification']['qualified'] is True and r['selectedExtensions']==['nextcloud-talk']
assert r['counts']=={'totalEntries':1,'ok':1,'fail':0,'timeout':0}
assert len(r['results'])==1 and r['results'][0]['file']==e['entry']
assert r['results'][0]['status']=='ok' and r['results'][0]['completion']=='imports'
q={'status':'PASS','scope':'composite-exact-source-qualification','sourceManifestSha256':g['sourceManifestSha256'],'priorRun':37551148253,'priorWorkflowCommit':'28ac6f88653680ee138c1902b9d4ac4de1e0d40b','workflowCommit':(p/'workflow-commit.txt').read_text().strip(),'inheritedCanonicalChecks':39,'resumedCanonicalChecks':2,'totalCanonicalChecks':41,'talkTests':281,'matrixTests':6,'coldImportProfileQualified':True,'candidateProfileEntryVerified':True,'singleWholeChangedCheckInvocationPassed':False,'liveActivation':False}
(p/'composite-qualification.json').write_text(json.dumps(q,indent=2)+'\n')
(p/'qualification.txt').write_text('Composite exact-source qualification PASS: 39 inherited canonical checks, 2 resumed canonical checks, candidate cold-import profile. Prior whole run timed out; this is not a single successful whole changed-check invocation.\n')
QUALIFIED
