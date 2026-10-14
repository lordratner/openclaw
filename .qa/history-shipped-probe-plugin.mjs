// QA-only external context engine; public registration API, no product imports.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.env.HISTORY_PROOF_ROOT;
if(!root)throw new Error('Missing task-owned proof root');
const phase=process.env.HISTORY_PROOF_PHASE;
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const trace=(event,params={},extra={})=>fs.appendFileSync(path.join(root,'lifecycle.jsonl'),JSON.stringify({event,phase,sessionId:params.sessionId,sessionKey:params.sessionKey,tokenBudget:params.tokenBudget,...extra})+'\n');
export default {
  id:'history-proof',kind:'context-engine',
  register(api){api.registerContextEngine('history-proof',()=>({
    info:{id:'history-proof',name:'Synthetic installed history boundary probe',ownsCompaction:true,
      turnMaintenanceMode:'foreground',transcriptSemantics:{currentTurnFence:'before-current-turn-entry-v1',turnAdvancementIdempotency:'atomic-idempotent-v1'}},
    async bootstrap(params){trace('bootstrap',params);return{bootstrapped:true};},
    async ingest(){return{ingested:true};},
    async assemble(params){
      const mode=JSON.parse(fs.readFileSync(path.join(root,'selection.json'),'utf8')).mode;
      trace('assemble',params,{mode,messageCount:params.messages.length});
      if(mode==='fallback')throw new Error('Synthetic ordinary assembly failure');
      const image={role:'user',timestamp:1000,__openclaw:{senderId:'qa-speaker-a',senderName:'Synthetic Speaker'},
        content:[{type:'text',text:'QA_IMAGE_CAPTION'},{type:'image',mimeType:'image/png',data:png}]};
      const after={role:'user',timestamp:1001,__openclaw:{senderId:'qa-speaker-b',senderName:'Synthetic Follow-up'},
        content:[{type:'text',text:'QA_AFTER_IMAGE'}]};
      const delta={role:'user',timestamp:1002,__openclaw:{senderId:'qa-speaker-b',senderName:'Synthetic Follow-up'},
        content:[{type:'text',text:'SELECTED_WARM_DELTA_ONLY'}]};
      const messages=mode==='stable'?params.messages:mode==='delta'?[delta]:[...params.messages,image,after];
      // Preserve raw selected inputs as synthetic-only evidence; never edit host transcripts.
      fs.appendFileSync(path.join(root,'selections.jsonl'),JSON.stringify({phase,mode,messages})+'\n');
      trace('selected',params,{mode,count:messages.length,sha256:createHash('sha256').update(JSON.stringify(messages)).digest('hex')});
      return{messages,estimatedTokens:mode==='full'?350000:32};
    },
    async compact(){return{ok:true,compacted:false};},
    async commitTurn(params){trace('commit',params);return{status:'committed'};},
    async maintain(params){trace('maintain',params);return{changed:false,bytesFreed:0,rewrittenEntries:0};},
  }));},
};
