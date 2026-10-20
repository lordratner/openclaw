import os,json,pathlib,subprocess,time,hashlib,shutil,re
proof=pathlib.Path(os.environ['RUNNER_TEMP'])/'quoted-replies-qualified';proof.mkdir(exist_ok=True)
tools=pathlib.Path('.proof-tools/.qa/nextcloud-quotes');spec=json.loads((tools/'candidate-files.json').read_text());paths=[f['path'] for f in spec];source=os.environ['SOURCE_SHA'];base=os.environ['BASE_SHA'];steps=[]
def digest(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def run(label,cmd,expected=0):
 start=time.monotonic()
 with (proof/(label+'.log')).open('w') as out:r=subprocess.run(cmd,stdout=out,stderr=subprocess.STDOUT)
 steps.append({'label':label,'code':r.returncode,'wallSeconds':round(time.monotonic()-start,3)})
 (proof/'steps.json').write_text(json.dumps(steps,indent=2)+'\n')
 if expected is not None:assert r.returncode==expected,(label,r.returncode)
 return r.returncode
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==source
for item in spec:assert digest(item['path'])==item['sha256'],item['path']
run('format',['pnpm','exec','oxfmt','--write',*paths])
formatted={p:pathlib.Path(p).read_bytes() for p in paths}
for name,data in formatted.items():
 dest=proof/'formatted'/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
(proof/'source-manifest.json').write_text(json.dumps({'source':source,'base':base,'files':{p:digest(p) for p in paths}},indent=2)+'\n')
(proof/'format.patch').write_bytes(subprocess.check_output(['git','diff','--binary']))
run('runtime-prerequisites',['pnpm','build','qaRuntime'])
prod=[p for p in paths if p.endswith('.ts') and '.test.' not in p]
reviewed='253270b57779c3fcb519ac0a7350cd3366092e18'
reviewedHashes={}
try:
 for name in prod:
  data=subprocess.check_output(['git','show',reviewed+':'+name]);pathlib.Path(name).write_bytes(data);reviewedHashes[name]=digest(name)
 run('accessgroup-original',['node','scripts/run-vitest.mjs','run','--config','test/vitest/vitest.extension-database-workers.config.ts','extensions/nextcloud-talk/src/inbound.behavior.test.ts','--maxWorkers=1','--testNamePattern','applies access-group quote visibility','--reporter=json','--outputFile='+str(proof/'accessgroup-original.json')],1)
 d=json.loads((proof/'accessgroup-original.json').read_text());assert not d.get('numRuntimeErrorTestSuites',0) and not d.get('unhandledErrors',[]);cases=[a for t in d['testResults'] for a in t['assertionResults'] if a['status'] in ['passed','failed']];failed=[a for a in cases if a['status']=='failed'];passed=[a for a in cases if a['status']=='passed'];assert len(failed)==1 and len(passed)==2
 error='\n'.join(failed[0]['failureMessages']);assert 'AssertionError' in error and 'Group member quote' in error and 'undefined' in error;assert all('applies access-group quote visibility' in a['fullName'] for a in cases)
 (proof/'accessgroup-original-qualified.json').write_text(json.dumps({'source':reviewed,'expectedFailures':1,'controlsPassed':2,'appliedReviewedProductionHashes':reviewedHashes,'cases':[{'name':a['fullName'],'status':a['status']} for a in cases]},indent=2)+'\n')
finally:
 for name in prod:pathlib.Path(name).write_bytes(formatted[name])
files=['extensions/nextcloud-talk/src/webhook-spool.test.ts','extensions/nextcloud-talk/src/inbound.behavior.test.ts','extensions/nextcloud-talk/src/inbound.authz.test.ts','extensions/nextcloud-talk/src/inbound-media.mentions.test.ts']
run('repaired-and-siblings',['node','scripts/run-vitest.mjs','run','--config','test/vitest/vitest.extension-database-workers.config.ts',*files,'--maxWorkers=1','--reporter=json','--outputFile='+str(proof/'repaired.json')])
d=json.loads((proof/'repaired.json').read_text());assert d['success'] and d['numFailedTests']==0 and d['numPassedTests']>0
assert len(d['testResults'])==len(files),[(t['name'],len(t['assertionResults'])) for t in d['testResults']]
for name in files:
 matches=[t for t in d['testResults'] if t['name'].replace('\\','/').endswith(name)];assert len(matches)==1,name
 assert matches[0]['assertionResults'] and all(a['status']=='passed' for a in matches[0]['assertionResults']),name
cases=[a for t in d['testResults'] for a in t['assertionResults'] if a['status']=='passed'];assert sum('retains one quoted parent through durable admission and delivery' in a['fullName'] for a in cases)==1;assert sum('keeps quoted context separate from current command and reply targets' in a['fullName'] for a in cases)==1;assert sum('visibility for a quoted group sender' in a['fullName'] for a in cases)==3;assert sum('delivery targeting with quoted context' in a['fullName'] for a in cases)==4;assert sum('applies access-group quote visibility' in a['fullName'] for a in cases)==3
run('production-types',['pnpm','tsgo:extensions'])
run('test-types',['pnpm','tsgo:extensions:test'])
run('affected-lint',['node','scripts/run-oxlint.mjs','--tsconfig','extensions/tsconfig.json',*[p for p in paths if p.endswith('.ts')]])
run('prefix-stability',['pnpm','test','src/agents/agent-tools.prefix-stability.test.ts','--maxWorkers=1','--reporter=json','--outputFile='+str(proof/'prefix.json')])
prefix=json.loads((proof/'prefix.json').read_text());assert prefix['success'] and prefix['numPassedTests']>0 and prefix['numFailedTests']==0
run('docs-list',['pnpm','docs:list'])
run('format-check',['pnpm','exec','oxfmt','--check',*paths])
run('whitespace',['git','diff','--check'])
for name,data in formatted.items():assert pathlib.Path(name).read_bytes()==data,name
(proof/'qualification.json').write_text(json.dumps({'status':'PASS','candidate':source,'base':base,'repairedTestsPassed':d['numPassedTests'],'prefixTestsPassed':prefix['numPassedTests'],'accessGroupOriginalExpectedFailures':1,'accessGroupOriginalControlsPassed':2,'reviewedBase':reviewed,'testedSourceHashes':{p:digest(p) for p in paths},'formattedSource':True,'steps':steps},indent=2)+'\n')
print((proof/'qualification.json').read_text())
