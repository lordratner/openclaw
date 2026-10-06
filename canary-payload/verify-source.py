import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

payload=Path(os.environ['RUNNER_TEMP'])/'canary-payload'
manifest=json.loads((payload/'release-canary-source-manifest.json').read_text())
digest=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert digest(payload/'release-canary-source.patch')==manifest['patch_sha256']
assert digest(payload/'release-core-delete-seam.patch')==manifest['core_patch_sha256']
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==manifest['release_commit']
for name,expected in manifest['unchanged_contract_files'].items():
    # This one generator-owned file is permitted to change only after source
    # preparation; its plugin-only projection is staged and reviewed separately.
    if sys.argv[1]=='candidate' and name=='src/config/bundled-channel-config-metadata.generated.ts':
        continue
    assert digest(name)==expected,name
for entry in manifest['files']:
    expected=entry['release_sha256'] if sys.argv[1]=='release' else entry['candidate_sha256']
    p=Path(entry['path'])
    if expected is None:
        assert not p.exists(),str(p)
    else:
        assert digest(p)==expected,str(p)
proof=Path(os.environ['RUNNER_TEMP'])/'release-canary-proof'
(proof/(sys.argv[1]+'-source-verification.json')).write_text(json.dumps({'release_commit':manifest['release_commit'],'patch_sha256':manifest['patch_sha256'],'phase':sys.argv[1],'status':'PASS'},indent=2)+'\n')
