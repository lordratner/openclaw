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
baseHashes={}
try:
 for name in prod:
  data=subprocess.check_output(['git','show',base+':'+name]);pathlib.Path(name).write_bytes(data);baseHashes[name]=digest(name)
 cmd=['node','scripts/run-vitest.mjs','run','--config','test/vitest/vitest.extension-database-workers.config.ts','extensions/nextcloud-talk/src/webhook-spool.test.ts','extensions/nextcloud-talk/src/inbound.behavior.test.ts','--maxWorkers=1','--testNamePattern','retains one quoted parent through durable admission and delivery|keeps quoted context separate from current command and reply targets|keeps the current message when optional quote is','--reporter=json','--outputFile='+str(proof/'original.json')]
 run('original-source-controls',cmd,1)
 assert not re.search(r'Unhandled (?:Errors|Rejection|Exception)|Vitest caught \d+ unhandled',(proof/'original-source-controls.log').read_text())
 d=json.loads((proof/'original.json').read_text());assert d.get('numRuntimeErrorTestSuites',0)==0 and not d.get('unhandledErrors',[]) and not d.get('numUnhandledErrors',0);allcases=[a for t in d['testResults'] for a in t['assertionResults']];assert {a['status'] for a in allcases}<={'passed','failed','skipped','pending'};cases=[a for a in allcases if a['status'] in ['passed','failed']];failed=[a for a in cases if a['status']=='failed'];passed=[a for a in cases if a['status']=='passed'];assert len(cases)==7 and len(failed)==2 and len(passed)==5
 for title in ['retains one quoted parent through durable admission and delivery','keeps quoted context separate from current command and reply targets']:
  matches=[a for a in failed if title in a['fullName']];assert len(matches)==1;error='\n'.join(matches[0]['failureMessages']);assert 'AssertionError' in error
  if 'retains one' in title:assert 'quote' in error and 'Look north.' in error
  else:
   assert 'expected undefined to deeply equal' in error;location=re.search(r'inbound\.behavior\.test\.ts:(\d+):',error);assert location;assert 'ReplyChain' in pathlib.Path('extensions/nextcloud-talk/src/inbound.behavior.test.ts').read_text().splitlines()[int(location[1])-1]
 assert all('keeps the current message when optional quote is' in a['fullName'] for a in passed)
 (proof/'original-qualified.json').write_text(json.dumps({'expectedFailures':2,'controlsPassed':5,'appliedOriginalProductionHashes':baseHashes,'cases':[{'name':a['fullName'],'status':a['status']} for a in cases]},indent=2)+'\n')
finally:
 for name in prod:pathlib.Path(name).write_bytes(formatted[name])
files=['extensions/nextcloud-talk/src/webhook-spool.test.ts','extensions/nextcloud-talk/src/inbound.behavior.test.ts','extensions/nextcloud-talk/src/inbound.authz.test.ts','extensions/nextcloud-talk/src/inbound-media.mentions.test.ts']
run('repaired-and-siblings',['node','scripts/run-vitest.mjs','run','--config','test/vitest/vitest.extension-database-workers.config.ts',*files,'--maxWorkers=1','--reporter=json','--outputFile='+str(proof/'repaired.json')])
d=json.loads((proof/'repaired.json').read_text());assert d['success'] and d['numFailedTests']==0 and d['numPassedTests']>0
assert len(d['testResults'])==len(files),[(t['name'],len(t['assertionResults'])) for t in d['testResults']]
for name in files:
 matches=[t for t in d['testResults'] if t['name'].replace('\\','/').endswith(name)];assert len(matches)==1,name
 assert matches[0]['assertionResults'] and all(a['status']=='passed' for a in matches[0]['assertionResults']),name
cases=[a for t in d['testResults'] for a in t['assertionResults'] if a['status']=='passed'];assert sum('retains one quoted parent through durable admission and delivery' in a['fullName'] for a in cases)==1;assert sum('keeps quoted context separate from current command and reply targets' in a['fullName'] for a in cases)==1;assert sum('visibility for a quoted group sender' in a['fullName'] for a in cases)==3;assert sum('delivery targeting with quoted context' in a['fullName'] for a in cases)==4
run('production-types',['pnpm','tsgo:extensions'])
run('test-types',['pnpm','tsgo:extensions:test'])
run('affected-lint',['node','scripts/run-oxlint.mjs','--tsconfig','extensions/tsconfig.json',*[p for p in paths if p.endswith('.ts')]])
run('prefix-stability',['pnpm','test','src/agents/agent-tools.prefix-stability.test.ts','--maxWorkers=1','--reporter=json','--outputFile='+str(proof/'prefix.json')])
prefix=json.loads((proof/'prefix.json').read_text());assert prefix['success'] and prefix['numPassedTests']>0 and prefix['numFailedTests']==0
run('docs-list',['pnpm','docs:list'])
run('format-check',['pnpm','exec','oxfmt','--check',*paths])
run('whitespace',['git','diff','--check'])
for name,data in formatted.items():assert pathlib.Path(name).read_bytes()==data,name
(proof/'qualification.json').write_text(json.dumps({'status':'PASS','candidate':source,'base':base,'repairedTestsPassed':d['numPassedTests'],'prefixTestsPassed':prefix['numPassedTests'],'originalExpectedFailures':2,'originalControlsPassed':5,'testedSourceHashes':{p:digest(p) for p in paths},'formattedSource':True,'steps':steps},indent=2)+'\n')
print((proof/'qualification.json').read_text())
