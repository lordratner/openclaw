// CI-only real Talk protocol proof. Notification suppression; never production state.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';


assert.equal(process.env.GITHUB_ACTIONS, 'true');
const root = path.join(process.env.RUNNER_TEMP, 'nextcloud-silent-live');
const evidence = path.join(root, 'evidence');
await fs.mkdir(evidence, {recursive: true});
const origin = 'http://127.0.0.1:18080';
const user = 'outbound-proof', recipient = 'outbound-recipient';
const password = 'nextcloud-disposable-proof-password';
const token = 'disposable-silent-proof-gateway-token';
const authorization = actor => `Basic ${Buffer.from(`${actor}:${password}`).toString('base64')}`;
const sha = value => createHash('sha256').update(value).digest('hex');
const steps = [], cases = [], utility = [], errors = [];
const mainModel = 'gpt-5.6-luna', utilityModel = 'gpt-5.6-luna-utility';
const state = path.join(root, 'state'), workspace = path.join(root, 'workspace');
const packageRoot = path.join(root, 'prefix/node_modules/openclaw');
const entry = path.join(packageRoot, 'openclaw.mjs');
const configPath = path.join(state, 'openclaw.json');
const env = {...process.env, HOME: root, OPENCLAW_HOME: root, OPENCLAW_STATE_DIR: state,
  OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_DISABLE_BONJOUR: '1', OPENCLAW_GATEWAY_TOKEN: token,
  OPENAI_API_KEY: 'synthetic-no-real-provider-key'};
for (const key of ['CODEX_HOME', 'GH_TOKEN', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY']) delete env[key];
let gateway, log, speech, failure;

async function listen(server) {
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  return server.address().port;
}
async function close(server) {
  if (!server?.listening) return;
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}
function utilityResponseEvents(text, ordinal) {
  const id = `resp_voice_utility_${ordinal}`, itemId = `msg_voice_utility_${ordinal}`;
  const part = {type: 'output_text', text, annotations: []};
  const item = {type: 'message', id: itemId, role: 'assistant', status: 'completed', phase: 'final_answer', content: [part]};
  const position = {item_id: itemId, output_index: 0, content_index: 0};
  return [
    {type: 'response.created', response: {id, object: 'response', status: 'in_progress', output: [], created_at: Math.floor(Date.now() / 1000)}},
    {type: 'response.output_item.added', output_index: 0, item: {...item, content: [], status: 'in_progress'}},
    {type: 'response.content_part.added', ...position, part: {...part, text: ''}},
    {type: 'response.output_text.delta', ...position, delta: text},
    {type: 'response.output_text.done', ...position, text},
    {type: 'response.content_part.done', ...position, part},
    {type: 'response.output_item.done', output_index: 0, item},
    {type: 'response.completed', response: {id, object: 'response', status: 'completed', output: [item], usage: {input_tokens: 64, output_tokens: 16, total_tokens: 80}}},
  ];
}
async function command(executable, args, label) {
  const started = Date.now();
  const child = spawn(executable, args, {env, stdio: ['ignore', 'pipe', 'pipe']});
  const output = [], stderr = [];
  child.stdout.on('data', value => output.push(value));
  child.stderr.on('data', value => stderr.push(value));
  const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
  const code = await new Promise((resolve, reject) => {child.once('error', reject); child.once('exit', resolve);}).finally(() => clearTimeout(timer));
  const text = Buffer.concat(output).toString();
  await fs.writeFile(path.join(evidence, `${label}.log`), text + '\n' + Buffer.concat(stderr));
  steps.push({label, code, wallMs: Date.now() - started});
  assert.equal(code, 0, label);
  return text;
}
const cli = (args, label) => command(process.execPath, [entry, ...args], label);
async function ocs(actor, endpoint, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(origin + '/ocs/v2.php' + endpoint, {
    method, headers: {Authorization: authorization(actor), 'OCS-APIRequest': 'true', Accept: 'application/json'},
    ...(body ? {body: new URLSearchParams(body)} : {}), signal: AbortSignal.timeout(30_000), redirect: 'error',
  });
  assert(response.ok, `OCS ${response.status}`);
  if (response.status === 204) return [];
  const result = await response.json();
  assert.equal(result.ocs.meta.status, 'ok');
  return result.ocs.data;
}
const history = room => ocs(recipient, `/apps/spreed/api/v1/chat/${room}?lookIntoFuture=0&limit=50&setReadMarker=0&noStatusUpdate=1&markNotificationsAsRead=0`);
async function eventually(label, inspect) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    assert.equal(errors.length, 0, errors.join('\n'));
    if (gateway) assert.equal(gateway.exitCode, null);
    if (await inspect()) return;
    await delay(300);
  }
  throw new Error(`Timeout: ${label}`);
}

try {
  await Promise.all([state, workspace].map(dir => fs.mkdir(dir)));
  await command('npm', ['install', '--prefix', path.join(root, 'prefix'), '--no-audit', '--no-fund', process.env.CANDIDATE_TARBALL], 'install-candidate');
  const build = JSON.parse(await fs.readFile(path.join(packageRoot, 'dist/build-info.json')));
  assert.equal(build.commit, process.env.SOURCE_SHA);
  const document = path.join(workspace, 'report.pdf');
  const documentBytes = Buffer.from('%PDF-1.4\nSynthetic quiet-send proof\n%%EOF\n');
  await fs.writeFile(document, documentBytes);
  speech = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, {'content-type':'application/json'});
        return res.end(JSON.stringify({object:'list',data:[mainModel,utilityModel].map(id=>({id,object:'model',owned_by:'synthetic-proof'}))}));
      }
      assert.equal(req.url, '/v1/responses');
      const chunks=[]; for await (const chunk of req) chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(body.model,utilityModel);
      utility.push({model:body.model});
      const events=utilityResponseEvents('Synthetic silent-send proof completed.',utility.length);
      res.writeHead(200,{'content-type':body.stream===false?'application/json':'text/event-stream'});
      if(body.stream===false)return res.end(JSON.stringify(events.at(-1).response));
      for(const event of events)res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.end('data: [DONE]\n\n');
    }catch(error){errors.push(String(error));res.writeHead(500);res.end('fixture failed');}
  });
  const speechPort=await listen(speech);
  const reserve=net.createServer(), gatewayPort=await listen(reserve); await close(reserve);
  const room=await ocs(user,'/apps/spreed/api/v4/room',{roomType:'2',roomName:'Disposable silent-send proof'});
  await ocs(user,`/apps/spreed/api/v4/room/${room.token}/participants`,{newParticipant:recipient});
  const secret='nextcloud-disposable-silent-proof-secret-20261021';
  await command('docker',['exec','--user','www-data','nextcloud-silent-proof','php','occ','talk:bot:install','Quiet proof',secret,'https://fixture.invalid/webhook','--feature','response'],'install-disposable-response-bot');
  const bots=await ocs(user,'/apps/spreed/api/v1/bot/admin');
  const bot=bots.find(item=>item.name==='Quiet proof'); assert(bot);
  await ocs(user,`/apps/spreed/api/v1/bot/${room.token}/${bot.id}`,{},'POST');
  const parent=await ocs(recipient,`/apps/spreed/api/v1/chat/${room.token}`,{message:'Synthetic parent for quiet replies'});
  const apiPasswordFile=path.join(root,'app-password'),botSecretFile=path.join(root,'bot-secret');
  await fs.writeFile(apiPasswordFile,password,{mode:0o600});await fs.writeFile(botSecretFile,secret,{mode:0o600});
  const cfg={
    gateway:{mode:'local',bind:'loopback',port:gatewayPort,auth:{mode:'token',token},controlUi:{enabled:false}},
    agents:{entries:{main:{}},defaults:{workspace,systemAgent:{agentId:'main'},heartbeat:{every:'0m'}}},
    memory:{search:{enabled:false}}, tools:{profile:'full'},
    plugins:{enabled:true,allow:['nextcloud-talk','openai'],entries:{'nextcloud-talk':{enabled:true},openai:{enabled:true}}},
    channels:{'nextcloud-talk':{enabled:true,baseUrl:origin,botSecretFile,apiUser:user,apiPasswordFile,legacyWebhook:false,
      textChunkLimit:120,network:{dangerouslyAllowPrivateNetwork:true},groupPolicy:'allowlist',rooms:{[room.token]:{requireMention:false}}}},
    tts:{auto:'off'}, logging:{level:'debug',consoleLevel:'debug',file:path.join(evidence,'gateway-core.jsonl')},
  };
  const {applyMockOpenAiModelConfig}=await import(pathToFileURL(path.resolve('scripts/e2e/lib/fixtures/mock-openai-config.mjs')).href);
  applyMockOpenAiModelConfig(cfg,{mockPort:speechPort,modelRef:`openai/${mainModel}`,utilityModelRef:`openai/${utilityModel}`});
  await fs.writeFile(configPath,JSON.stringify(cfg));
  await cli(['plugins','enable','openai','nextcloud-talk','--accept-capabilities'],'admit-bundled-plugins');
  await cli(['config','validate'],'validate-config');
  const inspected=JSON.parse(await cli(['plugins','inspect','nextcloud-talk','--runtime','--json'],'inspect-talk'));
  const plugin=inspected.plugin??inspected;assert.equal(plugin.status,'loaded');
  assert.equal(await fs.realpath(plugin.rootDir),await fs.realpath(path.join(packageRoot,'dist/extensions/nextcloud-talk')));
  const beforeConfig=await fs.readFile(configPath);
  log=createWriteStream(path.join(evidence,'gateway.log'));
  gateway=spawn(process.execPath,[entry,'gateway','run','--port',String(gatewayPort),'--bind','loopback'],{env,stdio:['ignore','pipe','pipe']});
  gateway.stdout.pipe(log,{end:false});gateway.stderr.pipe(log,{end:false});gateway.once('error',error=>errors.push(String(error)));
  await eventually('Gateway ready',async()=>{try{return(await fetch(`http://127.0.0.1:${gatewayPort}/readyz`,{signal:AbortSignal.timeout(2000)})).ok;}catch{return false;}});
  await eventually('Talk route ready',async()=>{try{return(await fs.readFile(path.join(evidence,'gateway-core.jsonl'),'utf8')).includes('Gateway webhook route ready');}catch{return false;}});
  const notificationPath='/apps/notifications/api/v2/notifications';
  const notifications=()=>ocs(recipient,notificationPath);
  async function send(label,{silent,media=false,caption=true,long=false}){
    await ocs(recipient,notificationPath,undefined,'DELETE');
    assert.equal((await notifications()).length,0,'empty notification baseline');
    const prior=new Set((await history(room.token)).map(message=>String(message.id)));
    const text=caption?`${label} @${recipient} Synthetic briefing. `:'';
    const args={action:'send',channel:'nextcloud-talk',target:room.token,message:long?text.repeat(12):text,
      replyTo:String(parent.id),silent,...(media?{media:document}:{})};
    const response=await fetch(`http://127.0.0.1:${gatewayPort}/tools/invoke`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'content-type':'application/json','x-openclaw-message-channel':'nextcloud-talk','x-openclaw-message-to':room.token},body:JSON.stringify({tool:'message',sessionKey:'main',args}),signal:AbortSignal.timeout(120000)});
    const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.ok,true,JSON.stringify(result));
    const added=(await history(room.token)).filter(message=>!prior.has(String(message.id))&&(media?message.actorId===user&&message.messageParameters?.file:message.actorType==='bots'&&!message.systemMessage));
    assert(added.length>0,'visible message must be published');
    if(long)assert(added.length>1,'long text must exercise physical chunks');else assert.equal(added.length,1);
    assert(added.every(message=>Boolean(message.silent)===silent),'every physical message has expected silent state');
    assert(added.every(message=>media?message.actorId===user:message.actorType==='bots'),'sending identity unchanged');
    if(caption)assert(added.some(message=>Object.values(message.messageParameters??{}).some(value=>value?.type==='user'&&value.id===recipient)),'server must actually parse recipient mention');
    const notice=await notifications();
    if(silent)assert.equal(notice.length,0,'quiet mentions/replies produce no recipient notification');
    else assert(notice.some(item=>item.app==='spreed'),'ordinary send positive control produces a Talk notification');
    if(media){
      const file=added[0].messageParameters.file;
      const download=await fetch(`${origin}/remote.php/dav/files/${recipient}/${file.path.split('/').map(encodeURIComponent).join('/')}`,{headers:{Authorization:authorization(recipient)},redirect:'error'});
      assert(download.ok);assert.equal(sha(Buffer.from(await download.arrayBuffer())),sha(documentBytes));
    }
    cases.push({label,silent,nativeChatIds:added.map(message=>String(message.id)),physicalMessages:added.length,recipientNotifications:notice.length,visible:true,identitiesPreserved:true,recipientByteEquality:media?true:undefined});
  }
  await send('ordinary-text',{silent:false});
  await send('quiet-text-mention',{silent:true});
  await send('quiet-chunked-text',{silent:true,long:true});
  await send('quiet-captioned-file',{silent:true,media:true});
  await send('quiet-captionless-file-reply',{silent:true,media:true,caption:false});
  await send('ordinary-file-control',{silent:false,media:true});
  assert.deepEqual(await fs.readFile(configPath),beforeConfig);
}catch(error){failure=error;}
finally{
  if(gateway?.pid&&gateway.exitCode===null&&gateway.signalCode===null){
    const stopped=new Promise(resolve=>gateway.once('exit',resolve));gateway.kill('SIGTERM');const timer=setTimeout(()=>gateway.kill('SIGKILL'),10000);await stopped.finally(()=>clearTimeout(timer));
  }
  if(log)await new Promise(resolve=>log.end(resolve));await close(speech);
  if(errors.length)failure??=new Error(errors.join('; '));
  await fs.writeFile(path.join(evidence,'qualification.json'),JSON.stringify({status:failure?'FAIL':'PASS',source:process.env.SOURCE_SHA,
    scope:'Exact built package through installed isolated Gateway message tool and real disposable Nextcloud35/Talk25.0.6. Recipient notification API provides real server notification-state evidence, not audible/mobile push observation or a real LLM conversation. No production state.',
    error:failure?String(failure):undefined,cases,steps,utility,errors,ownedGatewayStopped:!gateway||gateway.exitCode!==null||gateway.signalCode!==null,fixtureServerClosed:!speech?.listening},null,2));
}
if(failure)throw failure;
