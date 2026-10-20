// Fork-only installed-package proof. No real Nextcloud/model credentials or services.
import assert from 'node:assert/strict';
import {createHash, createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {overlayQualifiedDist} from './overlay-dist.mjs';
import {setTimeout as delay} from 'node:timers/promises';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'disposable GitHub CI only');
const required = name => assert(process.env[name], `${name} is required`) || process.env[name];
const source = path.resolve(required('OPENCLAW_QA_SOURCE_ROOT'));
const sourceSha = '59cb44796b0f1f0daa0e37af8b1495abb45d9bc1';
const expectedVersion = '2026.10.3';
const sha = value => createHash('sha256').update(value).digest('hex');
const root = path.join(path.resolve(required('RUNNER_TEMP')), 'nextcloud-quotes-live');
const prefix = path.join(root, 'prefix');
const entry = path.join(prefix, 'lib/node_modules/openclaw/openclaw.mjs');
const packageRoot = path.dirname(entry);
await fs.mkdir(root, {recursive:true});
const evidence = path.join(root, 'evidence'), state = path.join(root, 'state'), workspace = path.join(root, 'workspace');
await Promise.all([evidence, state, workspace].map(dir => fs.mkdir(dir)));
const configPath = path.join(state, 'openclaw.json');
const env = {...process.env, OPENCLAW_HOME: root, OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: configPath,
  OPENCLAW_DISABLE_BONJOUR: '1', OPENAI_API_KEY: 'synthetic-quoted-proof-key',
  OPENCLAW_GATEWAY_TOKEN: 'synthetic-quoted-proof-gateway-token'};
for (const key of Object.keys(env)) {
  if ((key.startsWith('OPENCLAW_') && !['OPENCLAW_HOME','OPENCLAW_STATE_DIR','OPENCLAW_CONFIG_PATH','OPENCLAW_DISABLE_BONJOUR','OPENCLAW_GATEWAY_TOKEN'].includes(key)) || ['CODEX_HOME','CODEX_THREAD_ID','ANTHROPIC_API_KEY','PI_CODING_AGENT_DIR'].includes(key)) delete env[key];
}
env.npm_config_registry = 'https://registry.npmjs.org';
env.npm_config_prefix = prefix;
const secret = 'synthetic-nextcloud-quoted-parent-proof-secret-20261019';
const room = 'quoted-proof-room', currentSender = 'users/alice', parentSender = 'users/bob';
const nonce = randomUUID(), parentMarker = `ONLY_IN_PARENT_${nonce}`, parentName = `Quoted author ${nonce}`;
const ordinaryMarker = `ORDINARY_UNQUOTED_${nonce}`;
const currentMarker = `CURRENT_MESSAGE_${nonce}`, controlMarker = `OUTSIDER_CONTROL_${nonce}`;
const ancestorMarker = `EXCLUDED_ANCESTOR_${nonce}`, urlMarker = `UNREFERENCED_URL_${nonce}`, excludedQuoteMarker = `EXCLUDED_OUTSIDER_${nonce}`;
const richMetadataMarker = `UNREFERENCED_PARAMETER_${nonce}`;
const model = 'gpt-5.6-luna', utilityModel = 'gpt-5.6-luna-utility';
const inference = [], utility = [], sends = [], terminal = [], errors = [], commands = [];
let gateway, logStream, modelServer, talkServer, failure, qualification;

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}
async function readBody(req) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; assert(bytes <= 4 * 1024 * 1024); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function eventually(label, inspect) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    assert.equal(errors.length, 0, errors.join('\n'));
    if (gateway) assert.equal(gateway.exitCode, null, 'owned Gateway exited');
    const result = await inspect(); if (result) return result;
    await delay(300);
  }
  throw new Error(`Timeout: ${label}`);
}
async function command(args, label, executable = process.execPath, cli = true) {
  const child = spawn(executable, cli ? [entry, ...args] : args, {env, stdio: ['ignore', 'pipe', 'pipe']});
  const out = [], err = []; child.stdout.on('data', value => out.push(value)); child.stderr.on('data', value => err.push(value));
  const timer = setTimeout(() => child.kill('SIGKILL'), 600_000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); }
  finally { clearTimeout(timer); }
  const stdout = Buffer.concat(out).toString(), stderr = Buffer.concat(err).toString();
  await fs.writeFile(path.join(evidence, `${label}.log`), `${stdout}\n${stderr}`);
  commands.push({label, args, code}); assert.equal(code, 0, `${label}: ${stderr.slice(-1500)}`);
  return stdout;
}
function responseEvents(text, ordinal) {
  const id = `resp_quote_${ordinal}`, itemId = `msg_quote_${ordinal}`;
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
const note = (id, text) => ({type: 'Note', id, name: 'message', content: JSON.stringify({message: text, parameters: []}), mediaType: 'text/markdown'});
async function closeServer(server) {
  if (!server?.listening) return;
  server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve));
}
async function stopGateway() {
  if (!gateway?.pid || gateway.exitCode !== null || gateway.signalCode !== null) return;
  const exit = new Promise(resolve => gateway.once('exit', resolve)); gateway.kill('SIGTERM');
  const timer = setTimeout(() => gateway.kill('SIGKILL'), 10_000);
  await exit.finally(() => clearTimeout(timer));
}

let overlay, stockPlugin, coreBefore, pluginConfigBefore, configBefore;
async function inventory(base, relative='', output={}) {
  for(const item of await fs.readdir(path.join(base,relative),{withFileTypes:true})) {
    const rel=path.posix.join(relative,item.name), full=path.join(base,rel), st=await fs.lstat(full);
    output[rel]={mode:st.mode&0o777, ...(item.isSymbolicLink()?{link:await fs.readlink(full)}:item.isFile()?{sha256:sha(await fs.readFile(full))}:{}), directory:item.isDirectory()};
    if(item.isDirectory()) await inventory(base,rel,output);
  }
  return output;
}
async function inspectTalk(label) {
  const inspected=JSON.parse(await command(['plugins','inspect','nextcloud-talk','--runtime','--json'],label));
  const plugin=inspected.plugin ?? inspected;
  assert.equal(plugin.packageName,'@openclaw/nextcloud-talk'); assert.equal(plugin.version,expectedVersion);
  assert.equal(plugin.trustedOfficialInstall,true); assert.equal(plugin.trust?.reason,'trusted-official');
  assert.equal(await fs.realpath(plugin.rootDir),path.resolve(plugin.rootDir));
  assert(plugin.rootDir.startsWith(root+path.sep)); return plugin;
}
try {
  await command(['install','--global','--prefix',prefix,'--registry','https://registry.npmjs.org','openclaw@2026.10.3','--no-audit','--no-fund'],'install-official-core','npm',false);
  const build=JSON.parse(await fs.readFile(path.join(packageRoot,'dist/build-info.json')));
  assert.equal(build.version,expectedVersion); assert.equal(build.commit,sourceSha);
  coreBefore=await inventory(packageRoot);
  await fs.writeFile(configPath,JSON.stringify({gateway:{mode:'local'},agents:{entries:{main:{}},defaults:{workspace,systemAgent:{agentId:'main'},heartbeat:{every:'0m'}}}}));
  await command(['plugins','install','@openclaw/nextcloud-talk@2026.10.3'],'install-official-managed-talk');
  stockPlugin=await inspectTalk('inspect-stock-talk');
  const installedConfig=JSON.parse(await fs.readFile(configPath));
  pluginConfigBefore=structuredClone(installedConfig.plugins);
  assert(pluginConfigBefore,'official plugin configuration missing');
  // 10.3 owns install records in its SQLite registry, not legacy plugins.installs.
  const officialInstallIdentity = plugin => ({rootDir:plugin.rootDir,origin:plugin.origin,packageName:plugin.packageName,version:plugin.version,trust:plugin.trust});
  const stockInstallIdentity=officialInstallIdentity(stockPlugin);
  // Use the frozen candidate's canonical model owner; no copied provider/model definitions.
  const fixturePath = path.join(source, 'scripts/e2e/lib/fixtures/mock-openai-config.mjs');
  const {applyMockOpenAiModelConfig} = await import(pathToFileURL(fixturePath).href);
  modelServer = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, {'content-type': 'application/json'});
        return res.end(JSON.stringify({object: 'list', data: [model, utilityModel].map(id => ({id, object: 'model', owned_by: 'synthetic-proof'}))}));
      }
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/responses');
      const body = JSON.parse((await readBody(req)).toString());
      const input = JSON.stringify(body.input); let text;
      for (const forbidden of [ancestorMarker,urlMarker,richMetadataMarker,excludedQuoteMarker]) assert(!input.includes(forbidden),`excluded supplemental field reached provider: ${forbidden}`);
      if (body.model === utilityModel) { utility.push({inputSha256: sha(input)}); text = 'Synthetic utility response.'; }
      else {
        assert.equal(body.model, model); const kind = input.includes(ordinaryMarker) ? 'ordinary' : input.includes(controlMarker) ? 'control' : 'main';
        assert(input.includes(kind === 'ordinary' ? ordinaryMarker : kind === 'control' ? controlMarker : currentMarker), 'current request missing');
        if (kind === 'main') { assert(input.includes(parentMarker), 'parent-only nonce absent from actual provider input'); assert(input.includes(parentName), 'quoted sender absent'); }
        text = `QUOTE_PROOF_${kind.toUpperCase()}_${nonce}`;
        inference.push({kind, inputSha256: sha(input), inputBytes: Buffer.byteLength(input), answer: text});
        await fs.writeFile(path.join(evidence, `provider-${inference.length}.json`), JSON.stringify(body, null, 2));
      }
      const events = responseEvents(text, inference.length + utility.length);
      res.writeHead(200, {'content-type': body.stream === false ? 'application/json' : 'text/event-stream'});
      if (body.stream === false) res.end(JSON.stringify(events.at(-1).response));
      else { for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`); res.end('data: [DONE]\n\n'); }
    } catch (error) { errors.push(`provider: ${error}`); res.writeHead(500); res.end('synthetic provider assertion failed'); }
  });
  const modelPort = await listen(modelServer);
  talkServer = http.createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST', 'no quote/history/media fetching allowed');
      assert.equal(req.url, `/ocs/v2.php/apps/spreed/api/v1/bot/${room}/message`);
      const body = JSON.parse((await readBody(req)).toString());
      const random = req.headers['x-nextcloud-talk-bot-random'], signature = req.headers['x-nextcloud-talk-bot-signature'];
      assert.equal(typeof random, 'string'); assert.equal(typeof signature, 'string');
      const expected = createHmac('sha256', secret).update(random).update(body.message).digest('hex');
      assert.equal(signature.length, expected.length); assert(timingSafeEqual(Buffer.from(signature), Buffer.from(expected)), 'bot POST HMAC');
      const inferenceCase = inference.find(item => item.answer === body.message); assert(inferenceCase, 'unexpected outbound text');
      assert.equal(String(body.replyTo), {main:'201',control:'202',ordinary:'203'}[inferenceCase.kind], 'must reply to exact current message, not quoted parent');
      sends.push({id: String(800 + sends.length), ...body, signed: true});
      res.writeHead(201, {'content-type': 'application/json'});
      res.end(JSON.stringify({ocs: {meta: {status: 'ok', statuscode: 100}, data: {id: sends.at(-1).id, timestamp: Math.floor(Date.now() / 1000)}}}));
    } catch (error) { errors.push(`Talk stub: ${error}`); res.writeHead(500); res.end('synthetic Talk assertion failed'); }
  });
  const talkPort = await listen(talkServer), origin = `http://127.0.0.1:${talkPort}`;
  const reservation = net.createServer(), gatewayPort = await listen(reservation); await closeServer(reservation);
  await fs.writeFile(path.join(root, 'bot-secret'), secret, {mode: 0o600});
  await fs.writeFile(path.join(workspace, 'AGENTS.md'), '# Disposable quoted-message proof\nReply normally; no tools are needed.\n');
  const cfg = {
    gateway: {mode: 'local', bind: 'loopback', port: gatewayPort, auth: {mode: 'token', token: env.OPENCLAW_GATEWAY_TOKEN}, controlUi: {enabled: false}},
    agents: {entries: {main: {}}, defaults: {workspace, systemAgent: {agentId: 'main'}, heartbeat: {every: '0m'}}},
    memory: {search: {enabled: false}},
    accessGroups: {operators: {type: 'message.senders', members: {'nextcloud-talk': [currentSender, parentSender]}}},
    plugins: {...installedConfig.plugins, enabled: true, allow: [...new Set([...(installedConfig.plugins?.allow ?? []),'openai','nextcloud-talk'])], entries: {...installedConfig.plugins?.entries, openai: {enabled: true}, 'nextcloud-talk': {...installedConfig.plugins?.entries?.['nextcloud-talk'],enabled: true}}},
    channels: {defaults: {contextVisibility: 'allowlist'}, 'nextcloud-talk': {enabled: true, baseUrl: origin, botSecretFile: path.join(root, 'bot-secret'), legacyWebhook: false,
      network: {dangerouslyAllowPrivateNetwork: true}, groupPolicy: 'allowlist', groupAllowFrom: ['accessGroup:operators'], allowFrom: ['accessGroup:operators'],
      rooms: {[room]: {requireMention: false}}, streaming: {block: {enabled: false}}}},
    logging: {level: 'debug', consoleLevel: 'debug', file: path.join(evidence, 'gateway-core.jsonl')},
  };
  applyMockOpenAiModelConfig(cfg, {mockPort: modelPort, modelRef: `openai/${model}`, utilityModelRef: `openai/${utilityModel}`});
  for (const agent of Object.values(cfg.agents.entries ?? {})) agent.memory = {...agent.memory, search:{...agent.memory?.search, enabled:false}};
  await fs.writeFile(configPath, JSON.stringify(cfg));
  configBefore=await fs.readFile(configPath);
  overlay=await overlayQualifiedDist({root,pluginRoot:stockPlugin.rootDir,evidence});
  assert.deepEqual(await fs.readFile(configPath),configBefore,'overlay changed authored settings');
  assert.deepEqual(JSON.parse(configBefore).plugins.installs,pluginConfigBefore.installs,'install records changed');
  await command(['config', 'validate'], 'config-validate');
  const candidate=await inspectTalk('inspect-candidate-talk');
  assert.equal(candidate.rootDir,stockPlugin.rootDir); assert.equal(candidate.status,'loaded');
  assert.deepEqual(officialInstallIdentity(candidate),stockInstallIdentity,'official registry provenance changed');
  const openaiInspection=JSON.parse(await command(['plugins','inspect','openai','--runtime','--json'],'inspect-openai'));
  const openai=openaiInspection.plugin ?? openaiInspection;
  assert.equal(openai.status,'loaded');
  assert.equal(await fs.realpath(openai.rootDir),await fs.realpath(path.join(packageRoot,'dist/extensions/openai')));
  const requireFromPlugin=createRequire(path.join(candidate.rootDir,'package.json'));
  const sdkAttribution=[];
  for(const name of ['channel-outbound','channel-inbound','security-runtime']) {
    const resolved=await fs.realpath(requireFromPlugin.resolve(`openclaw/plugin-sdk/${name}`));
    assert.equal(resolved,await fs.realpath(path.join(packageRoot,`dist/plugin-sdk/${name}.js`)));
    sdkAttribution.push({name,resolved,sha256:sha(await fs.readFile(resolved))});
  }
  assert.deepEqual(await inventory(packageRoot),coreBefore,'official core/dependency tree changed');
  await fs.writeFile(path.join(evidence,'official-install.json'),JSON.stringify({status:'PASS',version:expectedVersion,commit:sourceSha,officialTrust:true,pluginRoot:candidate.rootDir,installRecordsPreserved:true,configSha256:sha(configBefore),coreInventorySha256:sha(JSON.stringify(coreBefore)),coreFiles:Object.keys(coreBefore).length,sdkAttribution,overlay},null,2));
  logStream = createWriteStream(path.join(evidence, 'gateway.log'));
  gateway = spawn(process.execPath, [entry, 'gateway', 'run', '--port', String(gatewayPort), '--bind', 'loopback'], {env, stdio: ['ignore', 'pipe', 'pipe']});
  gateway.stdout.pipe(logStream, {end: false}); gateway.stderr.pipe(logStream, {end: false}); gateway.once('error', error => errors.push(`Gateway: ${error}`));
  await eventually('installed Gateway ready', async () => { try { return (await fetch(`http://127.0.0.1:${gatewayPort}/readyz`, {signal: AbortSignal.timeout(2000)})).ok; } catch { return false; } });
  await eventually('Talk durable webhook route ready', async () => {
    try { return (await fs.readFile(path.join(evidence, 'gateway-core.jsonl'), 'utf8')).includes(`Gateway webhook route ready at port ${gatewayPort}/nextcloud-talk-webhook;`); }
    catch { return false; }
  });
  const parent = {type: 'Note', actor: {type: 'Person', id: parentSender, name: parentName}, object: {...note('101', parentMarker),
    inReplyTo: {type: 'Note', actor: {type: 'Person', id: 'users/ancestor', name: 'Ancestor'}, object: note('99', ancestorMarker)},
    content: JSON.stringify({message:parentMarker,parameters:{unreferenced:{type:'user',name:richMetadataMarker}}}),
    url: `${origin}/${urlMarker}`}};
  const cases = [{id:'201',text:currentMarker,parent},{id:'202',text:controlMarker,parent:{type:'Note',actor:{type:'Person',id:'users/outsider',name:'Outsider'},object:note('102',excludedQuoteMarker)}},{id:'203',text:ordinaryMarker}];
  for (const [index, item] of cases.entries()) {
    const startedAt = Date.now(), logOffset=(await fs.readFile(path.join(evidence,'gateway.log'))).length;
    const payload = {type: 'Create', actor: {type: 'Person', id: currentSender, name: 'Current author'},
      object: {...note(item.id, item.text), ...(item.parent?{inReplyTo:item.parent}:{})}, target: {type: 'Collection', id: room, name: 'Quoted proof room'}};
    const raw = JSON.stringify(payload), random = randomUUID(), signature = createHmac('sha256', secret).update(random).update(raw).digest('hex');
    await fs.writeFile(path.join(evidence, `webhook-${item.id}.json`), raw);
    const accepted = await fetch(`http://127.0.0.1:${gatewayPort}/nextcloud-talk-webhook`, {method: 'POST', body: raw,
      headers: {'content-type': 'application/json', 'x-nextcloud-talk-backend': origin + '/', 'x-nextcloud-talk-random': random, 'x-nextcloud-talk-signature': signature}, signal: AbortSignal.timeout(10_000)});
    assert.equal(accepted.status, 200); assert.equal(accepted.headers.get('x-openclaw-delivery-accepted'), 'durable'); await accepted.arrayBuffer();
    await eventually(`case ${item.id} bot send`, () => sends.length === index + 1);
    const completed=await eventually(`case ${item.id} settled`,async()=>{
      const log=(await fs.readFile(path.join(evidence,'gateway.log'))).subarray(logOffset).toString();
      const pattern=new RegExp(`message processed: channel=nextcloud-talk chatId=([^ ]+) messageId=${item.id}\\b sessionId=([^ ]+) sessionKey=([^ ]+) outcome=(\\w+)`,'g');
      const unique=new Map([...log.matchAll(pattern)].map(match=>[match[0],match]));
      assert(unique.size<=1,'conflicting current-message terminal diagnostics');
      return [...unique.values()][0];
    });
    assert.equal(completed[4],'completed'); assert(completed[3].includes(`nextcloud-talk:group:${room}`));
    const described=await eventually(`case ${item.id} session done/inactive`,async()=>{
      const result=JSON.parse(await command(['gateway','call','sessions.describe','--params',JSON.stringify({key:completed[3]}),'--json'],`session-${item.id}-${terminal.length}-${Date.now()}`));
      assert(result.session); assert(!result.session.lastRunError);
      if(Object.hasOwn(result.session,'key')) assert.equal(result.session.key,completed[3]);
      if(Object.hasOwn(result.session,'sessionId')) assert.equal(result.session.sessionId,completed[2]);
      return result.session.status==='done' && result.session.hasActiveRun===false ? result : undefined;
    });
    if(Object.hasOwn(described.session,'endedAt')) {assert.equal(typeof described.session.endedAt,'number');assert(described.session.endedAt>=startedAt);}
    terminal.push({messageId:item.id,outcome:completed[4],diagnostic:completed[0],diagnosticSessionId:completed[2],sessionKey:completed[3],logOffset,startedAt,endedAtEvidence:Object.hasOwn(described.session,'endedAt')?'numeric and current':'not exposed by10.3; exact current-message diagnostic after pre-trigger log checkpoint plus same-session done/inactive',session:described.session});
  }
  assert.deepEqual(inference.map(item=>item.kind),['main','control','ordinary']); assert.equal(sends.length,3);assert.equal(errors.length,0);
  assert.equal(new Set(terminal.map(item=>item.diagnosticSessionId)).size,1,'same room changed session');
  assert.equal(new Set(terminal.map(item=>item.sessionKey)).size,1);
  assert.deepEqual(await fs.readFile(configPath),configBefore,'runtime changed authored settings');
  assert.deepEqual(officialInstallIdentity(await inspectTalk('inspect-final-talk')),stockInstallIdentity,'runtime changed official registry provenance');
  assert.deepEqual(await inventory(packageRoot),coreBefore,'runtime changed official core/dependency tree');

  qualification={status: 'PASS', scope: 'Official npm10.3/core59 Gateway and official managed Talk with composed qualified dist-only overlay; signed synthetic Talk webhook and checked actual Responses input. Not production, real Talk/client/model or upstream-head proof.',
    sourceSha, expectedVersion, producerRun:overlay.producerRun,sourceManifestSha256:overlay.sourceManifestSha256,distArtifactSha256:overlay.distArtifactSha256,officialManagedTrust:true,configUnchanged:true,coreTreeUnchanged:true,entrySha256:sha(await fs.readFile(entry)),fixtureSha256:sha(await fs.readFile(fixturePath)), inference, utility, sends, terminal, commands};
} catch (error) { failure = error; }
finally {
  await stopGateway(); if (logStream) await new Promise(resolve => logStream.end(resolve));
  await closeServer(talkServer); await closeServer(modelServer);
  const cleanup={ownedGatewayStopped:!gateway || gateway.exitCode!==null || gateway.signalCode!==null,serversClosed:!talkServer?.listening && !modelServer?.listening,error:failure?String(failure):undefined,errors,inference,sends,terminal,commands};
  await fs.writeFile(path.join(evidence,'cleanup.json'),JSON.stringify(cleanup,null,2));
  assert(cleanup.ownedGatewayStopped && cleanup.serversClosed,'owned fixture cleanup incomplete');
  if(!failure) await fs.writeFile(path.join(evidence,'qualification.json'),JSON.stringify({...qualification,cleanupPassed:true},null,2));
  process.stdout.write(`Evidence: ${evidence}\n`);
}
if (failure) throw failure;
