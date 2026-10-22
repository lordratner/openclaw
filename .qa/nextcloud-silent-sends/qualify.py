import hashlib,json,os,subprocess,time
from pathlib import Path
proof=Path(os.environ['RUNNER_TEMP'])/'silent-sends-qualified';proof.mkdir(exist_ok=True)
steps=[]
def run(label,args,expected=0):
 start=time.monotonic()
 with (proof/(label+'.log')).open('w') as output:r=subprocess.run(args,stdout=output,stderr=subprocess.STDOUT)
 steps.append({'label':label,'code':r.returncode,'wallSeconds':time.monotonic()-start})
 (proof/'steps.json').write_text(json.dumps(steps,indent=2))
 assert r.returncode==expected,(label,r.returncode)
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==os.environ['SOURCE_SHA']
run('runtime-prerequisites',['pnpm','build','qaRuntime'])
test='extensions/nextcloud-talk/src/silent-send.test.ts'
cmd=['node','scripts/run-vitest.mjs','run','--config','test/vitest/vitest.extension-messaging.config.ts',test,'--maxWorkers=1','--reporter=json','--outputFile='+str(proof/'baseline.json')]
run('baseline-outbound-regression',cmd,expected=1)
r=json.loads((proof/'baseline.json').read_text())
assert r.get('numRuntimeErrorTestSuites',0)==0
cases=[c for s in r['testResults'] for c in s['assertionResults']]
failed=[c for c in cases if c['status']=='failed'];passed=[c for c in cases if c['status']=='passed']
assert len(failed)==9 and len(passed)==4,[(c['fullName'],c['status']) for c in cases]
assert all('AssertionError' in '\n'.join(c['failureMessages']) for c in failed)
(proof/'qualification.json').write_text(json.dumps({'status':'BASELINE_REPRODUCED','source':os.environ['SOURCE_SHA'],'base':os.environ['BASE_SHA'],'failed':len(failed),'passed':len(passed),'cases':[{k:c[k] for k in ['fullName','status']} for c in cases],'steps':steps},indent=2))
