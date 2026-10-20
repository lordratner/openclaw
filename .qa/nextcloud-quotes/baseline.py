import json,os,pathlib,subprocess,time,hashlib
root=pathlib.Path(os.environ['RUNNER_TEMP'])/'quoted-replies-proof';root.mkdir(exist_ok=True)
files=['extensions/nextcloud-talk/src/webhook-spool.test.ts','extensions/nextcloud-talk/src/inbound.behavior.test.ts']
pattern='retains one quoted parent through durable admission and delivery|keeps quoted context separate from current command and reply targets|keeps the current message when optional quote is'
cmd=['node','scripts/run-vitest.mjs','run','--config','test/vitest/vitest.extension-database-workers.config.ts',*files,'--maxWorkers=1','--testNamePattern',pattern,'--reporter=json','--outputFile='+str(root/'baseline-tests.json')]
start=time.monotonic()
with (root/'baseline-tests.log').open('w') as out:r=subprocess.run(cmd,stdout=out,stderr=subprocess.STDOUT)
result=json.loads((root/'baseline-tests.json').read_text());cases=[a for suite in result['testResults'] for a in suite['assertionResults'] if a['status']!='pending'];failed=[a for a in cases if a['status']=='failed'];passed=[a for a in cases if a['status']=='passed']
expected=['retains one quoted parent through durable admission and delivery','keeps quoted context separate from current command and reply targets']
assert r.returncode==1,(r.returncode,result)
assert len(cases)==7 and len(failed)==2 and len(passed)==5,[(a.get('fullName'),a['status']) for a in cases]
for name in expected:
 matches=[a for a in failed if name in a['fullName']];assert len(matches)==1,name
 assert any('AssertionError' in msg for msg in matches[0]['failureMessages']),matches[0]
assert all('keeps the current message when optional quote is' in a['fullName'] for a in passed)
receipt={'status':'PASS_EXPECTED_ORIGINAL_FAILURES','source':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'expectedFailed':len(failed),'conservativeControlsPassed':len(passed),'wallSeconds':round(time.monotonic()-start,3),'cases':[{'name':a['fullName'],'status':a['status']} for a in cases],'testHashes':{f:hashlib.sha256(pathlib.Path(f).read_bytes()).hexdigest() for f in files},'productionUnchanged':True}
(root/'qualification.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt,indent=2))
