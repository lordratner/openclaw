// Task-owned, isolated installed Gateway + existing native Codex account proof.
// No canary, real Talk server, credential import/login, Responses mock, or relay.
// This script is authored for owner review; authoring does not execute the proof.
import assert from 'node:assert/strict';
import {createHash, createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import fs from 'node:fs/promises';
import {createReadStream, createWriteStream} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const required = name => assert(process.env[name], `${name} is required`) || process.env[name];
const sha = value => createHash('sha256').update(value).digest('hex');
async function fileSha(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
assert.equal(process.platform, 'linux', 'owned process-group cleanup is Linux-specific');
assert.equal(required('OPENCLAW_QA_NATIVE_PROOF'), 'existing-native-account-no-injection');
const prefix = await fs.realpath(required('OPENCLAW_QA_INSTALLED_PREFIX'));
const entry = await fs.realpath(process.argv[2] ?? path.join(prefix, 'node_modules/openclaw/openclaw.mjs'));
assert.equal(entry, await fs.realpath(path.join(prefix, 'node_modules/openclaw/openclaw.mjs')));
assert(inside(prefix, entry), 'entry must belong to the supplied complete installed prefix');
const archive = await fs.realpath(required('OPENCLAW_QA_PREFIX_ARCHIVE'));
const archiveSha = required('OPENCLAW_QA_PREFIX_SHA256');
const sourceSha = required('OPENCLAW_QA_SOURCE_SHA');
const expectedVersion = required('OPENCLAW_QA_EXPECTED_VERSION');
assert.match(archiveSha, /^[a-f0-9]{64}$/);
assert.match(sourceSha, /^[a-f0-9]{40}$/);
assert.equal(await fileSha(archive), archiveSha, 'complete installed-prefix artifact identity');
const packageRoot = path.dirname(entry);
const pkg = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json')));
const build = JSON.parse(await fs.readFile(path.join(packageRoot, 'dist/build-info.json')));
assert.equal(pkg.name, 'openclaw'); assert.equal(pkg.version, expectedVersion); assert.equal(build.commit, sourceSha);
const codexCommand = await fs.realpath(required('OPENCLAW_QA_CODEX_COMMAND'));
const codexCommandSha = required('OPENCLAW_QA_CODEX_COMMAND_SHA256');
assert.match(codexCommandSha, /^[a-f0-9]{64}$/);
assert.equal(await fileSha(codexCommand), codexCommandSha, 'existing verified Codex command');
const nativeHome = await fs.realpath(required('OPENCLAW_QA_NATIVE_CODEX_HOME'));
assert((await fs.stat(nativeHome)).isDirectory(), 'existing native home must be a directory');
// Never inspect, copy, import, migrate, replace, or hash native auth.json.
const proofRoot = await fs.realpath(required('OPENCLAW_QA_PROOF_ROOT'));
assert(!inside(nativeHome, proofRoot) && proofRoot !== nativeHome);
assert(!inside(prefix, proofRoot) && proofRoot !== prefix, 'proof must not mutate the installed prefix');
const root = await fs.mkdtemp(path.join(proofRoot, 'quoted-native-'));
await fs.chmod(root, 0o700);
const evidence = path.join(root, 'evidence'), privateLogs = path.join(root, 'private');
const state = path.join(root, 'state'), workspace = path.join(root, 'workspace');
await Promise.all([evidence, privateLogs, state, workspace].map(dir => fs.mkdir(dir, {mode: 0o700})));
const configPath = path.join(state, 'openclaw.json');
// Inherit only ordinary process environment; never synthesize model credentials.
// The selected native home owns its existing account and ordinary refresh/session writes.
const env = {...process.env, OPENCLAW_HOME: root, OPENCLAW_STATE_DIR: state,
  OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_DISABLE_BONJOUR: '1', CODEX_HOME: nativeHome,
  OPENCLAW_GATEWAY_TOKEN: `synthetic-proof-${randomUUID()}`};
for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENCLAW_AGENT_DIR', 'OPENCLAW_GATEWAY_URL',
  'OPENCLAW_GATEWAY_PASSWORD', 'OPENCLAW_GATEWAY_SERVICE_PID', 'CODEX_THREAD_ID',
  'OPENCLAW_CODEX_APP_SERVER_BIN', 'OPENCLAW_CODEX_APP_SERVER_ARGS']) delete env[key];
const secret = `synthetic-talk-${randomUUID()}`;
const room = `quoted-native-${randomUUID()}`, currentSender = 'users/alice', parentSender = 'users/bob';
const parentName = 'Bob Meridian', parentCode = `POLARIS_${randomUUID()}`;
const hiddenCode = `HIDDEN_${randomUUID()}`, ancestorMarker = `ANCESTOR_${randomUUID()}`;
const unusedMarker = `UNREFERENCED_${randomUUID()}`;
const modelRef = 'openai/gpt-6-luna', model = 'gpt-6-luna';
const sends = [], terminal = [], errors = [], commands = [], pluginIdentities = [];
let gateway, logStream, talkServer, activeCase, failure, qualification;

function groupAlive(pid) {
  if (!pid) return false;
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
function signalGroup(pid, signal) {
  if (!pid) return;
  try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
async function stopGroup(child) {
  if (!child?.pid || !groupAlive(child.pid)) return;
  signalGroup(child.pid, 'SIGTERM');
  const deadline = Date.now() + 10_000;
  while (groupAlive(child.pid) && Date.now() < deadline) await delay(100);
  if (groupAlive(child.pid)) signalGroup(child.pid, 'SIGKILL');
  const killDeadline = Date.now() + 3_000;
  while (groupAlive(child.pid) && Date.now() < killDeadline) await delay(100);
  assert(!groupAlive(child.pid), 'owned process group did not stop');
}
async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}
async function closeServer(server) {
  if (!server?.listening) return;
  server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve));
}
async function readBody(req) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; assert(bytes <= 1024 * 1024); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function eventually(label, inspect, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    assert.equal(errors.length, 0, errors.join('\n'));
    if (gateway) assert.equal(gateway.exitCode, null, 'owned candidate Gateway exited');
    const result = await inspect(); if (result) return result;
    await delay(300);
  }
  throw new Error(`Timeout: ${label}`);
}
async function command(args, label, executable = process.execPath, suppliedEnv = env) {
  const argv = executable === process.execPath ? [entry, ...args] : args;
  const child = spawn(executable, argv, {env: suppliedEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
  const out = [], err = []; let bytes = 0, oversized = false;
  const collect = target => value => {
    bytes += value.length;
    if (bytes > 8 * 1024 * 1024) { oversized = true; signalGroup(child.pid, 'SIGTERM'); }
    else target.push(value);
  };
  child.stdout.on('data', collect(out)); child.stderr.on('data', collect(err));
  const timer = setTimeout(() => signalGroup(child.pid, 'SIGKILL'), 120_000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); }
  finally { clearTimeout(timer); await stopGroup(child); }
  const stdout = Buffer.concat(out).toString(), stderr = Buffer.concat(err).toString();
  // Raw diagnostics may include native account metadata. They stay private and are NOT proof artifacts.
  await fs.writeFile(path.join(privateLogs, `${label}.log`), `${stdout}\n${stderr}`, {mode: 0o600});
  commands.push({label, args, code, stdoutSha256: sha(stdout), stderrSha256: sha(stderr)});
  assert(!oversized, `${label}: output limit exceeded`); assert.equal(code, 0, `${label} failed; inspect private diagnostics`);
  return stdout;
}
const note = (id, text) => ({type: 'Note', id, name: 'message', content: JSON.stringify({message: text, parameters: []}), mediaType: 'text/markdown'});
const sessionKey = `agent:main:nextcloud-talk:group:${room}`;
function publicSession(session) {
  const keys = ['sessionId', 'lastRunId', 'modelProvider', 'model', 'status', 'hasActiveRun', 'startedAt', 'endedAt'];
  return {...Object.fromEntries(keys.map(key => [key, session[key]])), agentRuntime: {id: session.agentRuntime?.id}};
}

try {
  const cliVersion = (await command(['--version'], 'existing-codex-version', codexCommand)).trim();
  assert.match(cliVersion, /\b0\.160\.0\b/, 'use the owner-verified existing Codex CLI, not an auto-installed replacement');
  talkServer = http.createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST', 'no quote/history/media fetching');
      assert.equal(req.url, `/ocs/v2.php/apps/spreed/api/v1/bot/${room}/message`);
      assert(activeCase, 'outbound send outside a dispatched proof case');
      const body = JSON.parse((await readBody(req)).toString());
      assert.equal(typeof body.message, 'string');
      const random = req.headers['x-nextcloud-talk-bot-random'], signature = req.headers['x-nextcloud-talk-bot-signature'];
      assert.equal(typeof random, 'string'); assert.equal(typeof signature, 'string');
      const expected = createHmac('sha256', secret).update(random).update(body.message).digest('hex');
      assert.equal(signature.length, expected.length);
      assert(timingSafeEqual(Buffer.from(signature), Buffer.from(expected)), 'bot POST HMAC');
      assert.equal(String(body.replyTo), activeCase.id, 'automatic final must target the current message');
      assert(!sends.some(item => item.case === activeCase.kind), 'duplicate send for one inbound turn');
      for (const forbidden of [hiddenCode, ancestorMarker, unusedMarker]) assert(!body.message.includes(forbidden), 'excluded quote data appeared in output');
      if (activeCase.kind === 'allowed-access-group-parent') {
        assert(body.message.includes(parentCode), 'real model did not recover the parent-only code');
        assert(body.message.includes(parentName), 'real model did not recover the quoted author');
      } else {
        assert.equal(body.message.trim(), 'NO_VISIBLE_QUOTE', 'outsider quote was not conservatively omitted');
      }
      const sent = {case: activeCase.kind, id: String(900 + sends.length), replyTo: String(body.replyTo), message: body.message, signed: true};
      sends.push(sent);
      res.writeHead(201, {'content-type': 'application/json'});
      res.end(JSON.stringify({ocs: {meta: {status: 'ok', statuscode: 100}, data: {id: sent.id, timestamp: Math.floor(Date.now() / 1000)}}}));
    } catch (error) {
      errors.push(`Talk fixture: ${String(error)}`); res.writeHead(500); res.end('proof assertion failed');
    }
  });
  const talkPort = await listen(talkServer), origin = `http://127.0.0.1:${talkPort}`;
  const reservation = net.createServer(), gatewayPort = await listen(reservation); await closeServer(reservation);
  env.OPENCLAW_GATEWAY_PORT = String(gatewayPort);
  await fs.writeFile(path.join(root, 'bot-secret'), secret, {mode: 0o600});
  await fs.writeFile(path.join(workspace, 'AGENTS.md'), '# Disposable quoted-reply proof\nAnswer the current message directly. Do not use tools. Do not send messages yourself; the channel delivers your final answer.\n');
  // Frozen source docs: native-user auth81–99; tool-policy186 supports deny wildcards.
  // No utilityModel is configured: do not add activity-summary/finalizer model work.
  const cfg = {
    gateway: {mode: 'local', bind: 'loopback', port: gatewayPort, auth: {mode: 'token', token: env.OPENCLAW_GATEWAY_TOKEN}, controlUi: {enabled: false}},
    agents: {entries: {main: {}}, defaults: {workspace, systemAgent: {agentId: 'main'}, heartbeat: {every: '0m'},
      model: {primary: modelRef, fallbacks: []}, models: {[modelRef]: {agentRuntime: {id: 'codex'}}}}},
    tools: {deny: ['*']}, memory: {search: {enabled: false}},
    accessGroups: {operators: {type: 'message.senders', members: {'nextcloud-talk': [currentSender, parentSender]}}},
    plugins: {enabled: true, allow: ['openai', 'codex', 'nextcloud-talk'], entries: {openai: {enabled: true},
      codex: {enabled: true, config: {computerUse: {enabled: false, autoInstall: false},
        appServer: {transport: 'stdio', homeScope: 'user', command: codexCommand, args: ['app-server'], sandbox: 'read-only', approvalPolicy: 'never'}}},
      'nextcloud-talk': {enabled: true}}},
    channels: {defaults: {contextVisibility: 'allowlist'}, 'nextcloud-talk': {enabled: true, baseUrl: origin,
      botSecretFile: path.join(root, 'bot-secret'), legacyWebhook: false, network: {dangerouslyAllowPrivateNetwork: true},
      groupPolicy: 'allowlist', groupAllowFrom: ['accessGroup:operators'], allowFrom: ['accessGroup:operators'],
      rooms: {[room]: {requireMention: false}}, streaming: {block: {enabled: false}}}},
    logging: {level: 'debug', consoleLevel: 'debug', file: path.join(privateLogs, 'gateway-core.jsonl')},
  };
  await fs.writeFile(configPath, JSON.stringify(cfg), {mode: 0o600});
  await command(['plugins', 'enable', 'openai', 'codex', 'nextcloud-talk', '--accept-capabilities'], 'admit-bundled-plugins');
  await command(['config', 'validate'], 'config-validate');
  for (const id of ['openai', 'codex', 'nextcloud-talk']) {
    const inspected = JSON.parse(await command(['plugins', 'inspect', id, '--runtime', '--json'], `inspect-${id}`));
    const plugin = inspected.plugin ?? inspected; assert.equal(plugin.status, 'loaded');
    assert.equal(await fs.realpath(plugin.rootDir), await fs.realpath(path.join(packageRoot, 'dist/extensions', id)));
    pluginIdentities.push({id, shippedRootRelative: path.relative(prefix, await fs.realpath(plugin.rootDir))});
  }
  logStream = createWriteStream(path.join(privateLogs, 'gateway.log'), {mode: 0o600});
  gateway = spawn(process.execPath, [entry, 'gateway', 'run', '--port', String(gatewayPort), '--bind', 'loopback'],
    {env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
  gateway.stdout.pipe(logStream, {end: false}); gateway.stderr.pipe(logStream, {end: false});
  gateway.once('error', () => errors.push('owned Gateway process failed to launch'));
  await eventually('candidate Gateway ready', async () => {
    try { return (await fetch(`http://127.0.0.1:${gatewayPort}/readyz`, {signal: AbortSignal.timeout(2000)})).ok; } catch { return false; }
  });
  await eventually('Talk durable route ready', async () => {
    try { return (await fs.readFile(path.join(privateLogs, 'gateway-core.jsonl'), 'utf8')).includes(`Gateway webhook route ready at port ${gatewayPort}/nextcloud-talk-webhook;`); } catch { return false; }
  });
  const allowedParent = {type: 'Note', actor: {type: 'Person', id: parentSender, name: parentName}, object: {
    ...note('101', `Launch code: ${parentCode}`),
    inReplyTo: {type: 'Note', actor: {type: 'Person', id: 'users/ancestor', name: 'Ancestor'}, object: note('99', ancestorMarker)},
    url: `${origin}/${unusedMarker}`}};
  const outsiderParent = {type: 'Note', actor: {type: 'Person', id: 'users/outsider', name: 'Outsider Cedar'}, object: note('102', hiddenCode)};
  const cases = [
    {id: '201', kind: 'allowed-access-group-parent', parent: allowedParent,
      text: 'What are the launch code and author in the quoted message? Reply with the code and the author’s displayed name only. Do not use tools.'},
    {id: '202', kind: 'unallowed-outsider-parent', parent: outsiderParent,
      text: 'For this message only, use only a quoted reply supplied alongside this exact message. If none is supplied, answer exactly NO_VISIBLE_QUOTE. Do not reuse any earlier quote. Do not use tools.'},
  ];
  assert(!cases[0].text.includes(parentCode) && !cases[0].text.includes(parentName));
  for (const [index, item] of cases.entries()) {
    activeCase = item;
    const startedAt = Date.now();
    const payload = {type: 'Create', actor: {type: 'Person', id: currentSender, name: 'Alice'},
      object: {...note(item.id, item.text), inReplyTo: item.parent}, target: {type: 'Collection', id: room, name: 'Synthetic quoted native proof'}};
    const raw = JSON.stringify(payload), random = randomUUID();
    const signature = createHmac('sha256', secret).update(random).update(raw).digest('hex');
    await fs.writeFile(path.join(evidence, `webhook-${item.id}.json`), raw, {mode: 0o600});
    const accepted = await fetch(`http://127.0.0.1:${gatewayPort}/nextcloud-talk-webhook`, {method: 'POST', body: raw,
      headers: {'content-type': 'application/json', 'x-nextcloud-talk-backend': `${origin}/`, 'x-nextcloud-talk-random': random, 'x-nextcloud-talk-signature': signature},
      signal: AbortSignal.timeout(10_000)});
    assert.equal(accepted.status, 200); assert.equal(accepted.headers.get('x-openclaw-delivery-accepted'), 'durable'); await accepted.arrayBuffer();
    await eventually(`case ${item.id} single bot send`, () => sends.length === index + 1);
    const completed = await eventually(`case ${item.id} durable completion`, async () => {
      const log = await fs.readFile(path.join(privateLogs, 'gateway.log'), 'utf8');
      return log.match(new RegExp(`message processed: channel=nextcloud-talk .*?messageId=${item.id}\\b.*? outcome=(\\w+)`));
    });
    assert.equal(completed[1], 'completed');
    const described = JSON.parse(await command(['gateway', 'call', 'sessions.describe', '--params', JSON.stringify({key: sessionKey}), '--json'], `session-${item.id}`));
    const session = described.session;
    assert.equal(session.status, 'done'); assert.equal(session.hasActiveRun, false); assert(!session.lastRunError);
    assert(session.endedAt >= startedAt); assert.equal(session.agentRuntime?.id, 'codex');
    assert.equal(session.modelProvider, 'openai'); assert.equal(session.model, model);
    assert.equal(typeof session.sessionId, 'string'); assert.equal(typeof session.lastRunId, 'string');
    terminal.push({case: item.kind, messageId: item.id, outcome: completed[1], session: publicSession(session)});
    if (index) {
      assert.equal(session.sessionId, terminal[0].session.sessionId, 'same conversation must survive both turns');
      assert.notEqual(session.lastRunId, terminal[0].session.lastRunId, 'second turn must be a new actual run');
    }
    assert.equal(sends.length, index + 1);
  }
  activeCase = undefined;
  assert.equal(sends.length, 2); assert.equal(errors.length, 0);
  qualification = {status: 'PASS',
    scope: 'Actual isolated installed candidate Gateway and native Codex harness with existing account and real model; signed synthetic loopback Talk only. Not a real Talk server/client, production canary, or direct provider-payload capture.',
    sourceSha, expectedVersion, installedPrefixArchiveSha256: archiveSha, entrySha256: await fileSha(entry),
    fixtureSha256: await fileSha(fileURLToPath(import.meta.url)), codex: {version: cliVersion, commandSha256: codexCommandSha,
      authMode: 'existing native user home; no OpenClaw login/import/prepared credential handoff'},
    pluginIdentities, modelRef, quotedAccessGroupMemberRead: true, outsiderQuoteOmitted: true,
    singleSignedCurrentTargetPerTurn: true, sends, terminal, commands,
    privateDiagnosticsExcluded: true};
} catch (error) { failure = error; }
finally {
  try { await stopGroup(gateway); } catch (error) { failure ??= error; }
  if (logStream) await new Promise(resolve => logStream.end(resolve));
  await closeServer(talkServer);
  const ownedGatewayStopped = !gateway?.pid || !groupAlive(gateway.pid);
  await fs.writeFile(path.join(evidence, 'cleanup.json'), JSON.stringify({ownedGatewayStopped, serverClosed: !talkServer?.listening,
    failed: Boolean(failure), errors, sends, terminal, commands, privateDiagnosticsExcluded: true}, null, 2), {mode: 0o600});
  if (!ownedGatewayStopped) failure ??= new Error('Owned Gateway process group remains active');
  process.stdout.write(`Evidence: ${evidence}\n`);
}
if (failure) throw failure;
await fs.writeFile(path.join(evidence, 'qualification.json'), JSON.stringify({...qualification,
  ownedGatewayStopped: true, serverClosed: true}, null, 2), {mode: 0o600});
