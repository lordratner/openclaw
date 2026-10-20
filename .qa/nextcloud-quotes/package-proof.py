import os,json,pathlib,subprocess,time,hashlib,tarfile,re,shutil
source=os.environ['SOURCE_SHA'];assert re.fullmatch('[0-9a-f]{40}',source);root=pathlib.Path.cwd();proof=pathlib.Path(os.environ['RUNNER_TEMP'])/'quoted-replies-installed';proof.mkdir(exist_ok=True);tools=root/'.proof-tools/.qa/nextcloud-quotes';retained=root/'.retained-qualification';q=json.loads((retained/'qualification.json').read_text());assert q['status']=='PASS';assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==source
for name,digest in q['testedSourceHashes'].items():assert hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest()==digest,name
if source!=q['candidate']:
 assert subprocess.check_output(['git','rev-parse','HEAD^'],text=True).strip()==q['candidate']
 assert set(subprocess.check_output(['git','diff-tree','--no-commit-id','--name-only','-r','HEAD'],text=True).splitlines())<=set(q['testedSourceHashes'])
shutil.copyfile(retained/'qualification.json',proof/'retained-source-qualification.json');steps=[]
def run(label,args,env=None):
 start=time.monotonic()
 with (proof/(label+'.log')).open('w') as log:r=subprocess.run(args,env=env,stdout=log,stderr=subprocess.STDOUT)
 steps.append({'label':label,'code':r.returncode,'wallSeconds':round(time.monotonic()-start,3)});(proof/'steps.json').write_text(json.dumps(steps,indent=2)+'\n')
 return r.returncode
env=dict(os.environ);env.pop('OPENCLAW_BUNDLED_PLUGIN_BUILD_IDS',None)
package=proof/'quoted-replies.tgz';args=['node','scripts/package-openclaw-for-docker.mjs','--bundle-plugin','nextcloud-talk','--bundle-plugin','openai','--allow-unreleased-changelog','--output-dir',str(proof),'--output-name',package.name,'--pack-json',str(proof/'pack.json')];assert run('canonical-package',args,env)==0
with tarfile.open(package) as archive:
 build=json.load(archive.extractfile('package/dist/build-info.json'));assert build['commit']==source,build
 for plugin in ['nextcloud-talk','openai']:assert json.load(archive.extractfile('package/dist/extensions/'+plugin+'/openclaw.plugin.json'))['id']==plugin
packageSha=hashlib.sha256(package.read_bytes()).hexdigest();(proof/'package-identity.json').write_text(json.dumps({'source':source,'sha256':packageSha,'buildInfo':build},indent=2)+'\n')
prefix=pathlib.Path(os.environ['RUNNER_TEMP'])/'quoted-installed-prefix';assert run('install-package',['npm','install','--prefix',str(prefix),'--no-audit','--no-fund',str(package)])==0
entry=prefix/'node_modules/openclaw/openclaw.mjs';version=json.loads(pathlib.Path('package.json').read_text())['version'];env.update(OPENCLAW_QA_SOURCE_ROOT=str(root),OPENCLAW_QA_SOURCE_SHA=source,OPENCLAW_QA_EXPECTED_VERSION=version,OPENCLAW_QA_PACKAGE_TARBALL=str(package),OPENCLAW_QA_PACKAGE_SHA256=packageSha)
code=run('installed-gateway',['node',str(tools/'gateway-proof.mjs'),str(entry)],env)
log=(proof/'installed-gateway.log').read_text();matches=re.findall(r'^Evidence: (.+)$',log,re.M)
if matches:
 assert len(matches)==1;where=pathlib.Path(matches[0]).resolve();assert where.is_relative_to(pathlib.Path(os.environ['RUNNER_TEMP']).resolve());shutil.copytree(where,proof/'gateway',dirs_exist_ok=True)
assert code==0,'Installed Gateway fixture failed; original logs retained'
gateway=json.loads((proof/'gateway/qualification.json').read_text());assert gateway['status']=='PASS' and gateway['sourceSha']==source and gateway['tarballSha']==packageSha
(proof/'qualification.json').write_text(json.dumps({'status':'PASS','source':source,'sourceMatchesRetainedQualifiedHashes':True,'packageSha256':packageSha,'runtimeProof':'Actual installed candidate CLI/Gateway with signed synthetic Talk webhook and checked synthetic provider input; not real Talk/UI/model proof','steps':steps},indent=2)+'\n');print((proof/'qualification.json').read_text())
