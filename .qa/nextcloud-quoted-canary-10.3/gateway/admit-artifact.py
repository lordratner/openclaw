#!/usr/bin/python3
"""Secretless CI admission: root-reviewed immutable producer packet; no archive links."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tarfile
import urllib.request

assert os.environ.get('GITHUB_ACTIONS') == 'true'
base = '59cb44796b0f1f0daa0e37af8b1495abb45d9bc1'
qa = Path(__file__).resolve().parent
binding_bytes = (qa/'binding.json').read_bytes()
binding = json.loads(binding_bytes)
sha = lambda b: hashlib.sha256(b).hexdigest()
for key, pattern in [('producerRun',r'[0-9]+'),('producerQaHead',r'[a-f0-9]{40}'),('sourceManifestSha256',r'[a-f0-9]{64}'),('distArtifactSha256',r'[a-f0-9]{64}'),('qualificationSha256',r'[a-f0-9]{64}')]:
    assert re.fullmatch(pattern,str(binding[key])), f'unbound or malformed {key}'
assert binding['baselineCommit'] == base
assert binding['requiredGates'] and binding['testReports'], 'unbound gates/tests'
assert binding['producerRepository'] == 'lordratner/openclaw'
assert binding['artifactName'] == 'nextcloud-quoted-canary-10.3-'+binding['producerRun']
request=urllib.request.Request(f"https://api.github.com/repos/{binding['producerRepository']}/actions/runs/{binding['producerRun']}",headers={'Accept':'application/vnd.github+json','Authorization':'Bearer '+os.environ['GH_TOKEN']})
with urllib.request.urlopen(request,timeout=30) as response:
    run=json.load(response)
assert str(run['id']) == binding['producerRun'] and run['head_sha'] == binding['producerQaHead']
assert run['status'] == 'completed' and run['conclusion'] == 'success'
assert run['head_repository']['full_name'] == binding['producerRepository']
artifact = Path(os.environ['CANARY_ARTIFACT_DIR'])
out = Path(os.environ['RUNNER_TEMP'])/'nextcloud-quotes-live'/'admitted'
assert not out.exists()
receipt_bytes=(artifact/'qualification.json').read_bytes()
assert sha(receipt_bytes)==binding['qualificationSha256']
receipt=json.loads(receipt_bytes)
assert receipt['status']=='PASS' and receipt['baselineCommit']==base and receipt['qaHead']==binding['producerQaHead']
assert receipt['freshOnly'] is binding['producerFreshOnly'] and receipt['noCoreOrManifestChanges'] is True and receipt['parserSourceLinkRemoved'] is True
assert binding['producerFreshOnly'] is False and receipt['qualificationMode']=='bounded-test-only-delta'
assert set(receipt['gates'])==set(binding['requiredGates'])
assert set(binding['gateEvidence'])==set(binding['requiredGates'])
assert all(g['status']=='PASS' and g['evidence']==binding['gateEvidence'][name] for name,g in receipt['gates'].items())
for key,value in binding['receiptAssertions'].items():
    assert receipt[key]==value, key
assert {c['label'] for c in receipt['commands'] if c['code']!=0}==set(binding['expectedFailureCommands'])
assert all(c['timedOut'] is False for c in receipt['commands'])
for report,counts in binding['testReports'].items():
    tests=json.loads((artifact/report).read_text())
    assert tests['success'] is True and tests['numFailedTests']==tests['numPendingTests']==0
    assert tests['numPassedTests']==sum(counts.values())
    suites={Path(s['name']).name:s for s in tests['testResults']}
    assert len(suites)==len(tests['testResults']) and set(suites)==set(counts)
    for name,count in counts.items():
        assertions=suites[name]['assertionResults']
        assert len(assertions)==count and all(a['status']=='passed' for a in assertions)
source_bytes=(artifact/'source-manifest.json').read_bytes()
assert sha(source_bytes)==receipt['sourceManifestSha256']==binding['sourceManifestSha256']
source=json.loads(source_bytes)
assert source['baselineCommit']==base and source['qaHead']==binding['producerQaHead']
assert source['files']
for name,hash_value in source['files'].items():
    p=PurePosixPath(name)
    assert str(p)==name and not p.is_absolute() and '..' not in p.parts
    assert name.startswith('extensions/nextcloud-talk/') and p.name not in ['package.json','openclaw.plugin.json','config-schema.ts']
    assert re.fullmatch(r'[a-f0-9]{64}',hash_value)
dist=json.loads((artifact/'dist-manifest.json').read_text())
assert dist['status']=='PASS' and dist['baselineCommit']==base and dist['sourceManifestSha256']==sha(source_bytes)
assert dist['runtimeExternalParserImports'] is False and set(dist['legalNoticesIncluded'])=={'saxes/ISC','xmlchars/MIT'}
archive_bytes=(artifact/'nextcloud-talk-dist.tgz').read_bytes()
assert sha(archive_bytes)==receipt['distArtifactSha256']==binding['distArtifactSha256']
entries={}
for item in dist['files']:
    p=PurePosixPath(item['path'])
    assert not p.is_absolute() and p.parts[0]=='dist' and all(part not in ['..','.',''] for part in p.parts)
    assert str(p)==item['path'] and item['path'] not in entries
    assert item['mode'] in [0o644,0o755] and item['bytes']>=0 and re.fullmatch(r'[a-f0-9]{64}',item['sha256'])
    entries[item['path']]=item
assert 'dist/index.js' in entries and 'dist/channel-plugin-api.js' in entries
seen=set()
out.mkdir(mode=0o700,parents=True)
with tarfile.open(artifact/'nextcloud-talk-dist.tgz','r:gz') as archive:
    names=set()
    for member in archive.getmembers():
        p=PurePosixPath(member.name)
        assert not p.is_absolute() and p.parts[0]=='dist' and '..' not in p.parts
        assert str(p)==member.name.rstrip('/') and member.name.rstrip('/') not in names
        names.add(member.name.rstrip('/'))
        assert member.isfile() or member.isdir(), 'archive link/special entry refused'
        assert member.mode & ~0o777==0 and not(member.mode&0o022)
        target=out/p
        if member.isdir():
            target.mkdir(mode=0o755,parents=True,exist_ok=True)
            continue
        assert member.name in entries
        item=entries[member.name]
        assert member.size==item['bytes'] and member.mode==item['mode']
        data=archive.extractfile(member).read()
        assert sha(data)==item['sha256']
        target.parent.mkdir(mode=0o755,parents=True,exist_ok=True)
        with open(target,'xb') as f:
            f.write(data)
        target.chmod(item['mode'])
        seen.add(member.name)
assert seen==set(entries)
admission=dict(status='PASS',baselineCommit=base,producerRun=binding['producerRun'],producerQaHead=binding['producerQaHead'],sourceManifestSha256=sha(source_bytes),distArtifactSha256=sha(archive_bytes),qualificationSha256=sha(receipt_bytes),bindingSha256=sha(binding_bytes),admittedDist=str(out/'dist'),distManifest=dist,scope='qualified exact10.3 composed dist; no Gateway proof yet')
(out/'admission.json').write_text(json.dumps(admission,indent=2)+'\n')
evidence=out.parent/'evidence'
evidence.mkdir(parents=True,exist_ok=True)
(evidence/'producer-admission.json').write_text(json.dumps(admission,indent=2)+'\n')
for name in ['source-manifest.json','qualification.json','dist-manifest.json']:
    (evidence/('producer-'+name)).write_bytes((artifact/name).read_bytes())
print(json.dumps({k:v for k,v in admission.items() if k!='distManifest'}))
