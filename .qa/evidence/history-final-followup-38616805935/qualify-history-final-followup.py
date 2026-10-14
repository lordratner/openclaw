"""Inspect observed hosted final-history artifacts without executing application code."""
from pathlib import Path
import json,hashlib,sys
P=Path(__file__).resolve().parent;run=int(sys.argv[1]);R=P/('history-final-followup-run-'+str(run));A=R/'delta';M=R/'merged';S=P.parent/'openclaw-history-source'
def j(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
meta=j(P/('history-final-followup-run-'+str(run)+'.json'));qa=j(P/'history-narrow-followup-qa.json');c=j(P/'history-narrow-candidate.json');review=j(P/'history-final-followup-source-review.json')
assert meta['status']=='completed' and meta['conclusion']=='success' and meta['headSha']==qa['head'];assert qa['candidate']==c['candidate']
source=j(A/'source.json');v=j(A/'validated.json');assert source['candidate']==c['candidate'] and source['productionSource']==c['behaviorProofSource'];assert v['freshPassed']==67 and v['failed']==v['skipped']==0 and v['retainedPassed']==157
assert len(source['retainedFiles'])==7 and sum(x['passed'] for x in source['retainedFiles'])==157
for x in source['retainedFiles']:assert sha(S/x['path'])==x['sha256']
for p,h in review['reviewedFiles'].items():assert sha(S/p)==h
assert source['changedSourceSha256']==review['reviewedFiles']
assert (A/'head.txt').read_text().strip()==c['candidate'] and not (A/'generated.patch').read_text().strip()
copy=j(P/'history-overflow-guidance-review.json');file='extensions/codex/src/app-server/context-engine-projection.ts';text=(S/file).read_text();old=copy['changedLiteral']['old'];new=copy['changedLiteral']['new'];assert text.count(new)==1 and hashlib.sha256(text.replace(new,old).encode()).hexdigest()==copy['previousModuleSha256']
merged=j(M/'source.json');mv=j(M/'validated.json');main=j(P/'history-test-types-main-ref.json')['object']['sha'];assert merged['candidate']==c['candidate'] and merged['main']==main and merged['headStillMain'] and merged['refsUnchanged'] and not merged['conflictOverrides']
assert mv['candidate']==c['candidate'] and mv['main']==main and mv['passed']==3 and mv['failed']==mv['skipped']==0
for name in ('Fresh merged extension test-type owner','Execute repaired canonical continuity on current merged core','Fresh merged two-test format and lint'):
 assert any(s['name']==name and s['conclusion']=='success' for q in meta['jobs'] for s in q['steps']),name
result={'qualified':True,'candidate':c['candidate'],'runId':run,'url':'https://github.com/lordratner/openclaw/actions/runs/'+str(run),'freshPassed':67,'retainedPassed':157,'retainedFiles':7,'freshWallSeconds':v['wallSeconds'],'freshMergedContinuityPassed':3,'mergedMain':main,'mergedTree':merged['mergedTree'],'freshMergedExtensionTestTypes':True,'retainedBehaviorProofSource':c['behaviorProofSource'],'controlledErrorLiteralException':copy['changedLiteral'],'sourceHashIdentity':source,'mergedSource':merged,'historicalInstalledClaimBoundary':'Source5b package and actualinstalled5turn traces prove unchanged carrier/media/continuity behavior; finalsource includes a named recovery-only error literal change and test updates. Finalsource not repacked/installed; no finalbinaryidentity claim.','priorFailures':'Old lint/import/types/consumer failures are not counted as passing overall runs.','artifactHashes':{str(p.relative_to(R)):sha(p) for p in R.rglob('*') if p.is_file()}}
(P/'history-final-followup-qualified.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k] for k in ('qualified','candidate','runId','freshPassed','retainedPassed','freshMergedContinuityPassed')}))
