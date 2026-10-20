import pathlib,os,subprocess,json,time,hashlib
proof=pathlib.Path(os.environ['RUNNER_TEMP'])/'quoted-type-boundary';proof.mkdir();os.environ['TYPE_BOUNDARY_PROOF']=str(proof);steps=[]
def run(label,args):
 start=time.monotonic()
 with (proof/(label+'.log')).open('w') as out:r=subprocess.run(args,stdout=out,stderr=subprocess.STDOUT)
 steps.append({'label':label,'code':r.returncode,'wallSeconds':round(time.monotonic()-start,3)});(proof/'steps.json').write_text(json.dumps(steps,indent=2)+'\n');assert r.returncode==0,(label,r.returncode)
run('runtime-equivalence',['node','.proof-tools/.qa/nextcloud-quotes/type-boundary.mjs'])
run('production-types',['pnpm','tsgo:extensions']);run('test-types',['pnpm','tsgo:extensions:test'])
name='extensions/nextcloud-talk/src/inbound.ts'
run('assertion-safety',['pnpm','check:assertion-safety','--base','227300b7e3727d3b5c9f353e39d7282139dbdc30','--no-merge-base'])
run('affected-lint',['node','scripts/run-oxlint.mjs','--tsconfig','extensions/tsconfig.json',name]);run('format',['pnpm','exec','oxfmt','--check',name]);run('whitespace',['git','diff','--check'])
e=json.loads((proof/'equivalence.json').read_text());assert hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest()==e['afterSourceSha256'];(proof/'qualification.json').write_text(json.dumps({'status':'PASS','source':os.environ['SOURCE_SHA'],'retainedBehaviorArtifactSource':e['testedArtifactSource'],'runtimeEquivalence':e,'steps':steps,'retainedBehaviorProof':'78 focused tests + installed/relocated Gateway + 2 genuine native-model turns; no runtime JS change'},indent=2)+'\n');print((proof/'qualification.json').read_text())
