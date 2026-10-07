import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

base = Path(os.environ['RUNNER_TEMP'])
prior = base / 'prior-ci7'
payload = base / 'canary-payload'
proof = base / 'release-canary-proof'
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
ledger = read(payload / 'CI7-GATE-LEDGER.json')
assert (prior / 'workflow-commit.txt').read_text().strip() == ledger['workflowCommit']
assert sha(prior / 'source-manifest.json') == ledger['sourceManifestSha256']
assert sha(payload / 'release-canary-source-manifest.json') == ledger['sourceManifestSha256']
assert sha(payload / 'release-canary-source.patch') == ledger['sourcePatchSha256']
assert sha(Path('scripts/check-changed.mts')) == ledger['canonicalPlannerSha256']
assert sha(prior / 'changed-check.log') == ledger['changedCheckLogSha256']
assert not (prior / 'qualification.txt').exists()
assert not (prior / 'plugin-profile.log').exists()
for phase in ('release', 'candidate'):
    p = read(prior / (phase + '-source-verification.json'))
    assert p['status'] == 'PASS' and p['patch_sha256'] == ledger['sourcePatchSha256']

def inventory(root, expected):
    files = {str(p.relative_to(root)): p for p in root.rglob('*')
             if p.is_file() and 'node_modules' not in p.parts}
    assert files.keys() == expected.keys(), 'artifact file-set mismatch'
    for name, p in files.items():
        assert sha(p) == expected[name]['sha256'] and p.stat().st_size == expected[name]['bytes'], name
    return len(files)

core = read(prior / 'core-artifact-boundary.json')
plugin = read(prior / 'plugin-artifact-manifest.json')
assert inventory(prior / 'core-stock-dist', core['stock']) == 7032
assert inventory(prior / 'core-seam-dist', core['candidate_seam']) == 7032
assert inventory(prior / 'plugin-overlay', plugin['files']) == 16
assert plugin['runtimeDependenciesUnchanged'] is True
assert read(prior / 'generated-metadata-boundary.json') == {'changedPluginConfigs': ['nextcloud-talk'], 'status': 'PASS'}
text = re.sub(r'\x1b\[[0-9;]*m', '', (prior / 'changed-check.log').read_text())
text = text[text.index('[check:changed] conflict markers'):]
names = re.findall(r'^\[check:changed\] (.+)$', text, re.M)
assert names[:-1] == ledger['completedCheckNames'] and names[-1] == ledger['interruptedCheck']
assert len(names[:-1]) == 39 and text.rstrip().endswith('scripts/check-no-pairing-store-group-auth.mts')
for file, expected_files, expected_tests in [('talk-tests.log', 30, 281), ('matrix-fixture-tests.log', 2, 6)]:
    log = re.sub(r'\x1b\[[0-9;]*m', '', (prior / file).read_text())
    assert re.search(r'Test Files\s+' + str(expected_files) + r' passed', log)
    assert re.search(r'Tests\s+' + str(expected_tests) + r' passed', log)
assert len(re.findall(r'^\[tsgo:[^\]]+\] passed', text, re.M)) == 27
assert all('Knip ' + mode + ' unused-export scan passed with 0 entries.' in text
           for mode in ('production', 'full-tree', 'script'))

# Keep every prior input receipt immutable in its own namespace. Reuse only
# verified compiled artifacts; no previous tests or guards are rerun here.
inherited = proof / 'inherited-ci7'
inherited.mkdir()
for p in prior.iterdir():
    if p.is_file():
        shutil.copy2(p, inherited / p.name)
for name in ('core-stock-dist', 'core-seam-dist', 'plugin-overlay', 'stock-generated',
             'stock-doc-baseline', 'generated-doc-baseline'):
    shutil.copytree(prior / name, proof / name)
for name in ('source-manifest.json', 'core-artifact-boundary.json', 'plugin-artifact-manifest.json',
             'generated-metadata-boundary.json', 'generated-doc-baseline-boundary.json',
             'talk-tests.log', 'matrix-fixture-tests.log', 'matrix-fixture-test-boundary.json'):
    shutil.copy2(prior / name, proof / name)
shutil.copy2(payload / 'CI7-GATE-LEDGER.json', proof / 'prior-gate-ledger.json')
if Path('dist').exists():
    Path('dist').rename(base / 'setup-generated-dist-not-used')
shutil.copytree(prior / 'core-seam-dist', 'dist')
inventory(Path('dist'), core['candidate_seam'])
(proof / 'prior-input-verification.json').write_text(json.dumps({
    'status': 'PASS', 'priorRun': ledger['run'], 'sourceManifestSha256': ledger['sourceManifestSha256'],
    'sourcePatchSha256': ledger['sourcePatchSha256'], 'completedCanonicalChecks': 39,
    'sameCompiledInputsRestored': True, 'testsRerun': False, 'fullChangedCheckRerun': False,
}, indent=2) + '\n')
print('Exact-source prior tests, 39 completed canonical checks and complete compiled inventories verified.')
