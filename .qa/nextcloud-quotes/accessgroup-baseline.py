import pathlib,os,json,subprocess,time,re,hashlib
proof=pathlib.Path(os.environ['RUNNER_TEMP'])/'quoted-accessgroup-baseline';proof.mkdir();name='extensions/nextcloud-talk/src/inbound.behavior.test.ts';source=os.environ['SOURCE_SHA'];assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==source;steps=[]
def run(label,args,expected=0):
 start=time.monotonic()
 with (proof/(label+'.log')).open('w') as f:r=subprocess.run(args,stdout=f,stderr=subprocess.STDOUT)
 steps.append({'label':label,'code':r.returncode,'wallSeconds':round(time.monotonic()-start,3)});(proof/'steps.json').write_text(json.dumps(steps,indent=2)+'\n');assert r.returncode==expected,(label,r.returncode)
run('format',['pnpm','exec','oxfmt','--write',name]);(proof/'inbound.behavior.test.ts').write_bytes(pathlib.Path(name).read_bytes());run('runtime',['pnpm','build','qaRuntime'])
run('baseline',['node','scripts/run-vitest.mjs','run','--config','test/vitest/vitest.extension-database-workers.config.ts',name,'--maxWorkers=1','--testNamePattern','applies access-group quote visibility','--reporter=json','--outputFile='+str(proof/'baseline.json')],1)
d=json.loads((proof/'baseline.json').read_text());assert not d.get('numRuntimeErrorTestSuites',0);cases=[a for t in d['testResults'] for a in t['assertionResults'] if a['status'] in ['passed','failed']];failed=[a for a in cases if a['status']=='failed'];passed=[a for a in cases if a['status']=='passed'];assert len(failed)==1 and len(passed)==2
error='\n'.join(failed[0]['failureMessages']);assert 'AssertionError' in error and 'Group member quote' in error and 'undefined' in error;assert all('applies access-group quote visibility' in a['fullName'] for a in cases)
(proof/'qualification.json').write_text(json.dumps({'status':'EXPECTED_FAILURE_AND_CONTROLS_PASS','source':source,'expectedFailures':1,'controlsPassed':2,'testSha256':hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest(),'cases':[{'name':a['fullName'],'status':a['status']} for a in cases],'steps':steps},indent=2)+'\n');print((proof/'qualification.json').read_text())
