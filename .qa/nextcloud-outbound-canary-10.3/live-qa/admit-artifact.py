#!/usr/bin/python3
"""CI-only producer/source-bound dist admission; never extracts archive links."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tarfile

assert os.environ.get('GITHUB_ACTIONS') == 'true'
baseline = '59cb44796b0f1f0daa0e37af8b1495abb45d9bc1'
artifact = Path(os.environ['CANARY_ARTIFACT_DIR'])
out = Path(os.environ['RUNNER_TEMP']) / 'nextcloud-outbound-live' / 'admitted'
assert not out.exists(), 'admission output already exists'
expected = {key: os.environ[key] for key in ['QUALIFIED_CANARY_RUN_ID', 'QUALIFIED_CANARY_QA_SHA', 'QUALIFIED_CANARY_SOURCE_SHA256', 'QUALIFIED_CANARY_DIST_SHA256']}
assert all(not value.startswith(('QUALIFIED_', 'EXACT_')) and value for value in expected.values()), 'unbound producer placeholder'
assert expected['QUALIFIED_CANARY_RUN_ID'].isdigit()
sha = lambda b: hashlib.sha256(b).hexdigest()
receipt = json.loads((artifact/'qualification.json').read_text())
assert receipt['status'] == 'PASS' and receipt['baselineCommit'] == baseline
assert receipt['qaHead'] == expected['QUALIFIED_CANARY_QA_SHA']
assert receipt['noCoreOrManifestChanges'] is True and receipt['parserSourceLinkRemoved'] is True
assert receipt['gates'] and all(value['status'] == 'PASS' for value in receipt['gates'].values())
source_bytes = (artifact/'source-manifest.json').read_bytes()
assert sha(source_bytes) == receipt['sourceManifestSha256'] == expected['QUALIFIED_CANARY_SOURCE_SHA256']
source = json.loads(source_bytes)
assert source['baselineCommit'] == baseline and source['qaHead'] == receipt['qaHead']
assert source['files'] and all(name.startswith('extensions/nextcloud-talk/') and '..' not in PurePosixPath(name).parts for name in source['files'])
assert all(name.rsplit('/',1)[-1] not in ['package.json','openclaw.plugin.json'] for name in source['files'])
dist = json.loads((artifact/'dist-manifest.json').read_text())
assert dist['status'] == 'PASS' and dist['baselineCommit'] == baseline
assert dist['sourceManifestSha256'] == sha(source_bytes)
assert dist['runtimeExternalParserImports'] is False
assert set(dist['legalNoticesIncluded']) == {'saxes/ISC','xmlchars/MIT'}
archive_bytes = (artifact/'nextcloud-talk-dist.tgz').read_bytes()
assert sha(archive_bytes) == receipt['distArtifactSha256'] == expected['QUALIFIED_CANARY_DIST_SHA256']
entries = {}
for item in dist['files']:
    p = PurePosixPath(item['path'])
    assert not p.is_absolute() and p.parts[0] == 'dist' and all(part not in ['..','.',''] for part in p.parts)
    assert str(p) == item['path'] and item['path'] not in entries
    assert item['mode'] in [0o644,0o755] and item['bytes'] >= 0
    entries[item['path']] = item
assert 'dist/index.js' in entries and 'dist/channel-plugin-api.js' in entries
seen = set()
out.mkdir(mode=0o700,parents=True)
with tarfile.open(artifact/'nextcloud-talk-dist.tgz','r:gz') as archive:
    members = archive.getmembers()
    names = set()
    for member in members:
        p = PurePosixPath(member.name)
        assert not p.is_absolute() and p.parts[0] == 'dist' and '..' not in p.parts
        assert str(p) == member.name.rstrip('/') and member.name.rstrip('/') not in names
        names.add(member.name.rstrip('/'))
        assert member.isfile() or member.isdir(), 'archive link/special entry refused'
        assert member.mode & ~0o777 == 0 and not (member.mode & 0o022), 'unsafe archive mode'
        target = out / p
        if member.isdir():
            target.mkdir(mode=0o755,parents=True,exist_ok=True)
            continue
        assert member.name in entries, 'archive contains unmanifested file'
        item = entries[member.name]
        assert member.size == item['bytes'] and member.mode == item['mode']
        data = archive.extractfile(member).read()
        assert sha(data) == item['sha256']
        target.parent.mkdir(mode=0o755,parents=True,exist_ok=True)
        with open(target,'xb') as f:
            f.write(data)
        target.chmod(item['mode'])
        seen.add(member.name)
assert seen == set(entries), 'archive missing manifested files'
admission = dict(status='PASS', baselineCommit=baseline, producerRun=expected['QUALIFIED_CANARY_RUN_ID'], producerQaHead=receipt['qaHead'],
                 sourceManifestSha256=sha(source_bytes), distArtifactSha256=sha(archive_bytes),
                 admittedDist=str(out/'dist'), distManifest=dist, scope='qualified exact-10.3 dist; no Gateway proof yet')
(out/'admission.json').write_text(json.dumps(admission,indent=2)+'\n')
print(json.dumps({key:value for key,value in admission.items() if key not in ['distManifest']}))
