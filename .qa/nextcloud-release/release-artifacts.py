import hashlib,json,os,re,shutil
from pathlib import Path
proof=Path(os.environ['RUNNER_TEMP'])/'nextcloud-release-proof'
stock=Path(os.environ['RUNNER_TEMP'])/'nextcloud-release-stock-dist';seam=Path('dist')
def inventory(root):
 return {str(p.relative_to(root)):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(root.rglob('*')) if p.is_file() and 'node_modules' not in p.parts}
a=inventory(stock);b=inventory(seam)
(proof/'core-artifact-boundary.json').write_text(json.dumps({'stock':a,'seam':b,'changed':sorted(p for p in a.keys()|b.keys() if a.get(p)!=b.get(p))},indent=2)+'\n')
for label,root in [('stock',stock),('seam',seam)]:
 matches=[p for p in root.glob('runtime-channel-*.mjs') if 'function createRuntimeChannel' in p.read_text() and 'saveMediaBuffer' in p.read_text()]
 assert len(matches)==1,matches
 f=matches[0];shutil.copy2(f,proof/('core-'+label+'.mjs'))
 imports=re.findall(r'["\'](\./[^"\']+)["\']',f.read_text())
 closure={}
 for rel in imports:
  dep=f.parent/rel
  if dep.is_file():closure[rel]={'sha256':hashlib.sha256(dep.read_bytes()).hexdigest(),'bytes':dep.stat().st_size}
 (proof/('core-'+label+'-imports.json')).write_text(json.dumps({'file':f.name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'imports':closure},indent=2)+'\n')
assert 'deleteMediaBuffer' not in (proof/'core-stock.mjs').read_text()
assert 'deleteMediaBuffer' in (proof/'core-seam.mjs').read_text()
