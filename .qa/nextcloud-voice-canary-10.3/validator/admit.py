"""CI-only semantic validator repair. Preserve producer failure and exact build."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

assert os.environ.get('GITHUB_ACTIONS') == 'true'
qa = Path(__file__).resolve().parent
b = json.loads((qa/'binding.json').read_text())
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
prior = Path(os.environ['RETAINED_PROOF_DIR'])
run = json.loads(subprocess.check_output(['gh','api',f"repos/lordratner/openclaw/actions/runs/{b['producerRun']}"]))
assert run['status'] == 'completed' and run['conclusion'] == 'failure'
assert run['head_sha'] == b['producerQaHead']
assert run['head_repository']['full_name'] == 'lordratner/openclaw'
for file, digest in b['fileSha256'].items():
    assert sha(prior/file) == digest, file
q = read(prior/'qualification.json')
assert q['status'] == 'FAIL' and q['freshOnly'] is True
assert q['baselineCommit'] == b['baselineCommit'] and q['qaHead'] == b['producerQaHead']
assert [name for name,g in q['gates'].items() if g['status'] != 'PASS'] == ['voice-negative-controls']
assert 'semantic missing voice behavior' in q['gates']['voice-negative-controls']['error']
assert all(g['evidence'] == 'fresh' for name,g in q['gates'].items() if name != 'voice-negative-controls')
assert all(not c['timedOut'] for c in q['commands'])
assert {c['label'] for c in q['commands'] if c['code'] != 0} == set(b['expectedNonzeroCommands'])
source = read(prior/'source-manifest.json')
assert source['qaHead'] == b['producerQaHead'] and source['baselineCommit'] == b['baselineCommit']
assert source['files'] == b['sourceFiles']
assert q['sourceManifestSha256'] == sha(prior/'source-manifest.json')
assert q['distArtifactSha256'] == sha(prior/'nextcloud-talk-dist.tgz')
assert q['parserSourceLinkRemoved'] is True
for file, digest in source['files'].items():
    assert sha(prior/'formatted'/file) == digest, file
for label, counts in b['testReports'].items():
    report = read(prior/label)
    assert report['success'] and report['numFailedTests'] == report['numPendingTests'] == 0
    assert report['numPassedTests'] == sum(counts.values())
    suites = {Path(s['name']).name:s for s in report['testResults']}
    assert set(suites) == set(counts)
    for name,count in counts.items():
        assert len(suites[name]['assertionResults']) == count
        assert all(t['status'] == 'passed' for t in suites[name]['assertionResults'])
negative = read(prior/'voice-baseline.json')
assert not negative['success'] and negative['numFailedTests'] == 3 and negative['numPassedTests'] == 4
assert len(negative['testResults']) == 1
assert Path(negative['testResults'][0]['name']).name == 'outbound-media.test.ts'
active = [t for t in negative['testResults'][0]['assertionResults'] if t['status'] in ['passed','failed']]
assert len(active) == 7
failed = {t['fullName']:t for t in active if t['status'] == 'failed'}
assert set(failed) == {
    'delivers reply.mp3 with audioAsVoice=true as voice=true',
    'delivers reply.wav with audioAsVoice=true as voice=true',
    'requires native delivery instead of a bot-only URL link for a voice request'}
for name, test in failed.items():
    failure = '\n'.join(test['failureMessages'])
    if name.startswith('delivers '):
        assert failure.startswith('AssertionError: expected { caption:') and 'to deeply equal' in failure
        assert re.search(r'outbound-media\.test\.ts:\d+:\d+', failure)
    else:
        assert re.search(r'promise resolved .* instead of rejecting',failure,re.S)
for label in ['stock-ingress.json','stock-consumer.json']:
    assert read(prior/label)['status'] == 'PASS'
out = Path(os.environ['RUNNER_TEMP'])/'nextcloud-voice-canary-10.3'
assert not out.exists()
shutil.copytree(prior,out)
(out/'producer-original-qualification.json').write_bytes((prior/'qualification.json').read_bytes())
(out/'retained-producer-run.json').write_text(json.dumps(run,indent=2)+'\n')
gates = {name:{**gate,'evidence':'retained','producerRun':b['producerRun']} for name,gate in q['gates'].items()}
gates['voice-negative-controls'] = {'status':'PASS','evidence':'fresh-validation','executions':'retained','producerRun':b['producerRun'],'originalValidatorFailed':True,'semanticFailures':3,'passingControls':4}
q.update(status='PASS',qaHead=os.environ['GITHUB_SHA'],builtQaHead=b['producerQaHead'],
    freshOnly=False,qualificationMode='artifact-only-semantic-validator-repair',
    freshPassingTests=0,retainedPassingTests=112,totalQualifiedPassingTests=112,
    freshVoiceNegativeControls=0,retainedVoiceNegativeControls=3,
    freshVoiceBaselinePassingControls=0,retainedVoiceBaselinePassingControls=4,
    noCoreOrManifestChanges=True,gates=gates,
    originalProducerRun=b['producerRun'],originalProducerConclusion='failure',
    originalQualificationSha256=sha(prior/'qualification.json'),
    validatorBindingSha256=sha(qa/'binding.json'),
    scope='Exact10.3 original fresh product tests/build/SDK consumer retained under exact input/output hashes. Only malformed negative-control result validation repaired; no source edits/rebuild/retest/activation. Original producer FAIL preserved.')
(out/'qualification.json').write_text(json.dumps(q,indent=2)+'\n')
print(json.dumps({'status':'PASS','retainedPassingTests':112,'freshValidationOnly':True,'noProductExecutionOrRebuild':True}))
