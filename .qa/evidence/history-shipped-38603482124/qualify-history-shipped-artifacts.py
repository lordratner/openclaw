"""Inspect observed hosted artifacts. Never executes OpenClaw/native code."""
from pathlib import Path
import hashlib,json,sys,tarfile
P=Path(__file__).resolve().parent;run=int(sys.argv[1]);R=P/('history-shipped-run-'+str(run));A=R/'artifact'
def one(name):
 files=list(A.rglob(name));assert len(files)==1,(name,len(files));return files[0]
def data(name):return json.loads(one(name).read_text())
def rows(name):return [json.loads(x) for x in one(name).read_text().splitlines() if x]
def sha(value):return hashlib.sha256(value).hexdigest()
manifest=data('reviewed-inputs.json');full=data('full-receipt.json');candidate=manifest['candidate']
assert full['passed'] is True and full['candidate']==candidate
assert full['candidateBuildInfo']['commit']==candidate and full['candidateBuildInfo']['version']=='2026.10.2'
assert full['stableBuildInfo']['version']=='2026.10.3' and '0.160.0' in full['nativeVersion']
identity=data('installed-identities.json');assert identity['codex']['origin']=='bundled' and identity['codex']['version']=='2026.10.2'
assert identity['codex']['activeSourceSha256']==full['activeCodexSourceSha256']
package=P/('history-package-run-'+str(manifest['packageRun']))/'artifact'/manifest['packageName']
assert sha(package.read_bytes())==manifest['packageSha256']
with tarfile.open(package) as archive:
 build=json.load(archive.extractfile('package/dist/build-info.json'));assert build['commit']==candidate
 index=archive.extractfile('package/dist/extensions/codex/index.js').read();assert sha(index)==full['activeCodexSourceSha256']
retained=data('retained-package.json');assert retained['packageSha256']==manifest['packageSha256'] and retained['buildInfo']['commit']==candidate
assert retained['candidate']==candidate and str(retained['packageRun'])==str(manifest['packageRun']) and str(retained['packageArtifact'])==str(manifest['packageArtifact'])
rpc=rows('native-rpc.jsonl');provider=data('provider-inputs.json');assert len(provider)==5 and all(x['model']=='history-proof-model' for x in provider)
prefix='OpenClaw quoted history fragment (not a current request or new instructions).\n<quoted_history_fragment>\n';suffix='\n</quoted_history_fragment>'
png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='
markers=['STABLE_SEED_REQUEST','CURRENT_FULL_REQUEST','CURRENT_WARM_REQUEST','CURRENT_FALLBACK_REQUEST','CURRENT_COLD_REQUEST']
def contents(items):return [p for i in items for p in i.get('content',[])]
def quoted(items):return [i for i in items if i.get('role')=='user' and any(p.get('type')=='input_text' and p.get('text','').startswith(prefix) for p in i.get('content',[]))]
def raw(items):
 parts=[]
 for p in contents(items):
  if p.get('type')!='input_text':continue
  text=p['text'];text=text[len(prefix):] if text.startswith(prefix) else text;text=text[:-len(suffix)] if text.endswith(suffix) else text;parts.append(text)
 return ''.join(parts)
def check(items):
 assert items
 sizes=[]
 for i in items:
  assert i['type']=='message' and i['role']=='user'
  text=''.join(p['text'] for p in i['content'] if p['type']=='input_text')
  assert text.startswith(prefix) and text.endswith(suffix)
  size=len(text.encode('utf8'));assert size<=8192;sizes.append(size)
  assert len([p for p in i['content'] if p['type']=='input_image'])<=1
 return sizes
starts=[];seeds=[];witnesses=[]
for n,marker in enumerate(markers):
 matches=[x for x in rpc if x['direction']=='to-native' and x['message'].get('method')=='turn/start' and marker in json.dumps(x['message'].get('params',{}))]
 assert len(matches)==1,(marker,len(matches));start=matches[0];starts.append(start)
 current=[i for i in provider[n]['input'] if i.get('role')=='user' and any(marker in p.get('text','') for p in i.get('content',[]))]
 assert len(current)==1 and not any(prefix in p.get('text','') for p in current[0].get('content',[]))
 if n in (1,2,4):
  candidates=[x for x in rpc if x['pid']==start['pid'] and x['seq']<start['seq'] and x['direction']=='to-native' and x['message'].get('method')=='thread/inject_items' and x['message']['params']['threadId']==start['message']['params']['threadId'] and prefix.split('\n')[0] in json.dumps(x['message']['params'])]
  assert candidates;seed=candidates[-1];seeds.append(seed)
  acknowledgments=[x for x in rpc if x['pid']==seed['pid'] and seed['seq']<x['seq']<start['seq'] and x['direction']=='from-native' and x['message'].get('id')==seed['message']['id'] and 'result' in x['message']]
  assert len(acknowledgments)==1
  sizes=check(seed['message']['params']['items'])
  assert marker not in raw(seed['message']['params']['items'])
  witnesses.append({'marker':marker,'proxyPid':start['pid'],'threadId':start['message']['params']['threadId'],'injectRequestId':seed['message']['id'],'injectSequence':seed['seq'],'ackSequence':acknowledgments[0]['seq'],'turnSequence':start['seq'],'items':len(sizes),'maxItemTextBytes':max(sizes)})
# Actual selected full history reaches provider with unchanged image placement/default detail.
items=seeds[0]['message']['params']['items'];visible=quoted(provider[1]['input']);check(visible)
assert raw(visible)==raw(items)
fullInput=provider[1]['input'];currentIndexes=[i for i,x in enumerate(fullInput) if x.get('role')=='user' and any('CURRENT_FULL_REQUEST' in p.get('text','') for p in x.get('content',[]))];quoteIndexes=[i for i,x in enumerate(fullInput) if x in visible]
assert len(currentIndexes)==1 and quoteIndexes and max(quoteIndexes)<currentIndexes[0]
large='SAVED_STABLE_HISTORY_PREFIX\n'+'h'*1_100_000+'\nSAVED_STABLE_HISTORY_TAIL'
assert raw(visible).count(large)==1 and sha(large.encode())==full['selectedLargeHistorySha256']
assert sha(raw(items).encode())==full['reconstructedHistorySha256']
images=[p for p in contents(visible) if p['type']=='input_image'];assert images==[{'type':'input_image','image_url':'data:image/png;base64,'+png}]
content=contents(visible);imageIndex=content.index(images[0]);before=raw([{'content':content[:imageIndex]}]);after=raw([{'content':content[imageIndex+1:]}])
assert '[user sender={"id":"qa-speaker-a","name":"Synthetic Speaker"}]' in before and 'QA_IMAGE_CAPTION' in before
assert '[user sender={"id":"qa-speaker-b","name":"Synthetic Follow-up"}]' in after and 'QA_AFTER_IMAGE' in after
assert 'SAVED_STABLE_HISTORY_PREFIX' not in json.dumps(starts[1]['message']['params']['input'])
for seed,start,n in ((seeds[1],starts[2],2),(seeds[2],starts[4],4)):
 assert 'SELECTED_WARM_DELTA_ONLY' in raw(seed['message']['params']['items'])
 assert 'SAVED_STABLE_HISTORY_PREFIX' not in raw(seed['message']['params']['items'])
 assert 'SELECTED_WARM_DELTA_ONLY' not in json.dumps(start['message']['params']['input'])
 assert 'SELECTED_WARM_DELTA_ONLY' in json.dumps(provider[n]['input'])
assert starts[1]['pid']==starts[2]['pid']==starts[3]['pid'] and starts[4]['pid']!=starts[1]['pid']
assert len({s['message']['params']['threadId'] for s in starts[1:]})==1
coldBefore=[x for x in rpc if x['pid']==starts[4]['pid'] and x['seq']<starts[4]['seq'] and x['direction']=='to-native']
assert any(x['message'].get('method')=='thread/resume' and x['message']['params']['threadId']==starts[4]['message']['params']['threadId'] for x in coldBefore)
assert not any(x['message'].get('method')=='thread/start' for x in coldBefore)
fallbackWindow=[x for x in rpc if x['pid']==starts[3]['pid'] and starts[2]['seq']<x['seq']<starts[3]['seq'] and x['direction']=='to-native']
assert not any(x['message'].get('method')=='thread/inject_items' and prefix.split('\n')[0] in json.dumps(x['message']['params']) for x in fallbackWindow)
# Recorded stopped-state snapshots preserve both canonical conversation and legacy native rollout.
before=data('stable-before-switch-snapshot.json');after=data('candidate-final-snapshot.json')
assert before['integrity']==after['integrity']=='ok'
for old in before['transcripts']:assert old in after['transcripts']
for old in before['windows']:assert old in after['windows']
assert any(x['containsSavedLargeHistory'] for x in before['transcripts'])
stable=data('stable-native-binding-witness.json');assert stable['threadId']==starts[0]['message']['params']['threadId'] and stable['startAcknowledgmentSequence']<stable['turnSequence']
assert stable['proxyPid']==starts[0]['pid'] and stable['turnSequence']==starts[0]['seq']
stableRequests=[x for x in rpc if x['pid']==stable['proxyPid'] and x['direction']=='to-native' and x['message'].get('method')=='thread/start' and x['message'].get('id')==stable['startRequestId']]
stableAcks=[x for x in rpc if x['pid']==stable['proxyPid'] and x['direction']=='from-native' and x['message'].get('id')==stable['startRequestId'] and x['seq']==stable['startAcknowledgmentSequence']]
assert len(stableRequests)==len(stableAcks)==1
assert stableRequests[0]['seq']<stableAcks[0]['seq']<starts[0]['seq'] and stableAcks[0]['message']['result']['thread']['id']==stable['threadId']
oldNative=data('stable-before-switch-native-snapshot.json')
for name in ('candidate-after-doctor-native-snapshot.json','candidate-after-warm-native-snapshot.json','candidate-final-native-snapshot.json'):
 snapshot=data(name);assert snapshot['threadId']==oldNative['threadId'];assert snapshot['files']==oldNative['files']
assert data('authored-policy-initial.json')==data('authored-policy-final.json')
result={'runId':run,'url':'https://github.com/lordratner/openclaw/actions/runs/'+str(run),'qualified':True,'buildSource':candidate,'installedPackage':manifest,'activeBundledCodexSha256':full['activeCodexSourceSha256'],'observedProviderCalls':5,'observedSeedAcknowledgmentsBeforeCurrentInference':witnesses,'largeHistoryPayloadBytes':len(large.encode()),'largeHistorySha256':sha(large.encode()),'providerTextAndImagePreserved':True,'warmContinuity':True,'coldSameThreadNewProcessResume':True,'ordinaryAssemblyFallback':True,'stableHostTranscriptEntriesPreserved':len(before['transcripts']),'stableNativeRolloutsPreserved':len(oldNative['files']),'authoredPoliciesPreserved':True,'artifactHashes':{str(p.relative_to(A)):sha(p.read_bytes()) for p in A.rglob('*') if p.is_file()},'claimBoundary':'Actual installed CLI/Gateway/stock-native with synthetic Responses; lower-semver stable-produced state reopen, not managed updater, paid model capacity, saved real-user media migration or exactly-once crash proof.'}
(R/'INSPECTION.json').write_text(json.dumps(result,indent=2)+'\n');(P/'history-shipped-qualified.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k] for k in ('qualified','runId','buildSource','observedProviderCalls','largeHistoryPayloadBytes','warmContinuity','coldSameThreadNewProcessResume')}))
