// Fork-only existing-installation proof. Never import this in a production process.
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
assert.match(process.env.CANDIDATE_SHA ?? '', /^[0-9a-f]{40}$/u, 'unbound candidate');
assert.match(process.env.QUALIFIED_RUN_ID ?? '', /^[1-9]\d*$/u, 'unbound producer');
assert(['true', 'false'].includes(process.env.RUN_CONFIGURED_NATIVE_CONTROL ?? ''), 'explicit native control choice required');
const stableTagCommit = '383c124cc32ffee3f8e56f549b88da94d269a4af';
const stablePublishWorkflowCommit = '0f194ea7d8c0a037dcbe53f555e3e8a49d2b7510';
const stableTalkSpec = 'npm:@openclaw/nextcloud-talk@2026.10.4';
const stableTalkIntegrity = 'sha512-rJ9Z+YQJhAf+/6h+8SgbEAvTD0Su2j266cqdXYJA7DPULe6FreS7UXfgR1ArINHR3gujO1wpkIqfPt2ELnnlOw==';
const stableTarball = 'https://registry.npmjs.org/openclaw/-/openclaw-2026.10.4.tgz';
const stableIntegrity = '+FH0StZF1tlTazM7JJGY6JePeJmhFNSRByi2Q3jXPRiLO7o4dJh2xa9Vy4Dk8Cd2ic8B7Zkf5NfEaCCWUkgqnQ==';
const webUrl = `https://raw.githubusercontent.com/openclaw/openclaw/${stableTagCommit}/LICENSE`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = path.join(process.env.RUNNER_TEMP, 'nextcloud-outbound-live');
const evidence = path.join(root, 'evidence');
const prefix = path.join(root, 'prefix');
const state = path.join(root, 'state');
const workspace = path.join(root, 'workspace');
const configPath = path.join(state, 'openclaw.json');
const secretPath = path.join(root, 'bot-secret');
const entry = path.join(prefix, 'lib/node_modules/openclaw/openclaw.mjs');
const origin = 'http://127.0.0.1:18080';
const user = 'outbound-proof', recipient = 'outbound-recipient';
const password = 'nextcloud-disposable-proof-password';
const botSecret = 'nextcloud-disposable-upgrade-proof-bot-secret-20261016';
const mainModel = 'gpt-5.6-luna', utilityModel = 'gpt-5.6-luna-utility';
const env = {...process.env, HOME: root, OPENCLAW_HOME: root, OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_DISABLE_BONJOUR: '1', OPENAI_API_KEY: 'synthetic-no-real-provider-key', OPENCLAW_GATEWAY_TOKEN: 'disposable-upgrade-proof-gateway-token'};
delete env.CODEX_HOME;
delete env.GH_TOKEN;
delete env.GITHUB_TOKEN;
const steps = [], requests = [], callbacks = [], inference = [], utility = [], errors = [];
const phases = [], negatives = [];
let gateway, gatewayLog, mock, relay, proxy, roomToken, proxyOrigin, botId;
let configuredNativeStarted = false;
let activePhase, failure, result;
await fs.mkdir(evidence, {recursive: true});
await fs.mkdir(state, {recursive: true});
await fs.mkdir(workspace, {recursive: true});

async function command(executable, args, label, expected = 0) {
  const started = Date.now();
  const child = spawn(executable, args, {env, stdio: ['ignore', 'pipe', 'pipe']});
  const output = [], errors = [];
  child.stdout.on('data', chunk => output.push(chunk));
  child.stderr.on('data', chunk => errors.push(chunk));
  const timeout = setTimeout(() => child.kill('SIGKILL'), 600_000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', resolve);
  }).finally(() => clearTimeout(timeout));
  const stdout = Buffer.concat(output).toString(), stderr = Buffer.concat(errors).toString();
  await fs.writeFile(path.join(evidence, label + '.log'), stdout + '\nSTDERR:\n' + stderr);
  steps.push({label, code, wallMs: Date.now() - started});
  if (expected === 0) assert.equal(code, 0, `${label}: ${stderr.slice(-3000)}`);
  else if (code === 0) assert.equal(JSON.parse(stdout).ok, false, `${label}: unexpectedly succeeded`);
  return stdout;
}
const cli = (args, label, expected) => command(process.execPath, [entry, ...args], label, expected);
async function listen(server, host = '127.0.0.1') {
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, host, resolve);});
  return server.address().port;
}
async function closeServer(server) {
  if (!server?.listening) return;
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}
async function stopGateway() {
  if (gateway && gateway.exitCode === null && gateway.signalCode === null) {
    const ended = new Promise(resolve => gateway.once('exit', resolve));
    gateway.kill('SIGTERM');
    const timer = setTimeout(() => gateway.kill('SIGKILL'), 10_000);
    await ended.finally(() => clearTimeout(timer));
  }
  if (gatewayLog) await new Promise(resolve => gatewayLog.end(resolve));
  gateway = undefined; gatewayLog = undefined;
}
async function eventually(label, check) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {const value = await check(); if (value) return value; await delay(500);}
  throw new Error(`Timed out: ${label}`);
}
async function bytes(req, limit = 4 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {size += chunk.length; assert(size <= limit); chunks.push(chunk);}
  return Buffer.concat(chunks);
}
async function jsonFile(name, value) {await fs.writeFile(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n');}
async function ocs(actor, endpoint, body) {
  const response = await fetch(origin + '/ocs/v2.php' + endpoint, {
    method: body ? 'POST' : 'GET',
    headers: {Authorization: `Basic ${Buffer.from(`${actor}:${password}`).toString('base64')}`, 'OCS-APIRequest': 'true', Accept: 'application/json'},
    ...(body ? {body: new URLSearchParams(body)} : {}), signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, `fixture OCS ${endpoint}: ${response.status}`);
  const data = await response.json(); assert.equal(data.ocs.meta.status, 'ok'); return data.ocs.data;
}
const history = () => ocs(recipient, `/apps/spreed/api/v1/chat/${roomToken}?lookIntoFuture=0&limit=100&setReadMarker=0&noStatusUpdate=1&markNotificationsAsRead=0`);
async function noNativeEffects() {
  const shares = await ocs(user, '/apps/files_sharing/api/v1/shares');
  assert.equal(shares.filter(share => share.share_with === roomToken).length, 0, 'bot-only send created a share');
  assert(!(await history()).some(message => message.messageParameters?.file), 'bot-only send created a native file message');
  assert(requests.every(request => !request.hasAuthorization && !['PUT', 'MKCOL', 'PROPFIND', 'DELETE'].includes(request.method) && !/\/files_sharing\/|\/remote\.php\/dav\/|\/cloud\/user/u.test(request.pathname)), 'bot-only plugin attempted native API/file access');
}
async function inspectPlugins(label) {
  const inspectedPlugins = {};
  for (const id of ['nextcloud-talk', 'openai']) {
    const inspected = JSON.parse(await cli(['plugins', 'inspect', id, '--runtime', '--json'], `${label}-inspect-${id}`));
    const plugin = inspected.plugin ?? inspected;
    assert.equal(plugin.status, 'loaded');
    if (label === 'stable' && id === 'nextcloud-talk') {
      assert.equal(inspected.install?.source, 'npm', 'official stable Talk must use its actual managed npm installation');
      assert.equal(inspected.install?.integrity, stableTalkIntegrity);
      assert.equal(plugin.packageVersion, '2026.10.4');
      assert(path.resolve(plugin.rootDir).startsWith(state + path.sep), 'stable managed plugin escaped isolated state');
      assert.equal(JSON.parse(await fs.readFile(path.join(plugin.rootDir, 'package.json'))).name, '@openclaw/nextcloud-talk');
    } else {
      assert.equal(await fs.realpath(plugin.rootDir), await fs.realpath(path.join(path.dirname(entry), 'dist/extensions', id)), 'ambient/external plugin selected');
    }
    inspectedPlugins[id] = {rootDir: plugin.rootDir, origin: plugin.origin, version: plugin.packageVersion, install: inspected.install};
  }
  return inspectedPlugins;
}
function streamEvents(text, id) {
  const responseId = `resp_upgrade_${id}`, itemId = `msg_upgrade_${id}`;
  const part = {type: 'output_text', text, annotations: []};
  const item = {type: 'message', id: itemId, role: 'assistant', status: 'completed', phase: 'final_answer', content: [part]};
  const position = {item_id: itemId, output_index: 0, content_index: 0};
  return [
    {type: 'response.created', response: {id: responseId, object: 'response', status: 'in_progress', output: []}},
    {type: 'response.output_item.added', output_index: 0, item: {...item, content: [], status: 'in_progress'}},
    {type: 'response.content_part.added', ...position, part: {...part, text: ''}},
    {type: 'response.output_text.delta', ...position, delta: text},
    {type: 'response.output_text.done', ...position, text},
    {type: 'response.content_part.done', ...position, part},
    {type: 'response.output_item.done', output_index: 0, item},
    {type: 'response.completed', response: {id: responseId, object: 'response', status: 'completed', output: [item], usage: {input_tokens: 64, output_tokens: 32, total_tokens: 96}}},
  ];
}
async function snapshot(label) {
  const files = [configPath, secretPath, path.join(workspace, 'upgrade-sentinel.md'), path.join(workspace, 'private-local.txt')];
  const hashes = Object.fromEntries(await Promise.all(files.map(async file => [path.relative(root, file), sha(await fs.readFile(file))])));
  const authoredConfig = JSON.parse(await fs.readFile(configPath));
  // Canonical plugin installation may refresh only these config-writer stamps;
  // source-owner records themselves live in the owner's durable state.
  if (authoredConfig.meta) {
    delete authoredConfig.meta.lastTouchedAt; delete authoredConfig.meta.lastTouchedVersion;
    if (Object.keys(authoredConfig.meta).length === 0) delete authoredConfig.meta;
  }
  const snapshot = {hashes, authoredConfig}; await jsonFile(label + '.json', snapshot); return snapshot;
}
function assertAuthoredPreserved(before, after) {
  assert.deepEqual(after.authoredConfig, before.authoredConfig, 'plugin source selection changed authored settings');
  for (const [name, hash] of Object.entries(before.hashes)) if (name !== path.relative(root, configPath)) assert.equal(after.hashes[name], hash, `authored file changed: ${name}`);
}
async function describe(label) {
  const described = JSON.parse(await cli(['gateway', 'call', 'sessions.describe', '--params', JSON.stringify({key: `agent:main:nextcloud-talk:group:${roomToken}`}), '--json'], label));
  return described.session;
}
async function startGateway(label, gatewayPort) {
  gatewayLog = createWriteStream(path.join(evidence, `${label}-gateway.log`));
  gateway = spawn(process.execPath, [entry, 'gateway', 'run', '--port', String(gatewayPort), '--bind', 'loopback'], {env, stdio: ['ignore', 'pipe', 'pipe']});
  gateway.stdout.pipe(gatewayLog, {end: false}); gateway.stderr.pipe(gatewayLog, {end: false});
  gateway.once('error', error => errors.push(`gateway: ${String(error)}`));
  await eventually(label + ' Gateway readiness', async () => {
    assert.equal(gateway.exitCode, null); assert.equal(errors.length, 0, errors.join('\n'));
    try {return (await fetch(`http://127.0.0.1:${gatewayPort}/readyz`, {signal: AbortSignal.timeout(2000)})).ok;} catch {return false;}
  });
}
async function proveUrlPhase(label, gatewayPort) {
  await startGateway(label, gatewayPort);
  if (label === 'stable') await ocs(user, `/apps/spreed/api/v1/bot/${roomToken}/${botId}`, {});
  const joinedBot = await eventually('signed registered room bot identity', () => callbacks.find(callback => callback.type === 'Join' && callback.objectId === roomToken && callback.signed && callback.gatewayStatus === 200 && callback.actor?.startsWith('bots/')));
  const botActorId = joinedBot.actor.slice('bots/'.length);
  const priorIds = new Set((await history()).map(message => String(message.id)));
  const caption = `Upgrade ${label} CLI ${randomUUID()}`;
  const sent = JSON.parse(await cli(['message', 'send', '--channel', 'nextcloud-talk', '--target', roomToken, '--message', caption, '--media', webUrl, '--json'], `${label}-cli-url`));
  // Talk's legacy bot endpoint acknowledges with 201/null, not a chat ID.
  // Preserve that honest receipt and independently correlate authoritative
  // history using a fresh nonce, exact text/room and signed registered actor.
  const manual = await eventually(label + ' exact bot URL room message', async () => {
    const matches = (await history()).filter(message => !priorIds.has(String(message.id)) && message.token === roomToken && message.actorType === 'bots' && message.actorId === botActorId && message.message === `${caption}\n\nAttachment: ${webUrl}`);
    assert(matches.length <= 1, 'ambiguous bot URL history correlation');
    return matches[0];
  });
  const cliReceiptMessageId = String(sent.messageId ?? 'unknown');
  assert(cliReceiptMessageId === 'unknown' || /^[1-9]\d*$/u.test(cliReceiptMessageId), 'unexpected bot receipt shape');
  if (cliReceiptMessageId !== 'unknown') assert.equal(cliReceiptMessageId, String(manual.id), 'concrete bot receipt differs from observed chat ID');
  activePhase = {label, marker: `Upgrade ${label} trigger ${randomUUID()}`, caption: `Upgrade ${label} automatic ${randomUUID()}`};
  const modelBefore = inference.length;
  const before = label === 'candidate' ? await describe('candidate-existing-session') : undefined;
  const startedAt = Date.now();
  const posted = await ocs(recipient, `/apps/spreed/api/v1/chat/${roomToken}`, {message: activePhase.marker});
  const automatic = await eventually(label + ' bot URL automatic reply', async () => (await history()).find(message => message.actorType === 'bots' && message.actorId === botActorId && message.message.includes(activePhase.caption) && message.message.includes(`Attachment: ${webUrl}`)));
  const terminal = await eventually(label + ' exact terminal outcome', async () => {
    const log = await fs.readFile(path.join(evidence, `${label}-gateway.log`), 'utf8');
    const match = log.match(new RegExp(`message processed: channel=nextcloud-talk .*?messageId=${String(posted.id)}\\b.*? outcome=(\\w+)`));
    return match ? {chatId: String(posted.id), outcome: match[1], diagnostic: match[0]} : undefined;
  });
  assert.equal(terminal.outcome, 'completed');
  const session = await describe(label + '-completed-session');
  assert.equal(session.status, 'done'); assert.equal(session.hasActiveRun, false); assert(!session.lastRunError); assert(session.endedAt >= startedAt);
  assert.equal(inference.length, modelBefore + 1, 'unexpected additional main inference');
  assert(callbacks.some(callback => callback.objectId === String(posted.id) && callback.gatewayStatus === 200 && callback.accepted === 'durable'));
  assert(!automatic.message.includes('MEDIA:'));
  await noNativeEffects();
  const phase = {label, cliReceiptMessageId, cliReceipt: sent.receipt, observedCliChatId: String(manual.id), observedVia: 'exact nonce/text/room and signed registered bot identity in Talk history', botActorId, automaticMessageId: String(automatic.id), triggeringMessageId: String(posted.id), terminal, session, existingSessionBeforeTurn: before, inferenceCount: inference.length};
  phases.push(phase); await jsonFile(label + '-phase.json', phase);
  await stopGateway(); return phase;
}

try {
  const admission = JSON.parse(await fs.readFile(path.join(evidence, 'package-admission.json')));
  assert.equal(admission.status, 'PASS'); assert.equal(admission.candidate, process.env.CANDIDATE_SHA);
  assert.equal(sha(await fs.readFile(process.env.CANDIDATE_TARBALL)), admission.packageSha256);
  const download = await fetch(stableTarball, {redirect: 'error', signal: AbortSignal.timeout(300_000)});
  assert(download.ok); const stableFile = path.join(root, 'openclaw-2026.10.4.tgz');
  const chunks = []; let length = 0;
  for await (const chunk of download.body) {length += chunk.length; assert(length <= 200 * 1024 * 1024); chunks.push(chunk);}
  const stableBytes = Buffer.concat(chunks);
  assert.equal(createHash('sha512').update(stableBytes).digest('base64'), stableIntegrity);
  await fs.writeFile(stableFile, stableBytes);
  await command('npm', ['install', '--global', '--prefix', prefix, stableFile, '--no-audit', '--no-fund'], 'install-official-2026.10.4');
  const build = JSON.parse(await fs.readFile(path.join(path.dirname(entry), 'dist/build-info.json')));
  assert.equal(JSON.parse(await fs.readFile(path.join(path.dirname(entry), 'package.json'))).version, '2026.10.4');
  assert.equal(build.commit, stableTagCommit, 'actual released package must bind the observed stable product source');
  await jsonFile('stable-package.json', {version: '2026.10.4', tarball: stableTarball, sha512: stableIntegrity, productSourceCommit: stableTagCommit, publishingWorkflowDependency: stablePublishWorkflowCommit, installedBuild: build});
  await fs.writeFile(configPath, JSON.stringify({gateway: {mode: 'local'}}));
  await cli(['plugins', 'install', stableTalkSpec, '--force', '--pin'], 'stable-install-official-managed-talk');
  const publicFile = await fetch(webUrl, {redirect: 'error', signal: AbortSignal.timeout(30_000)});
  assert(publicFile.ok); const publicBytes = Buffer.from(await publicFile.arrayBuffer()); assert(publicBytes.length > 100);
  await jsonFile('public-url.json', {url: webUrl, bytes: publicBytes.length, sha256: sha(publicBytes), redirect: false});
  await fs.writeFile(secretPath, botSecret, {mode: 0o600});
  await fs.writeFile(path.join(workspace, 'upgrade-sentinel.md'), 'Authored before upgrading official 2026.10.4. Preserve this file.\n');
  await fs.writeFile(path.join(workspace, 'private-local.txt'), 'Synthetic local data must never be posted as a path or URL.\n');
  const room = await ocs(user, '/apps/spreed/api/v4/room', {roomType: '2', roomName: 'Existing bot-only upgrade proof'});
  roomToken = room.token;
  await ocs(user, `/apps/spreed/api/v4/room/${roomToken}/participants`, {newParticipant: recipient});
  proxy = http.createServer(async (req, res) => {
    try {
      const body = await bytes(req); const parsed = new URL(req.url, origin);
      requests.push({method: req.method, pathname: parsed.pathname, hasAuthorization: Boolean(req.headers.authorization), configuredNative: configuredNativeStarted});
      assert.equal(parsed.origin, origin);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (!['host', 'connection', 'content-length'].includes(key) && typeof value === 'string') headers.set(key, value);
      const forwarded = await fetch(origin + parsed.pathname + parsed.search, {method: req.method, headers, ...(body.length ? {body} : {}), redirect: 'manual', signal: AbortSignal.timeout(120_000)});
      res.writeHead(forwarded.status, Object.fromEntries([...forwarded.headers].filter(([key]) => !['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key))));
      res.end(Buffer.from(await forwarded.arrayBuffer()));
    } catch (error) {errors.push(`proxy: ${String(error)}`); res.writeHead(502); res.end('synthetic proxy failed');}
  });
  proxyOrigin = `http://127.0.0.1:${await listen(proxy)}`;
  const reservation = net.createServer(); const gatewayPort = await listen(reservation); await closeServer(reservation);
  mock = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/v1/models') {res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({object: 'list', data: [mainModel, utilityModel].map(id => ({id, object: 'model', owned_by: 'synthetic-proof'}))})); return;}
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/responses');
      const body = JSON.parse((await bytes(req)).toString()), input = JSON.stringify(body.input);
      let text, id;
      if (body.model === utilityModel) {utility.push({model: body.model, inputSha256: sha(input)}); text = 'Synthetic upgrade fixture utility response.'; id = `utility_${utility.length}`;}
      else {
        assert.equal(body.model, mainModel); assert(activePhase && input.includes(activePhase.marker));
        inference.push({phase: activePhase.label, model: body.model, inputSha256: sha(input), inputBytes: Buffer.byteLength(input)});
        text = `${activePhase.caption}\n\nMEDIA:${webUrl}`; id = `main_${inference.length}`;
      }
      const events = streamEvents(text, id);
      if (body.stream === false) {res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(events.at(-1).response));}
      else {res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store'}); for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`); res.end('data: [DONE]\n\n');}
    } catch (error) {errors.push(`model: ${String(error)}`); res.writeHead(500); res.end('synthetic model failed');}
  });
  const modelPort = await listen(mock);
  relay = http.createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/nextcloud-talk-webhook');
      const body = await bytes(req), random = req.headers['x-nextcloud-talk-random'], supplied = req.headers['x-nextcloud-talk-signature'];
      assert.equal(typeof random, 'string'); assert.equal(typeof supplied, 'string');
      const expected = createHmac('sha256', botSecret).update(random).update(body).digest('hex');
      assert.equal(supplied.length, expected.length); assert(timingSafeEqual(Buffer.from(supplied.toLowerCase()), Buffer.from(expected)));
      assert.equal(req.headers['x-nextcloud-talk-backend'], proxyOrigin + '/');
      const parsed = JSON.parse(body.toString());
      const callback = {objectId: String(parsed.object?.id), actor: parsed.actor?.id, type: parsed.type, signed: true, rawSha256: sha(body)}; callbacks.push(callback);
      // The optional final control is a CLI-only send after both Gateway phases
      // settled. Its webhook is recorded, not represented as an inference proof.
      if (configuredNativeStarted && !gateway) {callback.forwarded = false; res.writeHead(204); res.end(); return;}
      const forwarded = await fetch(`http://127.0.0.1:${gatewayPort}${req.url}`, {method: 'POST', body, headers: {'content-type': 'application/json', 'x-nextcloud-talk-random': random, 'x-nextcloud-talk-signature': supplied, 'x-nextcloud-talk-backend': req.headers['x-nextcloud-talk-backend']}, signal: AbortSignal.timeout(4500)});
      callback.gatewayStatus = forwarded.status; callback.accepted = forwarded.headers.get('x-openclaw-delivery-accepted');
      res.writeHead(forwarded.status, {'content-type': forwarded.headers.get('content-type') ?? 'text/plain'}); res.end(Buffer.from(await forwarded.arrayBuffer()));
    } catch (error) {errors.push(`relay: ${String(error)}`); res.writeHead(502); res.end('synthetic relay failed');}
  });
  const callbackUrl = `http://host.docker.internal:${await listen(relay, '0.0.0.0')}/nextcloud-talk-webhook`;
  const cfg = {gateway: {mode: 'local', bind: 'loopback', port: gatewayPort, auth: {mode: 'token', token: env.OPENCLAW_GATEWAY_TOKEN}, controlUi: {enabled: false}}, agents: {entries: {main: {memory: {search: {enabled: false}}}}, defaults: {workspace, systemAgent: {agentId: 'main'}, heartbeat: {every: '0m'}}}, memory: {search: {enabled: false}}, session: {dmScope: 'per-channel-peer'}, plugins: {allow: ['nextcloud-talk', 'openai'], entries: {'nextcloud-talk': {enabled: true}, openai: {enabled: true}}}, channels: {'nextcloud-talk': {enabled: true, baseUrl: proxyOrigin, botSecretFile: secretPath, webhookPublicUrl: callbackUrl, legacyWebhook: false, network: {dangerouslyAllowPrivateNetwork: true}, dmPolicy: 'allowlist', allowFrom: [`users/${recipient}`], groupAllowFrom: [`users/${recipient}`], groupPolicy: 'allowlist', rooms: {[roomToken]: {requireMention: false}}}}};
  cfg.logging = {level: 'debug', consoleLevel: 'debug', file: path.join(evidence, 'upgrade-core.jsonl')};
  const fixturePath = path.resolve(process.env.STABLE_MODEL_FIXTURE);
  const fixtureBytes = await fs.readFile(fixturePath);
  assert.equal(createHash('sha1').update(`blob ${fixtureBytes.length}\0`).update(fixtureBytes).digest('hex'), 'cd33a2e801c9f7ee6a559ab36f7daa1b0d8db0a5', 'canonical stable model helper changed');
  const {applyMockOpenAiModelConfig} = await import(pathToFileURL(fixturePath));
  applyMockOpenAiModelConfig(cfg, {mockPort: modelPort, modelRef: `openai/${mainModel}`, utilityModelRef: `openai/${utilityModel}`});
  await fs.writeFile(configPath, JSON.stringify(cfg));
  await cli(['config', 'validate'], 'stable-config-validate'); const stablePlugins = await inspectPlugins('stable');
  const occ = (args, label) => command('docker', ['exec', '--user', 'www-data', 'nextcloud-outbound-proof', 'php', 'occ', ...args], label);
  await occ(['config:system:set', 'overwrite.cli.url', '--value=' + proxyOrigin], 'upgrade-backend-origin');
  await occ(['config:system:set', 'allow_local_remote_servers', '--type=boolean', '--value=true'], 'upgrade-callback-policy');
  const installed = await occ(['talk:bot:install', 'Existing bot-only upgrade proof', botSecret, callbackUrl, '--feature', 'webhook', '--feature', 'response'], 'upgrade-bot-install');
  botId = installed.match(/^ID:\s*(\d+)\s*$/m)?.[1]; assert(botId);
  const stable = await proveUrlPhase('stable', gatewayPort);
  const before = await snapshot('before-upgrade');
  await command('npm', ['install', '--global', '--prefix', prefix, process.env.CANDIDATE_TARBALL, '--no-audit', '--no-fund'], 'upgrade-same-prefix');
  const afterInstall = await snapshot('after-package-install'); assert.deepEqual(afterInstall, before, 'install altered authored settings, secret or workspace');
  const candidateBuild = JSON.parse(await fs.readFile(path.join(path.dirname(entry), 'dist/build-info.json')));
  assert.equal(candidateBuild.commit, admission.packageCandidate);
  const beforeSelection = JSON.parse(await cli(['plugins', 'inspect', 'nextcloud-talk', '--json'], 'candidate-before-plugin-source-selection'));
  // Core replacement alone does not promise to replace an explicitly managed
  // plugin. Use the public install owner to select the new paired bundle.
  await cli(['plugins', 'install', 'nextcloud-talk', '--force'], 'candidate-select-paired-talk');
  const afterSelection = await snapshot('after-supported-plugin-source-selection'); assertAuthoredPreserved(before, afterSelection);
  await cli(['config', 'validate'], 'candidate-existing-config-validate'); const candidatePlugins = await inspectPlugins('candidate');
  assert.deepEqual(candidatePlugins.openai.install, stablePlugins.openai.install, 'selection changed a non-target plugin install owner');
  assert.equal(candidatePlugins['nextcloud-talk'].install?.source, 'path');
  assert.equal(candidatePlugins['nextcloud-talk'].install?.spec, 'nextcloud-talk');
  assert.equal(await fs.realpath(candidatePlugins['nextcloud-talk'].install.installPath), await fs.realpath(path.join(path.dirname(entry), 'dist/extensions/nextcloud-talk')));
  const candidate = await proveUrlPhase('candidate', gatewayPort);
  assert.equal(candidate.existingSessionBeforeTurn?.sessionId, stable.session.sessionId, 'existing stable-created session was not loaded');
  assert.equal(candidate.session.sessionId, stable.session.sessionId, 'upgrade replaced existing conversation/session');
  for (const media of [path.join(workspace, 'private-local.txt'), 'file://' + path.join(workspace, 'private-local.txt'), '../private-local.txt', 'data:application/pdf;base64,cHJpdmF0ZQ==', 'https://synthetic-user:synthetic-secret@example.com/private']) {
    const prior = new Set((await history()).map(message => String(message.id)));
    const label = `candidate-rejected-reference-${negatives.length + 1}`;
    await cli(['message', 'send', '--channel', 'nextcloud-talk', '--target', roomToken, '--media', media, '--json'], label, 'failure');
    assert(!(await history()).some(message => !prior.has(String(message.id))), 'rejected reference created a visible message');
    negatives.push({label, noVisibleSend: true});
  }
  await noNativeEffects();
  const preservedHistory = await history();
  assert(preservedHistory.some(message => String(message.id) === stable.observedCliChatId));
  assert(preservedHistory.some(message => String(message.id) === stable.automaticMessageId));
  assert(!preservedHistory.some(message => message.message === 'No answer was returned. Ask again if you still need one.'));
  for (const message of preservedHistory.filter(message => message.actorType === 'bots')) {
    assert(![workspace, secretPath, proxyOrigin, 'file://', 'synthetic-user', 'synthetic-secret', 'private-local.txt'].some(value => message.message.includes(value)), 'private reference leaked into bot conversation');
  }
  const afterProof = await snapshot('after-bot-only-proof'); assertAuthoredPreserved(before, afterProof);
  let nativeControl = {status: 'NOT_REQUESTED'};
  if (process.env.RUN_CONFIGURED_NATIVE_CONTROL === 'true') {
    configuredNativeStarted = true;
    const enabled = JSON.parse(await fs.readFile(configPath));
    const apiPasswordFile = path.join(root, 'synthetic-app-password'); await fs.writeFile(apiPasswordFile, password, {mode: 0o600});
    enabled.channels['nextcloud-talk'].apiUser = user; enabled.channels['nextcloud-talk'].apiPasswordFile = apiPasswordFile;
    await fs.writeFile(configPath, JSON.stringify(enabled));
    await cli(['config', 'validate'], 'configured-existing-install-validate');
    const nativeBytes = Buffer.from('%PDF-1.4\nExisting installation native control\n%%EOF\n');
    const mediaPath = path.join(workspace, 'native-control.pdf'); await fs.writeFile(mediaPath, nativeBytes);
    const caption = `Configured upgrade native ${randomUUID()}`;
    const sent = JSON.parse(await cli(['message', 'send', '--channel', 'nextcloud-talk', '--target', roomToken, '--message', caption, '--media', mediaPath, '--reply-to', candidate.automaticMessageId, '--json'], 'configured-existing-native-control'));
    const message = (await history()).find(message => String(message.id) === String(sent.messageId));
    assert(message?.messageParameters?.file && message.actorType === 'users' && message.actorId === user && message.message.includes(caption));
    assert.equal(String(message.parent?.id), candidate.automaticMessageId);
    const shares = await ocs(user, '/apps/files_sharing/api/v1/shares');
    assert(shares.some(share => Number(share.share_type) === 10 && share.share_with === roomToken && Number(share.permissions) === 1));
    const filePath = message.messageParameters.file.path.split('/').map(encodeURIComponent).join('/');
    const received = await fetch(`${origin}/remote.php/dav/files/${recipient}/${filePath}`, {headers: {Authorization: `Basic ${Buffer.from(`${recipient}:${password}`).toString('base64')}`}, redirect: 'error'});
    assert(received.ok); assert.equal(sha(Buffer.from(await received.arrayBuffer())), sha(nativeBytes));
    nativeControl = {status: 'PASS', deliberateConfigChangeAfterPreservationProof: true, messageId: String(message.id), recipientByteEquality: true, replyToId: candidate.automaticMessageId, readOnlyRoomShare: true};
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  result = {status: 'PASS', scope: 'Actual published official 2026.10.4 plus official managed Talk, upgraded in the same disposable prefix/state/room to the qualified candidate and explicitly selected paired Talk through its public installer; synthetic provider, no production/UI proof.', stableTagCommit, stablePublishWorkflowCommit, candidate: process.env.CANDIDATE_SHA, packageCandidate: admission.packageCandidate, productionBytesUnchanged: admission.productionBytesUnchanged, retainedProducerRun: admission.retainedProducerRun, producerRun: Number(process.env.QUALIFIED_RUN_ID), packageSha256: admission.packageSha256, publicUrl: webUrl, samePrefix: true, sameStateDirectory: true, stableCreatedSessionPreserved: true, existingBotReceiptsPreserved: true, coreInstallPreservedConfigBytes: true, authoredConfigSecretWorkspaceHashesPreserved: true, pluginSourceTransition: {stable: stablePlugins['nextcloud-talk'], candidateBeforeSelection: {rootDir: beforeSelection.plugin?.rootDir, install: beforeSelection.install}, supportedCommand: 'plugins install nextcloud-talk --force', candidate: candidatePlugins['nextcloud-talk']}, noNativeIOInBotOnlyPhases: true, rejectedReferences: negatives, phases, configuredNativeControl: nativeControl};
} catch (error) {failure = error;}
finally {
  await stopGateway(); await closeServer(relay); await closeServer(mock); await closeServer(proxy);
  await jsonFile('upgrade-transport.json', {requests, callbacks, inference, utility, errors});
  if (roomToken) {try {await jsonFile('upgrade-chat-history.json', await history());} catch (error) {if (!failure) failure = error;}}
  await jsonFile('upgrade-qualification.json', failure ? {status: 'FAIL', error: String(failure), steps, phases, negatives, ownedProcessesClosed: true} : {...result, steps, ownedProcessesClosed: true});
}
if (failure) throw failure;
