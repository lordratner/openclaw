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
  const expressions = [
    'completion.outcome','sourceReplyDelivery','terminalReplyDelivery','hasTerminalReply',
    'waitingStatusPayload === undefined','strandedFinal','blockStreamingEnabled',
    'hasDirectlySentBlockReply','runResult.sourceReplyDeliveryState',
    'runResult.meta?.terminalReply?.disposition','runResult.meta?.terminalReply?.code',
    'payloadArray.length','replyPayloads.length','directBlockDeliveries.length',
    'blockReplyPipeline === null'
  ];
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
      const frame = message.params.callFrames.find(item => item.functionName === 'prepareReplyAgentPayloads') ?? top;
      const state = {};
      const read = async expression => {
        const result = await request('Debugger.evaluateOnCallFrame', {callFrameId:frame.callFrameId,expression,returnByValue:true,throwOnSideEffect:true});
        state[expression] = result.exceptionDetails
          ? {unavailable:result.result?.description ?? result.exceptionDetails.text}
          : result.result?.type === 'undefined' ? {undefined:true} : result.result?.value;
        return state[expression];
      };
      for (const expression of expressions) await read(expression);
      for (const [collection,count] of [['payloadArray',state['payloadArray.length']],['replyPayloads',state['replyPayloads.length']],['directBlockDeliveries',state['directBlockDeliveries.length']]]) {
        if (!Number.isInteger(count)) continue;
        for (let i=0;i<Math.min(count,8);i++) {
          const object = collection === 'directBlockDeliveries' ? `${collection}[${i}].payload` : `${collection}[${i}]`;
          for (const field of ['text?.length','mediaUrl !== undefined','mediaUrls?.length','isCommentary','isReasoning','isError']) await read(`${object}.${field}`);
          for (const field of ['assistantMessageIndex','blockReplySources?.length','blockReplySources?.[0]?.complete']) await read(`getReplyPayloadMetadata(${object})?.${field}`);
          if (collection === 'directBlockDeliveries') for (const field of ['pending','terminalDeliveryConfirmed','outcome','source?.complete','source?.kind']) await read(`${collection}[${i}].${field}`);
        }
      }
      captures.push({functionName:top.functionName,line:top.location.lineNumber+1,readFrame:frame.functionName,readFrameLine:frame.location.lineNumber+1,state});
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
