// Runs ONLY in the secretless hosted QA job, against its built CLI.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const repo = process.cwd();
const root = path.join(process.env.RUNNER_TEMP, 'budget-shipped');
await fs.mkdir(root, {recursive: true});
const evidence = path.join(process.env.RUNNER_TEMP, 'budget-shipped-evidence');
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
const codexLauncher = path.join(path.dirname(require.resolve('@openai/codex/package.json')),'bin/codex.js');
const pluginDir = path.join(root,'plugin'); await fs.mkdir(pluginDir,{recursive:true});
await fs.copyFile(path.join(process.env.PROOF_TOOL_DIR,'budget-shipped-probe-plugin.mjs'),path.join(pluginDir,'index.mjs'));
await fs.writeFile(path.join(pluginDir,'package.json'),JSON.stringify({name:'budget-proof',version:'1.0.0',type:'module',openclaw:{extensions:['./index.mjs']}}));
await fs.writeFile(path.join(pluginDir,'openclaw.plugin.json'),JSON.stringify({id:'budget-proof',kind:'context-engine',configSchema:{type:'object',additionalProperties:false,properties:{}}}));
const state = path.join(root,'state'); await fs.mkdir(state,{recursive:true});
const configPath = path.join(state,'openclaw.json');
const config = {gateway:{mode:'local',bind:'loopback',port:gatewayPort,auth:{mode:'none'},controlUi:{enabled:false}},
  agents:{defaults:{workspace,model:{primary:'openai/'+model},heartbeat:{every:'0m'}}},
  models:{providers:{openai:{models:[{id:model,name:'Synthetic budget proof',contextTokens:400000,maxTokens:2000,agentRuntime:{id:'codex'}}]}}},
  plugins:{allow:['codex','budget-proof'],load:{paths:[pluginDir]},slots:{contextEngine:'budget-proof'},
    entries:{codex:{enabled:true,config:{appServer:{command:process.execPath,args:[codexLauncher,'app-server'],
      homeScope:'user',sandbox:'read-only',approvalPolicy:'never'},sessionCatalog:{enabled:false}}},'budget-proof':{enabled:true}}}};
await fs.writeFile(configPath,JSON.stringify(config,null,2));
// Explicit allowlist: never inherit GitHub tokens or operator credentials.
const env = {PATH:process.env.PATH,LANG:'C.UTF-8',CI:'true',OPENCLAW_HOME:root,OPENCLAW_STATE_DIR:state,
  OPENCLAW_CONFIG_PATH:configPath,CODEX_HOME:codexHome,OPENCLAW_DISABLE_BONJOUR:'1',OPENCLAW_SKIP_CHANNELS:'1',
  BUDGET_PROOF_ROOT:root,BUDGET_PROOF_PHASE:'candidate-pilot',TMPDIR:root,
  // Public dummy value, not a credential. Satisfies host route admission only;
  // native user-home TOML still owns the unauthenticated loopback transport.
  OPENAI_API_KEY:'public-synthetic-budget-proof-not-a-credential'};
let gateway;
const gatewayLog = [];
async function command(args,label,timeout=120000) {
  const output=[]; const stdout=[]; const child=spawn(process.execPath,[path.join(repo,'openclaw.mjs'),...args],{cwd:workspace,env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{output.push(x);stdout.push(x);});child.stderr.on('data',x=>output.push(x));
  const timer=setTimeout(()=>child.kill('SIGTERM'),timeout);
  const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});clearTimeout(timer);
  const text=Buffer.concat(output).toString();await fs.writeFile(path.join(evidence,label+'.log'),text);
  assert.equal(exit.code,0,`${label} failed: ${text.slice(-6000)}`);return Buffer.concat(stdout).toString();
}
try {
  gateway=spawn(process.execPath,[path.join(repo,'openclaw.mjs'),'gateway','run','--bind','loopback','--port',String(gatewayPort)],{cwd:workspace,env,stdio:['ignore','pipe','pipe']});
  const log=gatewayLog;gateway.stdout.on('data',x=>log.push(x));gateway.stderr.on('data',x=>log.push(x));
  // Readiness is an actual socket event, bounded by the owning process deadline.
  const deadline=Date.now()+90000;
  while(true){ if(gateway.exitCode!==null)throw new Error('Gateway exited: '+Buffer.concat(log).toString().slice(-7000));
    const connected=await new Promise(resolve=>{const s=net.connect(gatewayPort,'127.0.0.1');s.once('connect',()=>{s.end();resolve(true);});s.once('error',()=>resolve(false));});
    if(connected)break;if(Date.now()>deadline)throw new Error('Gateway readiness timeout');
    await new Promise(resolve=>setTimeout(resolve,300)); }
  await command(['gateway','health','--json'],'health');
  const response=JSON.parse(await command(['agent','--agent','main','--session-id','b6c4dd38-0379-48a0-b7bf-c51a54bbf15e','--message','Synthetic stable-budget proof request. Reply BUDGET_PROOF_OK.','--timeout','90','--json'],'agent'));
  const payloads=response.payloads ?? response.result?.payloads;
  assert(payloads?.some(x=>x.text==='BUDGET_PROOF_OK'),'Missing actual completed assistant reply');
  const deadlineMaintenance=Date.now()+10000;
  let lifecycle=[];
  while(true){ lifecycle=(await fs.readFile(path.join(root,'lifecycle.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    if(lifecycle.some(x=>x.event==='maintain'))break;if(Date.now()>deadlineMaintenance)throw new Error('Missing maintenance boundary');
    await new Promise(resolve=>setTimeout(resolve,200)); }
  const assemble=lifecycle.find(x=>x.event==='assemble');const commit=lifecycle.find(x=>x.event==='commit-result');const maintenance=lifecycle.find(x=>x.event==='maintain');
  assert(assemble.tokenBudget>128000 && assemble.tokenBudget<400000);
  assert.equal(commit.runtimeSettings.limits.promptTokenBudget,assemble.tokenBudget);
  assert.equal(maintenance.runtimeSettings.limits.promptTokenBudget,assemble.tokenBudget);
  assert.equal(commit.sessionId,assemble.sessionId);assert.equal(maintenance.sessionId,assemble.sessionId);
  assert.equal(commit.sessionKey,assemble.sessionKey);assert.equal(maintenance.sessionKey,assemble.sessionKey);
  assert.equal(typeof commit.advancementKey,'string');assert.equal(commit.status,'committed');
  assert(events.length>0);assert(events.every(x=>x.model===model));
  await fs.writeFile(path.join(evidence,'pilot-receipt.json'),JSON.stringify({candidate:process.env.CANDIDATE_SHA,
    entryPoint:'built openclaw.mjs agent -> real Gateway -> stock Codex app-server -> synthetic Responses endpoint',
    authoredCap:400000,assemblyAllowance:assemble.tokenBudget,commitAllowance:commit.runtimeSettings.limits.promptTokenBudget,
    maintenanceAllowance:maintenance.runtimeSettings.limits.promptTokenBudget,providerRequests:events.length,passed:true},null,2));
  console.log('Shipped Gateway budget boundary pilot passed.');
} finally {
  if(gateway && gateway.exitCode===null){gateway.kill('SIGTERM');await Promise.race([new Promise(resolve=>gateway.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,10000))]);if(gateway.exitCode===null)gateway.kill('SIGKILL');}
  provider.closeAllConnections(); await new Promise(resolve=>provider.close(resolve));
  await fs.writeFile(path.join(evidence,'gateway.log'),Buffer.concat(gatewayLog));
  await fs.copyFile(path.join(root,'lifecycle.jsonl'),path.join(evidence,'lifecycle.jsonl')).catch(()=>{});
  await fs.writeFile(path.join(evidence,'provider-inputs.json'),JSON.stringify(events,null,2));
}
