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
import {setTimeout as delay} from 'node:timers/promises';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'disposable GitHub CI only');
const required = name => assert(process.env[name], `${name} is required`) || process.env[name];
const entry = path.resolve(process.argv[2] ?? required('OPENCLAW_QA_ENTRY'));
const source = path.resolve(required('OPENCLAW_QA_SOURCE_ROOT'));
const sourceSha = required('OPENCLAW_QA_SOURCE_SHA');
const expectedVersion = required('OPENCLAW_QA_EXPECTED_VERSION');
const tarball = path.resolve(required('OPENCLAW_QA_PACKAGE_TARBALL'));
const tarballSha = required('OPENCLAW_QA_PACKAGE_SHA256');
assert.match(sourceSha, /^[a-f0-9]{40}$/);
assert.match(tarballSha, /^[a-f0-9]{64}$/);
const sha = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha(await fs.readFile(tarball)), tarballSha, 'candidate artifact identity');
const packageRoot = path.dirname(entry);
const pkg = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json')));
assert.equal(pkg.name, 'openclaw');
assert.equal(pkg.version, expectedVersion);
const root = await fs.mkdtemp(path.join(path.resolve(required('RUNNER_TEMP')), 'quoted-gateway-'));
const evidence = path.join(root, 'evidence'), state = path.join(root, 'state'), workspace = path.join(root, 'workspace');
await Promise.all([evidence, state, workspace].map(dir => fs.mkdir(dir)));
const configPath = path.join(state, 'openclaw.json');
const env = {...process.env, OPENCLAW_HOME: root, OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: configPath,
  OPENCLAW_DISABLE_BONJOUR: '1', OPENAI_API_KEY: 'synthetic-quoted-proof-key',
  OPENCLAW_GATEWAY_TOKEN: 'synthetic-quoted-proof-gateway-token'};
const secret = 'synthetic-nextcloud-quoted-parent-proof-secret-20261019';
const room = 'quoted-proof-room', currentSender = 'users/quoted-proof-current', parentSender = 'users/quoted-proof-parent';
const nonce = randomUUID(), parentMarker = `ONLY_IN_PARENT_${nonce}`, parentName = `Quoted author ${nonce}`;
const currentMarker = `CURRENT_MESSAGE_${nonce}`, controlMarker = `MALFORMED_CONTROL_${nonce}`;
const ancestorMarker = `EXCLUDED_ANCESTOR_${nonce}`, urlMarker = `UNREFERENCED_URL_${nonce}`, malformedMarker = `EXCLUDED_MALFORMED_${nonce}`;
const model = 'gpt-5.6-luna', utilityModel = 'gpt-5.6-luna-utility';
const inference = [], utility = [], sends = [], terminal = [], errors = [], commands = [];
let gateway, logStream, modelServer, talkServer, failure;

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
async function command(args, label) {
  const child = spawn(process.execPath, [entry, ...args], {env, stdio: ['ignore', 'pipe', 'pipe']});
  const out = [], err = []; child.stdout.on('data', value => out.push(value)); child.stderr.on('data', value => err.push(value));
  const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
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

try {
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
      if (body.model === utilityModel) { utility.push({inputSha256: sha(input)}); text = 'Synthetic utility response.'; }
      else {
        assert.equal(body.model, model); const control = input.includes(controlMarker);
        assert(input.includes(control ? controlMarker : currentMarker), 'current request missing');
        if (!control) { assert(input.includes(parentMarker), 'parent-only nonce absent from actual provider input'); assert(input.includes(parentName), 'quoted sender absent'); }
        for (const forbidden of [ancestorMarker, urlMarker, malformedMarker]) assert(!input.includes(forbidden), `excluded supplemental field reached provider: ${forbidden}`);
        text = `QUOTE_PROOF_${control ? 'CONTROL' : 'MAIN'}_${nonce}`;
        inference.push({kind: control ? 'control' : 'main', inputSha256: sha(input), inputBytes: Buffer.byteLength(input), answer: text});
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
      assert.notEqual(String(body.replyTo), '101', 'quote parent became outbound reply target');
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
    plugins: {enabled: true, allow: ['openai', 'nextcloud-talk'], entries: {openai: {enabled: true}, 'nextcloud-talk': {enabled: true}}},
    channels: {'nextcloud-talk': {enabled: true, baseUrl: origin, botSecretFile: path.join(root, 'bot-secret'), legacyWebhook: false,
      network: {dangerouslyAllowPrivateNetwork: true}, groupPolicy: 'open', groupAllowFrom: [currentSender], allowFrom: [currentSender, parentSender],
      rooms: {[room]: {requireMention: false}}, streaming: {block: {enabled: false}}}},
    logging: {level: 'debug', consoleLevel: 'debug', file: path.join(evidence, 'gateway-core.jsonl')},
  };
  applyMockOpenAiModelConfig(cfg, {mockPort: modelPort, modelRef: `openai/${model}`, utilityModelRef: `openai/${utilityModel}`});
  await fs.writeFile(configPath, JSON.stringify(cfg));
  await command(['plugins', 'enable', 'openai', 'nextcloud-talk', '--accept-capabilities'], 'admit-bundled-plugins');
  await command(['config', 'validate'], 'config-validate');
  const pluginIdentities = [];
  for (const id of ['openai', 'nextcloud-talk']) {
    const inspected = JSON.parse(await command(['plugins', 'inspect', id, '--runtime', '--json'], `inspect-${id}`));
    const plugin = inspected.plugin ?? inspected; assert.equal(plugin.status, 'loaded');
    assert.equal(await fs.realpath(plugin.rootDir), await fs.realpath(path.join(packageRoot, 'dist/extensions', id)), 'must use the shipped bundled plugin');
    pluginIdentities.push({id, rootDir: plugin.rootDir});
  }
  logStream = createWriteStream(path.join(evidence, 'gateway.log'));
  gateway = spawn(process.execPath, [entry, 'gateway', 'run', '--port', String(gatewayPort), '--bind', 'loopback'], {env, stdio: ['ignore', 'pipe', 'pipe']});
  gateway.stdout.pipe(logStream, {end: false}); gateway.stderr.pipe(logStream, {end: false}); gateway.once('error', error => errors.push(`Gateway: ${error}`));
  await eventually('installed Gateway ready', async () => { try { return (await fetch(`http://127.0.0.1:${gatewayPort}/readyz`, {signal: AbortSignal.timeout(2000)})).ok; } catch { return false; } });
  const parent = {type: 'Note', actor: {type: 'Person', id: parentSender, name: parentName}, object: {...note('101', parentMarker),
    inReplyTo: {type: 'Note', actor: {type: 'Person', id: 'users/ancestor', name: 'Ancestor'}, object: note('99', ancestorMarker)},
    url: `${origin}/${urlMarker}`}};
  const cases = [{id: '201', text: currentMarker, parent}, {id: '202', text: controlMarker, parent: {type: 'Note', actor: null, object: note('102', malformedMarker)}}];
  for (const [index, item] of cases.entries()) {
    const startedAt = Date.now();
    const payload = {type: 'Create', actor: {type: 'Person', id: currentSender, name: 'Current author'},
      object: {...note(item.id, item.text), inReplyTo: item.parent}, target: {type: 'Collection', id: room, name: 'Quoted proof room'}};
    const raw = JSON.stringify(payload), random = randomUUID(), signature = createHmac('sha256', secret).update(random).update(raw).digest('hex');
    await fs.writeFile(path.join(evidence, `webhook-${item.id}.json`), raw);
    const accepted = await fetch(`http://127.0.0.1:${gatewayPort}/nextcloud-talk-webhook`, {method: 'POST', body: raw,
      headers: {'content-type': 'application/json', 'x-nextcloud-talk-backend': origin + '/', 'x-nextcloud-talk-random': random, 'x-nextcloud-talk-signature': signature}, signal: AbortSignal.timeout(10_000)});
    assert.equal(accepted.status, 200); assert.equal(accepted.headers.get('x-openclaw-delivery-accepted'), 'durable'); await accepted.arrayBuffer();
    await eventually(`case ${item.id} bot send`, () => sends.length === index + 1);
    const completed = await eventually(`case ${item.id} settled`, async () => {
      const log = await fs.readFile(path.join(evidence, 'gateway.log'), 'utf8');
      return log.match(new RegExp(`message processed: channel=nextcloud-talk .*?messageId=${item.id}\\b.*? outcome=(\\w+)`));
    });
    assert.equal(completed[1], 'completed');
    const described = JSON.parse(await command(['gateway', 'call', 'sessions.describe', '--params', JSON.stringify({key: `agent:main:nextcloud-talk:group:${room}`}), '--json'], `session-${item.id}`));
    assert.equal(described.session.status, 'done'); assert.equal(described.session.hasActiveRun, false); assert(!described.session.lastRunError); assert(described.session.endedAt >= startedAt);
    terminal.push({messageId: item.id, outcome: completed[1], session: described.session});
  }
  assert.deepEqual(inference.map(item => item.kind), ['main', 'control']); assert.equal(sends.length, 2); assert.equal(errors.length, 0);
  await fs.writeFile(path.join(evidence, 'qualification.json'), JSON.stringify({status: 'PASS', scope: 'Installed candidate Gateway with signed synthetic Talk webhook, bundled OpenAI and checked Responses input; not a real Talk server/client/model proof.',
    sourceSha, expectedVersion, tarballSha, entrySha256: sha(await fs.readFile(entry)), fixtureSha256: sha(await fs.readFile(fixturePath)), pluginIdentities, inference, utility, sends, terminal, commands}, null, 2));
} catch (error) { failure = error; }
finally {
  await stopGateway(); if (logStream) await new Promise(resolve => logStream.end(resolve));
  await closeServer(talkServer); await closeServer(modelServer);
  await fs.writeFile(path.join(evidence, 'cleanup.json'), JSON.stringify({ownedGatewayStopped: !gateway || gateway.exitCode !== null || gateway.signalCode !== null, serversClosed: !talkServer?.listening && !modelServer?.listening,
    error: failure ? String(failure) : undefined, errors, inference, sends, terminal, commands}, null, 2));
  process.stdout.write(`Evidence: ${evidence}\n`);
}
if (failure) throw failure;
