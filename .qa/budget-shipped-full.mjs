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
const root = path.join(process.env.RUNNER_TEMP, 'budget-shipped-full');
const installedEntry=process.env.INSTALLED_ENTRY;
assert(installedEntry,'Missing isolated installed entry');
await fs.mkdir(root, {recursive: true});
const evidence = path.join(process.env.RUNNER_TEMP, 'budget-shipped-full-evidence');
await fs.mkdir(evidence, {recursive: true});
const workspace = path.join(root, 'workspace');
const codexHome = path.join(root, 'codex');
await fs.mkdir(workspace, {recursive: true}); await fs.mkdir(codexHome, {recursive: true});
const events = [];
const provider = http.createServer((req, res) => {
  let data = ''; req.setEncoding('utf8'); req.on('data', x => data += x);
  req.on('end', () => {
    if (req.method !== 'POST' || req.url !== '/v1/responses') return res.writeHead(404).end();
    const request = JSON.parse(data); events.push({model: request.model, input: request.input});
    const item = {id: 'proof-message-'+events.length, type: 'message', role: 'assistant', status: 'completed',
      content: [{type: 'output_text', text: 'BUDGET_PROOF_OK', annotations: []}]};
    const response = {id: 'proof-response-'+events.length, status: 'completed', output: [item],
      usage: {input_tokens: 30, output_tokens: 4, total_tokens: 34}};
    res.writeHead(200, {'Content-Type':'text/event-stream'});
    res.end([{type:'response.created',response:{...response,status:'in_progress',output:[]}},
      {type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},
      {type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:'BUDGET_PROOF_OK'},
      {type:'response.output_item.done',output_index:0,item}, {type:'response.completed',response}]
      .map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  });
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
const providerPort = provider.address().port;
const listener = net.createServer(); await new Promise(resolve => listener.listen(0,'127.0.0.1',resolve));
const gatewayPort = listener.address().port; await new Promise(resolve => listener.close(resolve));
const model = 'budget-proof-model';
const catalog = path.join(root,'models.json');
await fs.writeFile(catalog, JSON.stringify({models:[{slug:model,display_name:'Synthetic budget proof',
  supported_reasoning_levels:[],shell_type:'local',visibility:'list',supported_in_api:true,priority:1,
  support_verbosity:false,truncation_policy:{mode:'bytes',limit:10000},experimental_supported_tools:[],
  context_window:500000,model_messages:{instructions_template:'Reply BUDGET_PROOF_OK.',
    collaboration_modes:{default:'Synthetic policy.'}}}]}));
await fs.writeFile(path.join(codexHome,'config.toml'),[
  `model=${JSON.stringify(model)}`, 'model_provider="budget-fixture"', `model_catalog_json=${JSON.stringify(catalog)}`,
  'cli_auth_credentials_store="ephemeral"','web_search="disabled"','approval_policy="never"','sandbox_mode="read-only"',
  '[model_providers.budget-fixture]','name="Synthetic budget endpoint"',
  `base_url="http://127.0.0.1:${providerPort}/v1"`,'wire_api="responses"','requires_openai_auth=false',
  'supports_websockets=false','request_max_retries=0','stream_max_retries=0',
].join('\n'));
const require = createRequire(path.join(repo,'extensions/codex/package.json'));
const codexLauncher = process.env.PROOF_NATIVE_LAUNCHER ?? path.join(path.dirname(require.resolve('@openai/codex/package.json')),'bin/codex.js');
const pluginDir = path.join(root,'plugin'); await fs.mkdir(pluginDir,{recursive:true});
await fs.copyFile(path.join(process.env.PROOF_TOOL_DIR,'budget-shipped-probe-plugin.mjs'),path.join(pluginDir,'index.mjs'));
await fs.writeFile(path.join(pluginDir,'package.json'),JSON.stringify({name:'budget-proof',version:'1.0.0',type:'module',openclaw:{extensions:['./index.mjs']}}));
await fs.writeFile(path.join(pluginDir,'openclaw.plugin.json'),JSON.stringify({id:'budget-proof',kind:'context-engine',configSchema:{type:'object',additionalProperties:false,properties:{}}}));
const state = path.join(root,'state'); await fs.mkdir(state,{recursive:true});
const configPath = path.join(state,'openclaw.json');
const config = {gateway:{mode:'local',bind:'loopback',port:gatewayPort,auth:{mode:'none'},controlUi:{enabled:false}},
  agents:{defaults:{workspace,model:{primary:'openai/'+model},heartbeat:{every:'0m'}}},
  models:{providers:{openai:{models:[{id:model,name:'Synthetic budget proof',api:'openai-responses',contextTokens:400000,maxTokens:2000,agentRuntime:{id:'codex'}}]}}},
  plugins:{allow:['codex','budget-proof'],load:{paths:[pluginDir]},slots:{contextEngine:'budget-proof'},
    entries:{codex:{enabled:true,config:{appServer:{command:process.execPath,args:[codexLauncher,'app-server'],
      homeScope:'user',sandbox:'read-only',approvalPolicy:'never'},sessionCatalog:{enabled:false}}},'budget-proof':{enabled:true}}}};
await fs.writeFile(configPath,JSON.stringify(config,null,2));
// Explicit allowlist: never inherit GitHub tokens or operator credentials.
const env = {PATH:process.env.PATH,LANG:'C.UTF-8',CI:'true',OPENCLAW_HOME:root,OPENCLAW_STATE_DIR:state,
  OPENCLAW_CONFIG_PATH:configPath,CODEX_HOME:codexHome,OPENCLAW_DISABLE_BONJOUR:'1',OPENCLAW_SKIP_CHANNELS:'1',
  BUDGET_PROOF_ROOT:root,BUDGET_PROOF_PHASE:'stable',TMPDIR:root,
  // Public dummy value: no operator/provider credential is read or stored.
  // User-home native transport remains the unauthenticated loopback fixture.
  OPENAI_API_KEY:'public-synthetic-budget-proof-not-a-credential'};
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
  env.BUDGET_PROOF_PHASE=phase; gatewayLog.length=0;
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
async function lifecycle(){try{return(await fs.readFile(path.join(root,'lifecycle.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(error){if(error.code==='ENOENT')return[];throw error;}}
async function waitFor(predicate,label){const deadline=Date.now()+20000;while(true){const rows=await lifecycle();if(predicate(rows))return rows;if(Date.now()>deadline)throw new Error('Missing '+label);await new Promise(resolve=>setTimeout(resolve,200));}}
function phaseWitness(rows,phase,excludeKey){
  const commitIndex=rows.findIndex(x=>x.phase===phase&&x.event==='commit-result'&&x.status==='committed'&&x.advancementKey!==excludeKey);
  if(commitIndex<0)return undefined;const commit=rows[commitIndex];
  const assembly=rows.slice(0,commitIndex).findLast(x=>x.phase===phase&&x.event==='assemble'&&x.sessionId===commit.sessionId&&x.sessionKey===commit.sessionKey);
  if(!assembly)return undefined;
  const maintenance=rows.slice(commitIndex+1).find(x=>x.phase===phase&&x.event==='maintain'&&x.sessionId===commit.sessionId&&x.sessionKey===commit.sessionKey&&
    x.runtimeSettings?.limits?.promptTokenBudget===assembly.tokenBudget);
  return maintenance?{assembly,commit,maintenance}:undefined;
}
const sessionId='b6c4dd38-0379-48a0-b7bf-c51a54bbf15e';
async function turn(label){const response=JSON.parse(await command(['agent','--agent','main','--session-id',sessionId,'--message',label+' synthetic budget proof. Reply BUDGET_PROOF_OK.','--timeout','90','--json'],label));
  const payloads=response.payloads??response.result?.payloads;assert(payloads?.some(x=>x.text==='BUDGET_PROOF_OK'),'Missing completed assistant reply: '+label);return response;}
const sha=x=>createHash('sha256').update(x).digest('hex');
function snapshot(label){
  assert(!gateway,'Snapshot requires stopped task-owned Gateway');
  const file=path.join(state,'agents/main/agent/openclaw-agent.sqlite');const db=new DatabaseSync(file,{readOnly:true});
  try{const rows=db.prepare('SELECT advancement_key,engine_id,owner_plugin_id,session_id,payload_json,attempt_count,last_error FROM context_engine_turn_outbox ORDER BY created_at').all();
    const transcripts=db.prepare('SELECT session_id,seq,event_json,event_zstd FROM transcript_events ORDER BY session_id,seq').all().map(row=>({sessionId:row.session_id,seq:row.seq,
      semanticSha256:sha(row.event_json??zstdDecompressSync(row.event_zstd).toString('utf8'))}));
    const windows=db.prepare('SELECT session_id,session_key FROM session_windows ORDER BY session_id').all();
    const tables=db.prepare('SELECT name FROM sqlite_schema WHERE type=\'table\' ORDER BY name').all().map(x=>x.name);
    const columns=db.prepare('PRAGMA table_info(context_engine_turn_outbox)').all().map(x=>x.name);
    const schema=db.prepare('SELECT * FROM schema_meta').all();
    const integrity=db.prepare('PRAGMA integrity_check').get();assert.equal(Object.values(integrity)[0],'ok');
    const result={label,fileIdentity:'same isolated agents/main/agent/openclaw-agent.sqlite',rows,transcripts,windows,tables,outboxColumns:columns,schema,integrity:'ok'};
    return fs.writeFile(path.join(evidence,label+'-snapshot.json'),JSON.stringify(result,null,2)).then(()=>result);
  }finally{db.close();}
}
async function installCandidate(){
  const packageFile=process.env.CANDIDATE_TARBALL;const prefix=process.env.INSTALLED_PREFIX;
  assert(packageFile&&prefix);const logs=[];const child=spawn('npm',['install','--global','--prefix',prefix,packageFile,'--no-fund','--no-audit'],{env:{PATH:process.env.PATH,CI:'true'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>logs.push(x));child.stderr.on('data',x=>logs.push(x));
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  await fs.writeFile(path.join(evidence,'candidate-install.log'),Buffer.concat(logs));assert.equal(code,0,'Candidate isolated-prefix install failed');
}
function userSettings(config){return{agents:config.agents,models:config.models,contextEngine:config.plugins.slots.contextEngine,
  contextEntry:config.plugins.entries['budget-proof'],codexAppServer:config.plugins.entries.codex.config.appServer,
  codexCatalog:config.plugins.entries.codex.config.sessionCatalog};}
try {
  // Published stable owns this plugin initially. The candidate bundles patched Codex,
  // and its shipped Doctor owns transfer of distribution/provenance records.
  const installConfig=structuredClone(config);
  installConfig.plugins.allow=['budget-proof'];delete installConfig.plugins.entries.codex;
  await fs.writeFile(configPath,JSON.stringify(installConfig,null,2));
  await command(['plugins','install','npm:@openclaw/codex@2026.10.3','--pin','--accept-capabilities'],'stable-codex-install',600000);
  const afterInstall=JSON.parse(await fs.readFile(configPath,'utf8'));
  afterInstall.plugins.allow=[...new Set([...afterInstall.plugins.allow,'codex'])];
  afterInstall.plugins.entries.codex.enabled=true;
  afterInstall.plugins.entries.codex.config=config.plugins.entries.codex.config;
  await fs.writeFile(configPath,JSON.stringify(afterInstall,null,2));
  const stableSettings=userSettings(afterInstall);
  const stableVersion=(await command(['--version'],'stable-version')).trim();
  assert.equal(/\b(\d{4}\.\d+\.\d+)\b/.exec(stableVersion)?.[1],'2026.10.3');
  const installedRoot=path.dirname(installedEntry);
  const stableBuildInfo=JSON.parse(await fs.readFile(path.join(installedRoot,'dist/build-info.json'),'utf8'));
  const nativeVersion=(await command(['--version'],'native-version',30000,codexLauncher)).trim();
  assert(nativeVersion.includes('0.160.0'),'Unexpected stock native runtime');
  await fs.writeFile(path.join(root,'hold-commits'),'hold before effect');
  await startGateway('stable');await turn('stable-legacy-turn');
  await waitFor(rows=>rows.some(x=>x.phase==='stable'&&x.event==='commit-attempt'),'stable durable commit attempt');
  await stopGateway('stable');const stable=await snapshot('stable-before-switch');
  const legacy=stable.rows.find(x=>JSON.parse(x.payload_json).state==='ready');
  assert(legacy,'Stable produced no real ready outbox row');assert.equal(JSON.parse(legacy.payload_json).runtimeSettings,undefined);
  assert(stable.transcripts.length>0&&stable.windows.some(x=>x.session_id===legacy.session_id));
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
  const activeSource=await fs.realpath(active.source);
  assert(activeSource.startsWith(codexRoot+path.sep),'Active Codex source is not the patched bundled plugin');
  const activeSourceSha256=sha(await fs.readFile(activeSource));
  await fs.writeFile(path.join(evidence,'installed-identities.json'),JSON.stringify({stableBuildInfo,candidateBuildInfo,
    codex:{id:active.id,status:active.status,origin:active.origin,version:active.version,activeSource,activeSourceSha256}},null,2));
  assert.deepEqual(userSettings(JSON.parse(await fs.readFile(configPath,'utf8'))),stableSettings,'Authored policy changed across state cutover');
  await fs.unlink(path.join(root,'hold-commits'));
  await startGateway('candidate-after-stable');await turn('candidate-new-turn');
  let rows=await waitFor(rows=>phaseWitness(rows,'candidate-after-stable',legacy.advancement_key),'new candidate commit-correlated maintenance');
  const recoveredLegacy=rows.find(x=>x.event==='commit-result'&&x.advancementKey===legacy.advancement_key);
  assert(recoveredLegacy&&recoveredLegacy.phase==='candidate-after-stable');assert.equal(recoveredLegacy.runtimeSettings,undefined,'Invented settings on legacy row');
  const firstWitness=phaseWitness(rows,'candidate-after-stable',legacy.advancement_key);
  const {assembly,commit:newCommit,maintenance}=firstWitness;
  assert(assembly.tokenBudget>128000&&assembly.tokenBudget<400000);assert.equal(newCommit.runtimeSettings.limits.promptTokenBudget,assembly.tokenBudget);
  assert.deepEqual(newCommit.runtimeSettings,assembly.runtimeSettings);assert.deepEqual(maintenance.runtimeSettings,assembly.runtimeSettings);
  assert(maintenance);assert.equal(newCommit.sessionId,assembly.sessionId);assert.equal(maintenance.sessionId,assembly.sessionId);
  await stopGateway('candidate-after-stable');const migrated=await snapshot('candidate-after-stable');
  assert(migrated.outboxColumns.includes('payload_state'),'Candidate migration missing additive column');
  assert(!migrated.rows.some(x=>x.advancement_key===legacy.advancement_key),'Legacy row not acknowledged');
  for(const old of stable.transcripts){assert(migrated.transcripts.some(x=>x.sessionId===old.sessionId&&x.seq===old.seq&&x.semanticSha256===old.semanticSha256),'Stable conversation entry changed');}
  for(const old of stable.windows){assert(migrated.windows.some(x=>x.session_id===old.session_id&&x.session_key===old.session_key),'Stable session identity changed');}
  await fs.writeFile(path.join(root,'hold-after-effect'),'hold after idempotent plugin effect');
  await startGateway('candidate-held-ack');await turn('candidate-held-ack-turn');
  rows=await waitFor(rows=>rows.some(x=>x.phase==='candidate-held-ack'&&x.event==='commit-result'&&x.status==='committed'),'effect before held acknowledgment');
  await stopGateway('candidate-held-ack');const held=await snapshot('candidate-pending-recovery');
  const pending=held.rows.find(x=>JSON.parse(x.payload_json).runtimeSettings?.limits?.promptTokenBudget>128000);
  assert(pending,'Candidate settings were not durably queued');const payload=JSON.parse(pending.payload_json);
  const heldAssembly=rows.find(x=>x.phase==='candidate-held-ack'&&x.event==='assemble');
  assert.equal(payload.runtimeSettings.limits.promptTokenBudget,heldAssembly.tokenBudget);
  await fs.unlink(path.join(root,'hold-after-effect'));
  await startGateway('candidate-restart');await turn('candidate-after-restart-turn');
  rows=await waitFor(rows=>rows.some(x=>x.phase==='candidate-restart'&&x.event==='commit-result'&&x.advancementKey===pending.advancement_key),'durable candidate recovery');
  const replay=rows.find(x=>x.phase==='candidate-restart'&&x.event==='commit-result'&&x.advancementKey===pending.advancement_key);
  assert.equal(replay.status,'duplicate','Recovery repeated plugin effect');assert.deepEqual(replay.runtimeSettings,payload.runtimeSettings);
  rows=await waitFor(rows=>phaseWitness(rows,'candidate-restart',pending.advancement_key),'post-restart new-turn commit-correlated maintenance');
  const restartWitness=phaseWitness(rows,'candidate-restart',pending.advancement_key);
  assert(restartWitness.assembly.tokenBudget>128000&&restartWitness.assembly.tokenBudget<400000);
  assert.deepEqual(restartWitness.commit.runtimeSettings,restartWitness.assembly.runtimeSettings);
  assert.deepEqual(restartWitness.maintenance.runtimeSettings,restartWitness.assembly.runtimeSettings);
  await stopGateway('candidate-restart');const final=await snapshot('candidate-final');assert.equal(final.rows.length,0,'Unacknowledged durable rows remain');
  const probe=new DatabaseSync(path.join(root,'probe.sqlite'),{readOnly:true});const effects=probe.prepare('SELECT key FROM commits ORDER BY key').all();probe.close();
  const successful=(await lifecycle()).filter(x=>x.event==='commit-result'&&x.status==='committed');
  assert.equal(effects.length,new Set(successful.map(x=>x.advancementKey)).size);assert.equal(effects.length,4);
  assert.deepEqual(userSettings(JSON.parse(await fs.readFile(configPath,'utf8'))),stableSettings);
  assert(events.length>=4&&events.every(x=>x.model===model));
  await fs.writeFile(path.join(evidence,'full-receipt.json'),JSON.stringify({candidate:process.env.CANDIDATE_SHA,
    entryPoint:'installed shipped CLI -> real Gateway -> stock Codex app-server -> credential-free synthetic Responses endpoint',
    stableVersion,candidateVersion,nativeVersion,nativeCommandContract:'Explicit external appServer command using official pinned 0.160.0 in task-owned proof prefix, matching the source dependency pin; not automatic installed-plugin binary discovery',
    stableBuildInfo,candidateBuildInfo,activeCodexSourceSha256:activeSourceSha256,
    upgradeKind:'Published stable state reopened by exact patched-source installation; lower declared candidate version, NOT normal higher-semver managed updater',
    stableQueuedLegacy:legacy.advancement_key,legacySettingsAbsent:true,existingSettingsPreserved:true,
    stableTranscriptEntriesPreserved:stable.transcripts.length,sessionIdentitiesPreserved:stable.windows.length,
    assemblyAllowance:assembly.tokenBudget,commitAllowance:newCommit.runtimeSettings.limits.promptTokenBudget,
    maintenanceAllowance:maintenance.runtimeSettings.limits.promptTokenBudget,queuedCandidateAllowance:payload.runtimeSettings.limits.promptTokenBudget,
    recoveredCandidateAllowance:replay.runtimeSettings.limits.promptTokenBudget,recoveryEffectStatus:replay.status,
    restartNewTurnAllowance:restartWitness.assembly.tokenBudget,restartMaintenanceAllowance:restartWitness.maintenance.runtimeSettings.limits.promptTokenBudget,
    uniquePluginEffects:effects.length,remainingOutboxRows:final.rows.length,passed:true},null,2));
  console.log('Installed Gateway stable-state and budget recovery proof passed.');
} finally {
  await stopGateway('final-cleanup');provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));
  await fs.copyFile(path.join(root,'lifecycle.jsonl'),path.join(evidence,'lifecycle.jsonl')).catch(()=>{});
  await fs.writeFile(path.join(evidence,'provider-inputs.json'),JSON.stringify(events,null,2));
}
