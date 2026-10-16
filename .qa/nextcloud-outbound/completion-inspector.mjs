// Read-only CDP state capture on the task-owned disposable Gateway only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function inspectReplyCompletion({entry, evidence, gatewayLog, expectedPid}) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert(path.resolve(entry).startsWith(path.join(process.env.RUNNER_TEMP, 'nextcloud-outbound-live/prefix/')));
  const dist = path.join(path.dirname(entry), 'dist');
  const matches = [];
  for (const name of await fs.readdir(dist)) {
    if (!/^agent-runner-run-.*\.mjs$/.test(name)) continue;
    const source = await fs.readFile(path.join(dist, name), 'utf8');
    if (source.includes('const recordMissingReply = () => {')) matches.push({name, source});
  }
  assert.equal(matches.length, 1, 'expected the exact paired completion owner');
  const {name, source} = matches[0];
  const lines = source.split('\n');
  const marker = lines.findIndex(line => line.includes('const recordMissingReply = () => {'));
  const build = lines.findIndex(line => line.includes('let replyPayloads = await buildFinalPayloads('));
  assert(marker >= 0 && build >= 0);
  const log = await fs.readFile(gatewayLog, 'utf8');
  const endpoint = log.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];
  assert(endpoint, 'owned Gateway inspector endpoint missing');
  const ws = new WebSocket(endpoint);
  const pending = new Map();
  let serial = 0;
  const captures = [], errors = [];
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timeout = setTimeout(() => {pending.delete(id); reject(new Error(`CDP timeout: ${method}`));}, 8000);
    pending.set(id, {resolve, reject, timeout});
    ws.send(JSON.stringify({id, method, params}));
  });
  const expression = `JSON.stringify((()=>{
    const read = f => {try{return f()}catch(e){return {unavailable:String(e)}}};
    const payload = p => ({textLength:p.text?.length,mediaCount:p.mediaUrls?.length ?? (p.mediaUrl ? 1 : 0),isCommentary:p.isCommentary,isReasoning:p.isReasoning,isError:p.isError,metadata:read(()=>{const m=getReplyPayloadMetadata(p);return m?{keys:Object.keys(m),assistantMessageIndex:m.assistantMessageIndex,blockReplySources:m.blockReplySources?.map(s=>({complete:s.complete,keys:Object.keys(s)}))}:null})});
    return {
      completion:read(()=>completion),sourceReplyDelivery:read(()=>sourceReplyDelivery),terminalReplyDelivery:read(()=>terminalReplyDelivery),hasTerminalReply:read(()=>hasTerminalReply),hasDirectlySentBlockReply:read(()=>hasDirectlySentBlockReply),
      runResult:read(()=>({sourceReplyDeliveryState:runResult.sourceReplyDeliveryState,terminalReply:runResult.meta?.terminalReply,error:runResult.meta?.error,finalTextLength:runResult.meta?.finalAssistantVisibleText?.length})),
      pipeline:read(()=>blockReplyPipeline ? {didStream:blockReplyPipeline.didStream(),didStreamTerminalReply:blockReplyPipeline.didStreamTerminalReply?.(),isAborted:blockReplyPipeline.isAborted()}:null),
      direct:read(()=>directBlockDeliveries?.map(d=>({outcome:d.outcome,pending:d.pending,terminalDeliveryConfirmed:d.terminalDeliveryConfirmed,payload:payload(d.payload)}))),
      payloadArray:read(()=>payloadArray.map(payload)),replyPayloads:read(()=>replyPayloads.map(payload))
    };
  })())`;
  ws.addEventListener('message', async event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id); clearTimeout(item.timeout);
      message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
      return;
    }
    if (message.method !== 'Debugger.paused') return;
    try {
      const top = message.params.callFrames[0];
      const result = await request('Debugger.evaluateOnCallFrame', {callFrameId:top.callFrameId,expression,returnByValue:true,throwOnSideEffect:true});
      captures.push({functionName:top.functionName,line:top.location.lineNumber+1,exception:result.exceptionDetails?.text,state:result.result?.value ? JSON.parse(result.result.value) : result.result});
      await fs.writeFile(path.join(evidence, 'completion-inspector.json'), JSON.stringify({scope:'Read-only debugger observations; no runtime source or state mutation',owner:name,captures,errors},null,2));
    } catch(error) { errors.push(String(error)); }
    finally { await request('Debugger.resume').catch(error=>errors.push(String(error))); }
  });
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  try {
    const pid = await request('Runtime.evaluate',{expression:'process.pid',returnByValue:true,throwOnSideEffect:true});
    assert.equal(pid.result.value, expectedPid, 'inspector is not the owned Gateway process');
    await request('Debugger.enable');
    const url = pathToFileURL(path.join(dist,name)).href;
    for (const lineNumber of [marker+1, build+1]) await request('Debugger.setBreakpointByUrl',{url,lineNumber});
  } catch(error) { ws.close(); throw error; }
  return {async close(){
    await request('Debugger.resume').catch(()=>{});
    await request('Debugger.disable').catch(error=>errors.push(String(error)));
    ws.close();
    await fs.writeFile(path.join(evidence,'completion-inspector.json'),JSON.stringify({scope:'Read-only debugger observations; no runtime source or state mutation',owner:name,captures,errors},null,2));
  }};
}
