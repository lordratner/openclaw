"""GitHub-runner-only candidate snapshot and exact canonical profile layout."""
import hashlib,json,os,shutil,subprocess
from pathlib import Path
b=Path(os.environ['RUNNER_TEMP']);p=b/'release-canary-proof';payload=b/'canary-payload'
read=lambda f:json.loads(f.read_text());sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
m=read(payload/'release-canary-source-manifest.json');release=m['release_commit']
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==release
assert subprocess.run(['git','symbolic-ref','-q','HEAD'],capture_output=True).returncode==1
assert not subprocess.check_output(['git','diff','--cached','--name-only'],text=True).strip()
paths=[e['path'] for e in m['files']]+['src/config/bundled-channel-config-metadata.generated.ts','docs/.generated/config-baseline.sha256','docs/.generated/config-baseline.counts.json']
changed=set(subprocess.check_output(['git','diff','--name-only'],text=True).splitlines())
assert changed.issubset(paths),changed-set(paths)
subprocess.run(['git','add','--',*paths],check=True)
tree=subprocess.check_output(['git','write-tree'],text=True).strip()
env={**os.environ,'GIT_AUTHOR_NAME':'Canary CI snapshot','GIT_AUTHOR_EMAIL':'canary-ci@invalid','GIT_COMMITTER_NAME':'Canary CI snapshot','GIT_COMMITTER_EMAIL':'canary-ci@invalid'}
commit=subprocess.check_output(['git','commit-tree',tree,'-p',release],input='Ephemeral exact candidate profile snapshot; never published\n',text=True,env=env).strip()
subprocess.run(['git','update-ref','HEAD',commit,release],check=True)
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],text=True).strip()
(p/'profile-source-snapshot.json').write_text(json.dumps({'status':'PASS','commit':commit,'tree':tree,'releaseCommit':release,'sourceManifestSha256':sha(payload/'release-canary-source-manifest.json'),'localRunnerOnly':True,'published':False,'sourceBytesChanged':False},indent=2)+'\n')
stock=Path('dist/extensions/nextcloud-talk');saved=b/'diagnostic-stock-nextcloud-root-output';assert stock.is_dir();stock.rename(saved);stock.mkdir()
# Retain canonical root package projection/assets, replace only byte-bound
# candidate output and generated schema. No production artifacts are changed.
for name in ('package.json','README.md'):
 shutil.copy2(saved/name,stock/name)
shutil.copytree(saved/'assets',stock/'assets')
# Package-local builds resolve this workspace host link naturally. The diagnostic
# root profile directory needs the identical public host package identity.
host=Path.cwd();hostpkg=read(host/'package.json');assert hostpkg['name']=='openclaw'
assert hostpkg['exports']['./plugin-sdk/channel-entry-contract']['default']=='./dist/plugin-sdk/channel-entry-contract.js'
assert (host/'dist/plugin-sdk/channel-entry-contract.js').is_file()
(stock/'node_modules').mkdir();(stock/'node_modules/openclaw').symlink_to(host,target_is_directory=True)
assert (stock/'node_modules/openclaw').resolve()==host

plugin=read(p/'plugin-artifact-manifest.json');count=0
for name,entry in plugin['files'].items():
 if name.startswith('dist/'):
  src=p/'plugin-overlay'/name;assert sha(src)==entry['sha256'];dest=stock/name[5:];dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest);assert sha(dest)==entry['sha256'];count+=1
assert count==14
shutil.copy2(p/'plugin-overlay/openclaw.plugin.json',stock/'openclaw.plugin.json')
(p/'profile-root-overlay-binding.json').write_text(json.dumps({'status':'PASS','candidateFilesVerified':count,'rootEntrySha256':sha(stock/'index.js'),'metadataSha256':sha(stock/'openclaw.plugin.json'),'stockPackageProjectionPreserved':True,'hostPackageLinkVerified':True,'diagnosticOnly':True,'liveChanged':False},indent=2)+'\n')
print('Clean ephemeral exact candidate snapshot and canonical root profile entry prepared; source/output bytes preserved.')
