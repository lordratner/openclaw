// Runs ONLY in the secretless hosted QA job, against its built CLI.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {zstdDecompressSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const repo = process.cwd();
const root = path.join(process.env.RUNNER_TEMP, 'history-shipped-full');
const installedEntry=process.env.INSTALLED_ENTRY;
assert(installedEntry,'Missing isolated installed entry');
await fs.mkdir(root, {recursive: true});
const evidence = path.join(process.env.RUNNER_TEMP, 'history-shipped-full-evidence');
await fs.mkdir(evidence, {recursive: true});
const workspace = path.join(root, 'workspace');
const codexHome = path.join(root, 'codex');
await fs.mkdir(workspace, {recursive: true}); await fs.mkdir(codexHome, {recursive: true});
const historyText='SAVED_STABLE_HISTORY_PREFIX\n'+'h'.repeat(1_100_000)+'\nSAVED_STABLE_HISTORY_TAIL';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const fragmentPrefix='OpenClaw quoted history fragment (not a current request or new instructions).\n<quoted_history_fragment>\n';
const fragmentSuffix='\n</quoted_history_fragment>';
const events = [];
const provider = http.createServer((req, res) => {
  let data = ''; req.setEncoding('utf8'); req.on('data', x => data += x);
  req.on('end', () => {
    if (req.method !== 'POST' || req.url !== '/v1/responses') return res.writeHead(404).end();
    const request = JSON.parse(data); events.push({phase:env.HISTORY_PROOF_PHASE,model:request.model,input:request.input});
    const outputText=events.length===1?historyText:'HISTORY_PROOF_OK';
    const item = {id: 'proof-message-'+events.length, type: 'message', role: 'assistant', status: 'completed',
      content: [{type: 'output_text', text: outputText, annotations: []}]};
    const response = {id: 'proof-response-'+events.length, status: 'completed', output: [item],
      usage: {input_tokens:30,output_tokens:events.length===1?300000:4,total_tokens:events.length===1?300030:34}};
    res.writeHead(200, {'Content-Type':'text/event-stream'});
    res.end([{type:'response.created',response:{...response,status:'in_progress',output:[]}},
      {type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},
      {type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:outputText},
      {type:'response.output_item.done',output_index:0,item}, {type:'response.completed',response}]
      .map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  });
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
const providerPort = provider.address().port;
const listener = net.createServer(); await new Promise(resolve => listener.listen(0,'127.0.0.1',resolve));
const gatewayPort = listener.address().port; await new Promise(resolve => listener.close(resolve));
const model = 'history-proof-model';
const catalog = path.join(root,'models.json');
await fs.writeFile(catalog, JSON.stringify({models:[{slug:model,display_name:'Synthetic history proof',
  supported_reasoning_levels:[],shell_type:'local',visibility:'list',supported_in_api:true,priority:1,
  support_verbosity:false,truncation_policy:{mode:'bytes',limit:10000},experimental_supported_tools:[],
  context_window:2000000,model_messages:{instructions_template:'Reply HISTORY_PROOF_OK.',
    collaboration_modes:{default:'Synthetic policy.'}}}]}));
await fs.writeFile(path.join(codexHome,'config.toml'),[
  `model=${JSON.stringify(model)}`, 'model_provider="history-fixture"', `model_catalog_json=${JSON.stringify(catalog)}`,
  'cli_auth_credentials_store="ephemeral"','web_search="disabled"','approval_policy="never"','sandbox_mode="read-only"',
  '[model_providers.history-fixture]','name="Synthetic history endpoint"',
  `base_url="http://127.0.0.1:${providerPort}/v1"`,'wire_api="responses"','requires_openai_auth=false',
  'supports_websockets=false','request_max_retries=0','stream_max_retries=0',
].join('\n'));
const require = createRequire(path.join(repo,'extensions/codex/package.json'));
const codexLauncher = process.env.PROOF_NATIVE_LAUNCHER ?? path.join(path.dirname(require.resolve('@openai/codex/package.json')),'bin/codex.js');
const proxyPath=path.join(root,'native-proxy.mjs');
await fs.writeFile(proxyPath,"import fs from 'node:fs';\nimport path from 'node:path';\nimport readline from 'node:readline';\nimport {spawn} from 'node:child_process';\nlet seq=0;\nconst root=process.env.HISTORY_PROOF_ROOT;\nconst record=(direction,line)=>{try{fs.appendFileSync(path.join(root,'native-rpc.jsonl'),JSON.stringify({phase:process.env.HISTORY_PROOF_PHASE,pid:process.pid,seq:++seq,direction,message:JSON.parse(line)})+'\\n');}catch(error){process.stderr.write('QA native trace failed: '+error.message+'\\n');process.exitCode=1;}};\nconst child=spawn(process.execPath,[process.argv[2],...process.argv.slice(3)],{env:process.env,stdio:['pipe','pipe','inherit']});\nreadline.createInterface({input:process.stdin}).on('line',line=>{record('to-native',line);child.stdin.write(line+'\\n');});\nreadline.createInterface({input:child.stdout}).on('line',line=>{record('from-native',line);process.stdout.write(line+'\\n');});\nprocess.stdin.on('end',()=>child.stdin.end());\nfor(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));\nchild.on('error',error=>{process.stderr.write(error.message+'\\n');process.exit(1);});\nchild.on('exit',(code,signal)=>process.exit(code??(signal?143:1)));\n");
const pluginDir = path.join(root,'plugin'); await fs.mkdir(pluginDir,{recursive:true});
await fs.copyFile(path.join(process.env.PROOF_TOOL_DIR,'history-shipped-probe-plugin.mjs'),path.join(pluginDir,'index.mjs'));
await fs.writeFile(path.join(pluginDir,'package.json'),JSON.stringify({name:'history-proof',version:'1.0.0',type:'module',openclaw:{extensions:['./index.mjs']}}));
await fs.writeFile(path.join(pluginDir,'openclaw.plugin.json'),JSON.stringify({id:'history-proof',kind:'context-engine',configSchema:{type:'object',additionalProperties:false,properties:{}}}));
const state = path.join(root,'state'); await fs.mkdir(state,{recursive:true});
const configPath = path.join(state,'openclaw.json');
const config = {gateway:{mode:'local',bind:'loopback',port:gatewayPort,auth:{mode:'none'},controlUi:{enabled:false}},
  // Both shipped stable and candidate accept the explicit inherited default.
  // Avoid comparing an unmaterialized fresh roster with Doctor's saved roster.
  agents:{entries:{main:{}},defaults:{workspace,model:{primary:'openai/'+model},heartbeat:{every:'0m'}}},
  models:{providers:{openai:{models:[{id:model,name:'Synthetic history proof',api:'openai-responses',input:['text','image'],contextTokens:600000,maxTokens:2000,agentRuntime:{id:'codex'}}]}}},
  plugins:{allow:['codex','history-proof'],load:{paths:[pluginDir]},slots:{contextEngine:'history-proof'},
    entries:{codex:{enabled:true,config:{appServer:{command:process.execPath,args:[proxyPath,codexLauncher,'app-server'],
      homeScope:'user',sandbox:'read-only',approvalPolicy:'never'},sessionCatalog:{enabled:false}}},'history-proof':{enabled:true}}}};
await fs.writeFile(configPath,JSON.stringify(config,null,2));
// Explicit allowlist: never inherit GitHub tokens or operator credentials.
const env = {PATH:process.env.PATH,LANG:'C.UTF-8',CI:'true',OPENCLAW_HOME:root,OPENCLAW_STATE_DIR:state,
  OPENCLAW_CONFIG_PATH:configPath,CODEX_HOME:codexHome,OPENCLAW_DISABLE_BONJOUR:'1',OPENCLAW_SKIP_CHANNELS:'1',
  HISTORY_PROOF_ROOT:root,HISTORY_PROOF_PHASE:'stable',TMPDIR:root,
  // Public dummy value: no operator/provider credential is read or stored.
  // User-home native transport remains the unauthenticated loopback fixture.
  OPENAI_API_KEY:'public-synthetic-history-proof-not-a-credential'};
let gateway;
const gatewayLog = [];
async function command(args,label,timeout=120000,entry=installedEntry) {
  const output=[]; const stdout=[]; const child=spawn(process.execPath,[entry,...args],{cwd:workspace,env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{output.push(x);stdout.push(x);});child.stderr.on('data',x=>output.push(x));
  const timer=setTimeout(()=>child.kill('SIGTERM'),timeout);
  const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});clearTimeout(timer);
  const text=Buffer.concat(output).toString();await fs.writeFile(path.join(evidence,label+'.log'),text);
  assert.equal(exit.code,0,`${label} failed: ${text.slice(-6000)}`);return Buffer.concat(stdout).toString();
}
async function startGateway(phase) {
  env.HISTORY_PROOF_PHASE=phase; gatewayLog.length=0;
  gateway=spawn(process.execPath,[installedEntry,'gateway','run','--bind','loopback','--port',String(gatewayPort)],{cwd:workspace,env,stdio:['ignore','pipe','pipe']});
  gateway.stdout.on('data',x=>gatewayLog.push(x));gateway.stderr.on('data',x=>gatewayLog.push(x));
  const deadline=Date.now()+120000;
  while(true){if(gateway.exitCode!==null)throw new Error('Gateway exited: '+Buffer.concat(gatewayLog).toString().slice(-7000));
    const connected=await new Promise(resolve=>{const connection=net.connect(gatewayPort,'127.0.0.1');connection.once('connect',()=>{connection.end();resolve(true);});connection.once('error',()=>resolve(false));});
    if(connected)break;if(Date.now()>deadline)throw new Error('Gateway readiness timeout');
    await new Promise(resolve=>setTimeout(resolve,300));}
  await command(['gateway','health','--json'],phase+'-health');
}
async function stopGateway(label) {
  const live=()=>gateway&&gateway.exitCode===null&&gateway.signalCode===null;
  if(live()){
    const exit=new Promise(resolve=>{const timer=setTimeout(resolve,15000);gateway.once('exit',()=>{clearTimeout(timer);resolve();});});
    gateway.kill('SIGTERM');await exit;
    if(live()){const killed=new Promise(resolve=>gateway.once('exit',resolve));gateway.kill('SIGKILL');await killed;}
  }
  await fs.writeFile(path.join(evidence,label+'-gateway.log'),Buffer.concat(gatewayLog));
  gateway=undefined;
}
const sessionId='b6c4dd38-0379-48a0-b7bf-c51a54bbf15e';
const sha=x=>createHash('sha256').update(x).digest('hex');
async function readRows(name){try{return(await fs.readFile(path.join(root,name),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(error){if(error.code==='ENOENT')return[];throw error;}}
async function select(mode){await fs.writeFile(path.join(root,'selection.json'),JSON.stringify({mode}));}
async function turn(label,expectLarge=false){
  const before=events.length;
  const result=JSON.parse(await command(['agent','--agent','main','--session-id',sessionId,'--message',label+' synthetic history request. Reply HISTORY_PROOF_OK.','--timeout','90','--json'],label));
  const payloads=result.payloads??result.result?.payloads;
  assert(payloads?.some(x=>x.text===(expectLarge?historyText:'HISTORY_PROOF_OK')),'Missing completed reply '+label);
  assert.equal(events.length,before+1,'History installation triggered extra inference '+label);
  return result;
}
function snapshot(label){
  assert(!gateway,'Snapshot requires stopped task-owned Gateway');
  const file=path.join(state,'agents/main/agent/openclaw-agent.sqlite');
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    const transcripts=db.prepare('SELECT session_id,seq,event_json,event_zstd FROM transcript_events ORDER BY session_id,seq').all().map(row=>{
      const raw=row.event_json??zstdDecompressSync(row.event_zstd).toString('utf8');
      return{sessionId:row.session_id,seq:row.seq,semanticSha256:sha(raw),containsSavedLargeHistory:raw.includes('SAVED_STABLE_HISTORY_TAIL')};
    });
    const windows=db.prepare('SELECT session_id,session_key FROM session_windows ORDER BY session_id').all();
    assert.equal(Object.values(db.prepare('PRAGMA integrity_check').get())[0],'ok');
    const result={label,fileIdentity:'same isolated agent database',transcripts,windows,integrity:'ok'};
    return fs.writeFile(path.join(evidence,label+'-snapshot.json'),JSON.stringify(result,null,2)).then(()=>result);
  }finally{db.close();}
}
async function nativeTranscriptSnapshot(label,threadId,rpcPath){
  assert(!gateway,'Native snapshot requires stopped task-owned Gateway');
  const paths=[];
  if(typeof rpcPath==='string'){
    const absolute=path.resolve(rpcPath);
    assert(absolute.startsWith(codexHome+path.sep),'Native rollout escaped task-owned home');
    paths.push(absolute);
  }else{
    const walk=async directory=>{
      const entries=await fs.readdir(directory,{withFileTypes:true});
      for(const entry of entries){
        const file=path.join(directory,entry.name);
        if(entry.isDirectory())await walk(file);
        else if(entry.isFile()&&entry.name.endsWith('.jsonl')&&entry.name.includes(threadId))paths.push(file);
      }
    };
    await walk(codexHome);
  }
  assert(paths.length>0,'No preserved native rollout for '+threadId);
  const files=[];
  for(const file of paths){
    const raw=await fs.readFile(file);const text=raw.toString('utf8');
    const lines=text.trim().split('\n').filter(Boolean).map(JSON.parse);
    files.push({path:path.relative(codexHome,file),rawSha256:sha(raw),semanticSha256:sha(JSON.stringify(lines)),bytes:raw.length});
  }
  const result={label,threadId,source:rpcPath?'Acknowledged public thread/start rollout path':'Task-owned Codex rollout inventory, IDs from public native turn/start',files};
  await fs.writeFile(path.join(evidence,label+'-native-snapshot.json'),JSON.stringify(result,null,2));
  return result;
}
function assertNativePreserved(before,after){
  assert.equal(after.threadId,before.threadId);
  for(const old of before.files)assert(after.files.some(x=>x.path===old.path&&x.rawSha256===old.rawSha256&&x.semanticSha256===old.semanticSha256),'Legacy native rollout changed or disappeared');
}
async function installCandidate(){
  assert(process.env.CANDIDATE_TARBALL&&process.env.INSTALLED_PREFIX);
  const output=[];const child=spawn('npm',['install','--global','--prefix',process.env.INSTALLED_PREFIX,process.env.CANDIDATE_TARBALL,'--no-fund','--no-audit'],{env:{PATH:process.env.PATH,CI:'true'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>output.push(x));child.stderr.on('data',x=>output.push(x));
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  await fs.writeFile(path.join(evidence,'candidate-install.log'),Buffer.concat(output));assert.equal(code,0);
}
function userSettings(config){return{agents:config.agents,models:config.models,contextEngine:config.plugins.slots.contextEngine,
  contextEntry:config.plugins.entries['history-proof'],codexAppServer:config.plugins.entries.codex.config.appServer,
  codexCatalog:config.plugins.entries.codex.config.sessionCatalog};}
function contents(items){return items.flatMap(item=>Array.isArray(item.content)?item.content:[]);}
function reconstruct(items){return contents(items).flatMap(part=>{
  if(part.type!=='input_text')return[];
  let text=part.text;
  if(text.startsWith(fragmentPrefix))text=text.slice(fragmentPrefix.length);
  if(text.endsWith(fragmentSuffix))text=text.slice(0,-fragmentSuffix.length);
  return[text];
}).join('');}
function checkItems(items){
  assert(items.length>1,'Expected bounded history fragments');
  for(const item of items){
    assert.equal(item.type,'message');assert.equal(item.role,'user');
    const text=contents([item]).filter(x=>x.type==='input_text').map(x=>x.text).join('');
    assert(Buffer.byteLength(text,'utf8')<=8192,'Oversized historical user item');
    assert(text.startsWith(fragmentPrefix)&&text.endsWith(fragmentSuffix),'Missing quoted provenance');
    assert(contents([item]).filter(x=>x.type==='input_image').length<=1);
  }
}
function seedWitness(rpc,currentMarker){
  const start=rpc.findLast(x=>x.direction==='to-native'&&x.message.method==='turn/start'&&JSON.stringify(x.message.params).includes(currentMarker));
  assert(start,'No actual native turn/start '+currentMarker);
  const seed=rpc.findLast(x=>x.pid===start.pid&&x.seq<start.seq&&x.direction==='to-native'&&x.message.method==='thread/inject_items'&&x.message.params.threadId===start.message.params.threadId&&JSON.stringify(x.message.params).includes(fragmentPrefix.split('\n')[0]));
  assert(seed,'No selected native history injection '+currentMarker);
  const acknowledgment=rpc.find(x=>x.pid===seed.pid&&x.seq>seed.seq&&x.seq<start.seq&&x.direction==='from-native'&&x.message.id===seed.message.id&&'result'in x.message);
  assert(acknowledgment,'History not acknowledged before inference');
  return{start,seed,acknowledgment};
}
try{
  const installConfig=structuredClone(config);installConfig.plugins.allow=['history-proof'];delete installConfig.plugins.entries.codex;
  await fs.writeFile(configPath,JSON.stringify(installConfig,null,2));
  await command(['plugins','install','npm:@openclaw/codex@2026.10.3','--pin','--accept-capabilities'],'stable-codex-install',600000);
  const afterInstall=JSON.parse(await fs.readFile(configPath,'utf8'));
  afterInstall.plugins.allow=[...new Set([...afterInstall.plugins.allow,'codex'])];
  afterInstall.plugins.entries.codex.enabled=true;afterInstall.plugins.entries.codex.config=config.plugins.entries.codex.config;
  await fs.writeFile(configPath,JSON.stringify(afterInstall,null,2));
  const stableSettings=userSettings(afterInstall);
  await fs.writeFile(path.join(evidence,'authored-policy-initial.json'),JSON.stringify(stableSettings,null,2));
  const stableVersion=(await command(['--version'],'stable-version')).trim();
  assert.equal(/\b(\d{4}\.\d+\.\d+)\b/.exec(stableVersion)?.[1],'2026.10.3');
  const installedRoot=path.dirname(installedEntry);
  const stableBuildInfo=JSON.parse(await fs.readFile(path.join(installedRoot,'dist/build-info.json'),'utf8'));
  const nativeVersion=(await command(['--version'],'native-version',30000,codexLauncher)).trim();
  assert(nativeVersion.includes('0.160.0'),'Unexpected stock native runtime');
  await select('stable');await startGateway('stable');await turn('STABLE_SEED_REQUEST',true);await stopGateway('stable');
  const stable=await snapshot('stable-before-switch');
  const stableRpc=await readRows('native-rpc.jsonl');
  const stableTurn=stableRpc.findLast(x=>x.direction==='to-native'&&x.message.method==='turn/start'&&JSON.stringify(x.message.params).includes('STABLE_SEED_REQUEST'));
  assert(stableTurn,'Missing stable native binding witness');
  const stableStart=stableRpc.findLast(x=>x.pid===stableTurn.pid&&x.seq<stableTurn.seq&&x.direction==='to-native'&&x.message.method==='thread/start');
  assert(stableStart,'Missing stable native thread/start');
  const stableAck=stableRpc.find(x=>x.pid===stableStart.pid&&x.seq>stableStart.seq&&x.seq<stableTurn.seq&&x.direction==='from-native'&&x.message.id===stableStart.message.id&&x.message.result?.thread?.id===stableTurn.message.params.threadId);
  assert(stableAck,'Stable native start not acknowledged for its turn');
  const stableNativeThreadId=stableTurn.message.params.threadId;
  const stableNativePath=stableAck.message.result.thread.path;
  const stableNative=await nativeTranscriptSnapshot('stable-before-switch',stableNativeThreadId,stableNativePath);
  await fs.writeFile(path.join(evidence,'stable-native-binding-witness.json'),JSON.stringify({threadId:stableNativeThreadId,proxyPid:stableTurn.pid,startRequestId:stableStart.message.id,startAcknowledgmentSequence:stableAck.seq,turnSequence:stableTurn.seq,rolloutPath:stableNativePath??null},null,2));
  assert(stable.transcripts.some(x=>x.containsSavedLargeHistory),'Stable host did not save large assistant history');
  assert.deepEqual(userSettings(JSON.parse(await fs.readFile(configPath,'utf8'))),stableSettings);
  await installCandidate();
  const candidateVersion=(await command(['--version'],'candidate-version')).trim();
  assert.equal(/\b(\d{4}\.\d+\.\d+)\b/.exec(candidateVersion)?.[1],'2026.10.2');
  const candidateBuildInfo=JSON.parse(await fs.readFile(path.join(installedRoot,'dist/build-info.json'),'utf8'));
  assert.equal(candidateBuildInfo.commit,process.env.CANDIDATE_SHA);
  await command(['doctor','--fix','--non-interactive'],'candidate-doctor',300000);
  const inspection=JSON.parse(await command(['plugins','inspect','codex','--runtime','--json'],'candidate-codex-inspection'));
  const active=inspection.plugin;
  assert.equal(active.id,'codex');assert.equal(active.status,'loaded');assert.equal(active.origin,'bundled');assert.equal(active.version,'2026.10.2');
  const codexRoot=await fs.realpath(path.join(installedRoot,'dist/extensions/codex'));
  const activeSource=await fs.realpath(active.source);assert(activeSource.startsWith(codexRoot+path.sep));
  const activeSourceSha256=sha(await fs.readFile(activeSource));
  await fs.writeFile(path.join(evidence,'installed-identities.json'),JSON.stringify({stableBuildInfo,candidateBuildInfo,codex:{id:active.id,origin:active.origin,version:active.version,activeSourceSha256}},null,2));
  assert.deepEqual(userSettings(JSON.parse(await fs.readFile(configPath,'utf8'))),stableSettings,'Authored policies changed at cutover');
  assertNativePreserved(stableNative,await nativeTranscriptSnapshot('candidate-after-doctor',stableNativeThreadId,stableNativePath));
  await select('full');await startGateway('candidate');await turn('CURRENT_FULL_REQUEST');
  let rpc=await readRows('native-rpc.jsonl');
  const full=seedWitness(rpc,'CURRENT_FULL_REQUEST');
  const items=full.seed.message.params.items;checkItems(items);
  const restored=reconstruct(items);assert(restored.includes(historyText),'Saved large history truncated');
  assert(restored.includes('[user sender={"id":"qa-speaker-a","name":"Synthetic Speaker"}]'));
  assert(restored.includes('[user sender={"id":"qa-speaker-b","name":"Synthetic Follow-up"}]'));
  assert(!restored.includes('CURRENT_FULL_REQUEST'),'Current request leaked into historical carrier');
  assert(!JSON.stringify(full.start.message.params.input).includes('SAVED_STABLE_HISTORY_PREFIX'));
  const all=contents(items);const imageIndex=all.findIndex(x=>x.type==='input_image');
  assert(imageIndex>0);assert.equal(all.filter(x=>x.type==='input_image').length,1);
  assert.deepEqual(all[imageIndex],{type:'input_image',image_url:'data:image/png;base64,'+png});
  assert(reconstruct([{content:all.slice(0,imageIndex)}]).includes('QA_IMAGE_CAPTION'));
  assert(reconstruct([{content:all.slice(imageIndex+1)}]).includes('QA_AFTER_IMAGE'));
  const firstProvider=events.at(-1);assert(JSON.stringify(firstProvider.input).includes('SAVED_STABLE_HISTORY_TAIL'));
  assert(JSON.stringify(firstProvider.input).includes('CURRENT_FULL_REQUEST'));
  // Verify provider-visible fragment sequence, not just the outbound injection RPC.
  const visible=firstProvider.input.filter(x=>x.role==='user'&&Array.isArray(x.content)&&x.content.some(y=>y.type==='input_text'&&y.text.startsWith(fragmentPrefix)));
  checkItems(visible);assert.equal(reconstruct(visible),restored);
  const visibleContent=contents(visible);const visibleImageIndex=visibleContent.findIndex(x=>x.type==='input_image');
  assert.deepEqual(visibleContent.filter(x=>x.type==='input_image'),all.filter(x=>x.type==='input_image'),'Provider altered image bytes/default detail');
  assert(reconstruct([{content:visibleContent.slice(0,visibleImageIndex)}]).includes('QA_IMAGE_CAPTION'));
  assert(reconstruct([{content:visibleContent.slice(visibleImageIndex+1)}]).includes('QA_AFTER_IMAGE'));
  const fullCurrent=firstProvider.input.filter(x=>x.role==='user'&&Array.isArray(x.content)&&x.content.some(y=>y.type==='input_text'&&y.text.includes('CURRENT_FULL_REQUEST')));
  assert.equal(fullCurrent.length,1);assert(!JSON.stringify(fullCurrent[0]).includes(fragmentPrefix.split('\n')[0]));
  const startsBefore=rpc.filter(x=>x.phase==='candidate'&&x.direction==='to-native'&&x.message.method==='thread/start').length;
  await select('delta');await turn('CURRENT_WARM_REQUEST');
  rpc=await readRows('native-rpc.jsonl');const warm=seedWitness(rpc,'CURRENT_WARM_REQUEST');
  assert.equal(warm.start.message.params.threadId,full.start.message.params.threadId,'Warm turn rotated physical thread');
  assert.equal(warm.start.pid,full.start.pid,'Warm turn replaced native process');
  assert.equal(rpc.filter(x=>x.phase==='candidate'&&x.direction==='to-native'&&x.message.method==='thread/start').length,startsBefore);
  assert(reconstruct(warm.seed.message.params.items).includes('SELECTED_WARM_DELTA_ONLY'));
  assert(!reconstruct(warm.seed.message.params.items).includes('SAVED_STABLE_HISTORY_PREFIX'));
  assert(JSON.stringify(events.at(-1).input).includes('SELECTED_WARM_DELTA_ONLY'));
  assert(!reconstruct(warm.seed.message.params.items).includes('CURRENT_WARM_REQUEST'));
  assert(!JSON.stringify(warm.start.message.params.input).includes('SELECTED_WARM_DELTA_ONLY'));
  const warmProvider=events.at(-1);
  const warmCurrent=warmProvider.input.filter(x=>x.role==='user'&&Array.isArray(x.content)&&x.content.some(y=>y.type==='input_text'&&y.text.includes('CURRENT_WARM_REQUEST')));
  assert.equal(warmCurrent.length,1);assert(!JSON.stringify(warmCurrent[0]).includes('SELECTED_WARM_DELTA_ONLY'));
  const beforeFallback=rpc.length;
  await select('fallback');await turn('CURRENT_FALLBACK_REQUEST');
  rpc=await readRows('native-rpc.jsonl');
  const fallbackCalls=rpc.slice(beforeFallback).filter(x=>x.direction==='to-native');
  assert(!fallbackCalls.some(x=>x.message.method==='thread/inject_items'&&JSON.stringify(x.message.params).includes(fragmentPrefix.split('\n')[0])));
  const fallback=fallbackCalls.find(x=>x.message.method==='turn/start');assert(fallback);
  assert.equal(fallback.message.params.threadId,full.start.message.params.threadId);
  assert(JSON.stringify(fallback.message.params.input).includes('CURRENT_FALLBACK_REQUEST'));
  await stopGateway('candidate');
  assertNativePreserved(stableNative,await nativeTranscriptSnapshot('candidate-after-warm',stableNativeThreadId,stableNativePath));
  const beforeCold=rpc.length;
  await select('delta');await startGateway('candidate-cold');await turn('CURRENT_COLD_REQUEST');
  rpc=await readRows('native-rpc.jsonl');const cold=seedWitness(rpc,'CURRENT_COLD_REQUEST');
  const coldCalls=rpc.slice(beforeCold).filter(x=>x.direction==='to-native');
  assert(coldCalls.some(x=>x.message.method==='thread/resume'&&x.message.params.threadId===full.start.message.params.threadId),'Restart did not resume durable native binding');
  assert(!coldCalls.some(x=>x.message.method==='thread/start'),'Cold resume rotated physical thread');
  assert.equal(cold.start.message.params.threadId,full.start.message.params.threadId);
  assert.notEqual(cold.start.pid,full.start.pid,'Cold scenario did not start a new native process');
  assert(reconstruct(cold.seed.message.params.items).includes('SELECTED_WARM_DELTA_ONLY'));
  assert(!reconstruct(cold.seed.message.params.items).includes('CURRENT_COLD_REQUEST'));
  assert(!JSON.stringify(cold.start.message.params.input).includes('SELECTED_WARM_DELTA_ONLY'));
  const coldProvider=events.at(-1);
  assert(JSON.stringify(coldProvider.input).includes('SELECTED_WARM_DELTA_ONLY'));
  const coldCurrent=coldProvider.input.filter(x=>x.role==='user'&&Array.isArray(x.content)&&x.content.some(y=>y.type==='input_text'&&y.text.includes('CURRENT_COLD_REQUEST')));
  assert.equal(coldCurrent.length,1);assert(!JSON.stringify(coldCurrent[0]).includes('SELECTED_WARM_DELTA_ONLY'));
  await stopGateway('candidate-cold');const final=await snapshot('candidate-final');
  assertNativePreserved(stableNative,await nativeTranscriptSnapshot('candidate-final',stableNativeThreadId,stableNativePath));
  for(const old of stable.transcripts)assert(final.transcripts.some(x=>x.sessionId===old.sessionId&&x.seq===old.seq&&x.semanticSha256===old.semanticSha256),'Stable transcript rewritten');
  for(const old of stable.windows)assert(final.windows.some(x=>x.session_id===old.session_id&&x.session_key===old.session_key),'Stable session identity changed');
  assert.deepEqual(userSettings(JSON.parse(await fs.readFile(configPath,'utf8'))),stableSettings);
  assert.equal(events.length,5);assert(events.every(x=>x.model===model));
  await fs.writeFile(path.join(evidence,'authored-policy-final.json'),JSON.stringify(stableSettings,null,2));
  await fs.writeFile(path.join(evidence,'full-receipt.json'),JSON.stringify({candidate:process.env.CANDIDATE_SHA,passed:true,
    entryPoint:'Installed public CLI -> actual Gateway -> transparent public RPC trace -> stock Codex0.160.0 -> synthetic loopback Responses',
    stableVersion,candidateVersion,nativeVersion,stableBuildInfo,candidateBuildInfo,activeCodexSourceSha256:activeSourceSha256,
    upgradeKind:'Published2026.10.3 state reopened by exact patched2026.10.2 package sameprefix with Doctor; lower-semver package switch, NOT managed updater',
    selectedLargeHistorySha256:sha(historyText),reconstructedHistorySha256:sha(restored),historyItems:items.length,maxItemTextBytes:8192,
    selectedValidPng:true,syntheticAttribution:true,realSavedUserMediaMigration:false,
    providerCalls:events.length,seedInferenceCalls:0,warmNativeThreadId:full.start.message.params.threadId,warmNativeProcessId:full.start.pid,
    warmThreadReused:true,coldNativeThreadId:cold.start.message.params.threadId,coldNativeProcessId:cold.start.pid,
    coldResumeNewProcessSameThread:true,legacyNativeThreadId:stableNativeThreadId,legacyNativeRolloutsPreserved:stableNative.files.length,
    providerImageBytesAndDefaultDetailPreserved:true,ordinaryAssemblyFallbackRetained:true,stableTranscriptEntriesPreserved:stable.transcripts.length,
    stableSessionIdentitiesPreserved:stable.windows.length,authoredPoliciesPreserved:true,
    proofGaps:['No paid live-provider/model-quality evidence','Synthetic selected PNG, not saved real-user media migration','No higher-semver managed updater route','No crash-after-injection exactly-once claim; focused owner tests cover acknowledged uncertainty']},null,2));
  console.log('Installed history delivery, native warm reuse and stable-state compatibility proof passed.');
}finally{
  await stopGateway('final-cleanup');provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));
  for(const name of ['lifecycle.jsonl','selections.jsonl','native-rpc.jsonl'])await fs.copyFile(path.join(root,name),path.join(evidence,name)).catch(()=>{});
  await fs.writeFile(path.join(evidence,'provider-inputs.json'),JSON.stringify(events,null,2));
}
