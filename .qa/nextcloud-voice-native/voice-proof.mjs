// CI-only real Talk protocol proof. Synthetic audio/TTS; never production state.
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
import {proveTalkVoicePresentation} from './browser-proof.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
const root = path.join(process.env.RUNNER_TEMP, 'nextcloud-voice-live');
const evidence = path.join(root, 'evidence');
await fs.mkdir(evidence, {recursive: true});
const origin = 'http://127.0.0.1:18080';
const user = 'outbound-proof', recipient = 'outbound-recipient';
const password = 'nextcloud-disposable-proof-password';
const token = 'disposable-voice-proof-gateway-token';
const authorization = actor => `Basic ${Buffer.from(`${actor}:${password}`).toString('base64')}`;
const sha = value => createHash('sha256').update(value).digest('hex');
const steps = [], cases = [], synthesis = [], errors = [];
const state = path.join(root, 'state'), workspace = path.join(root, 'workspace');
const packageRoot = path.join(root, 'prefix/node_modules/openclaw');
const entry = path.join(packageRoot, 'openclaw.mjs');
const configPath = path.join(state, 'openclaw.json');
const env = {...process.env, HOME: root, OPENCLAW_HOME: root, OPENCLAW_STATE_DIR: state,
  OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_DISABLE_BONJOUR: '1', OPENCLAW_GATEWAY_TOKEN: token,
  OPENAI_API_KEY: 'synthetic-no-real-provider-key'};
for (const key of ['CODEX_HOME', 'GH_TOKEN', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY']) delete env[key];
let gateway, log, speech, failure, presentation;

async function listen(server) {
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  return server.address().port;
}
async function close(server) {
  if (!server?.listening) return;
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
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
async function ocs(actor, endpoint, body) {
  const response = await fetch(origin + '/ocs/v2.php' + endpoint, {
    method: body ? 'POST' : 'GET', headers: {Authorization: authorization(actor), 'OCS-APIRequest': 'true', Accept: 'application/json'},
    ...(body ? {body: new URLSearchParams(body)} : {}), signal: AbortSignal.timeout(30_000), redirect: 'error',
  });
  assert(response.ok, `OCS ${response.status}`);
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
  // The runner's existing encoder is fixture tooling, not a product dependency.
  const wav = path.join(workspace, 'reply.wav'), mp3 = path.join(workspace, 'reply.mp3'), ogg = path.join(workspace, 'reply.ogg');
  await command('ffmpeg', ['-hide_banner', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.25', '-ar', '24000', '-codec:a', 'pcm_s16le', wav], 'generate-wav');
  await command('ffmpeg', ['-hide_banner', '-i', wav, '-codec:a', 'libmp3lame', mp3], 'generate-mp3');
  await command('ffmpeg', ['-hide_banner', '-i', wav, '-codec:a', 'libopus', ogg], 'generate-ogg-control');
  const mp3Bytes = await fs.readFile(mp3);
  speech = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, {'content-type': 'application/json'});
        return res.end(JSON.stringify({object: 'list', data: [{id: 'gpt-5.6-luna', object: 'model', owned_by: 'synthetic-proof'}]}));
      }
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/v1/audio/speech', 'no real inference should be needed to invoke the message tool');
      const chunks = []; let size = 0;
      for await (const chunk of req) {size += chunk.length; assert(size < 32_768); chunks.push(chunk);}
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(body.response_format, 'mp3', 'Talk must select audio-file synthesis, not Opus voice-note synthesis');
      assert.equal(body.input, 'Synthetic voice-reply protocol proof.');
      synthesis.push({model: body.model, responseFormat: body.response_format, input: body.input, audioSha256: sha(mp3Bytes)});
      res.writeHead(200, {'content-type': 'audio/mpeg'}); res.end(mp3Bytes);
    } catch (error) {errors.push(String(error)); res.writeHead(500); res.end('fixture assertion failed');}
  });
  const speechPort = await listen(speech);
  const reserve = net.createServer(), gatewayPort = await listen(reserve); await close(reserve);
  const room = await ocs(user, '/apps/spreed/api/v4/room', {roomType: '2', roomName: 'Disposable voice-output proof'});
  await ocs(user, `/apps/spreed/api/v4/room/${room.token}/participants`, {newParticipant: recipient});
  const apiPasswordFile = path.join(root, 'app-password'), botSecretFile = path.join(root, 'bot-secret');
  await fs.writeFile(apiPasswordFile, password, {mode: 0o600});
  await fs.writeFile(botSecretFile, 'nextcloud-disposable-voice-output-proof-bot-secret-20261020', {mode: 0o600});
  const cfg = {
    gateway: {mode: 'local', bind: 'loopback', port: gatewayPort, auth: {mode: 'token', token}, controlUi: {enabled: false}},
    agents: {entries: {main: {}}, defaults: {workspace, systemAgent: {agentId: 'main'}, heartbeat: {every: '0m'}}},
    memory: {search: {enabled: false}},
    tools: {profile: 'full'},
    plugins: {enabled: true, allow: ['nextcloud-talk', 'openai'], entries: {'nextcloud-talk': {enabled: true}, openai: {enabled: true}}},
    channels: {'nextcloud-talk': {enabled: true, baseUrl: origin, botSecretFile, apiUser: user, apiPasswordFile, legacyWebhook: false,
      network: {dangerouslyAllowPrivateNetwork: true}, groupPolicy: 'allowlist', rooms: {[room.token]: {requireMention: false}}}},
    tts: {auto: 'tagged', provider: 'openai', providers: {openai: {apiKey: 'synthetic-proof-key', baseUrl: `http://127.0.0.1:${speechPort}/v1`, model: 'tts-1', voice: 'alloy'}}},
    logging: {level: 'debug', consoleLevel: 'debug', file: path.join(evidence, 'gateway-core.jsonl')},
  };
  const {applyMockOpenAiModelConfig} = await import(pathToFileURL(path.resolve('scripts/e2e/lib/fixtures/mock-openai-config.mjs')).href);
  applyMockOpenAiModelConfig(cfg, {mockPort: speechPort});
  await fs.writeFile(configPath, JSON.stringify(cfg));
  await cli(['plugins', 'enable', 'openai', 'nextcloud-talk', '--accept-capabilities'], 'admit-bundled-plugins');
  await cli(['config', 'validate'], 'validate-config');
  for (const id of ['nextcloud-talk', 'openai']) {
    const inspected = JSON.parse(await cli(['plugins', 'inspect', id, '--runtime', '--json'], `inspect-${id}`));
    const plugin = inspected.plugin ?? inspected;
    assert.equal(plugin.status, 'loaded');
    assert.equal(await fs.realpath(plugin.rootDir), await fs.realpath(path.join(packageRoot, 'dist/extensions', id)));
  }
  const beforeConfig = await fs.readFile(configPath);
  log = createWriteStream(path.join(evidence, 'gateway.log'));
  gateway = spawn(process.execPath, [entry, 'gateway', 'run', '--port', String(gatewayPort), '--bind', 'loopback'], {env, stdio: ['ignore', 'pipe', 'pipe']});
  gateway.stdout.pipe(log, {end: false}); gateway.stderr.pipe(log, {end: false});
  gateway.once('error', error => errors.push(String(error)));
  await eventually('installed Gateway readiness', async () => {try {return (await fetch(`http://127.0.0.1:${gatewayPort}/readyz`, {signal: AbortSignal.timeout(2000)})).ok;} catch {return false;}});
  await eventually('Talk webhook route ready', async () => {try {return (await fs.readFile(path.join(evidence, 'gateway-core.jsonl'), 'utf8')).includes('Gateway webhook route ready');} catch {return false;}});

  async function send(label, args, expectedType, expectedFile, expectedParent) {
    const caption = `${label} ${randomUUID()}`;
    const prior = new Set((await history(room.token)).map(message => String(message.id)));
    const response = await fetch(`http://127.0.0.1:${gatewayPort}/tools/invoke`, {method: 'POST',
      headers: {Authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-openclaw-message-channel': 'nextcloud-talk', 'x-openclaw-message-to': room.token},
      body: JSON.stringify({tool: 'message', sessionKey: 'main', args: {action: 'send', channel: 'nextcloud-talk', target: room.token, message: caption, ...args}}),
      signal: AbortSignal.timeout(120_000),
    });
    const result = await response.json();
    await fs.writeFile(path.join(evidence, `${label}-tool-result.json`), JSON.stringify(result, null, 2));
    assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.ok, true);
    const added = (await history(room.token)).filter(message => !prior.has(String(message.id)) && message.actorId === user && message.messageParameters?.file);
    assert.equal(added.length, 1, 'one tool send must create one native attachment');
    const received = added[0];
    assert.equal(received.messageType, expectedType);
    assert(JSON.stringify(received).includes(caption), 'visible caption preserved');
    if (expectedParent) assert.equal(String(received.parent?.id), expectedParent);
    const receipts = [];
    const inspectResult = value => {
      if (!value || typeof value !== 'object') return;
      if (value.receipt?.platformMessageIds) receipts.push(value.receipt);
      if (value.type === 'text' && typeof value.text === 'string') {
        try {inspectResult(JSON.parse(value.text));} catch {}
      }
      for (const child of Object.values(value)) {
        if (Array.isArray(child)) child.forEach(inspectResult);
        else if (child && typeof child === 'object') inspectResult(child);
      }
    };
    inspectResult(result.result);
    const receipt = receipts.find(item => item.platformMessageIds.includes(String(received.id)));
    assert(receipt, 'tool receipt must identify the actual native chat message');
    assert(receipt.parts.some(part => part.platformMessageId === String(received.id) && part.kind === (expectedType === 'voice-message' ? 'voice' : 'media')));
    if (expectedParent) assert.equal(receipt.replyToId, expectedParent);
    const file = received.messageParameters.file;
    const davPath = file.path.split('/').map(encodeURIComponent).join('/');
    const download = await fetch(`${origin}/remote.php/dav/files/${recipient}/${davPath}`, {headers: {Authorization: authorization(recipient)}, redirect: 'error', signal: AbortSignal.timeout(30_000)});
    assert(download.ok);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(sha(bytes), sha(await fs.readFile(expectedFile)), 'recipient bytes equal source');
    const local = path.join(root, `${label}${path.extname(expectedFile)}`);
    await fs.writeFile(local, bytes);
    const inspected = JSON.parse(await command('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', local], `${label}-streams`));
    assert(inspected.streams.some(stream => stream.codec_type === 'audio'));
    await command('ffmpeg', ['-v', 'error', '-i', local, '-f', 'null', '-'], `${label}-decode`);
    cases.push({label, nativeChatId: String(received.id), messageType: received.messageType, fileMimeType: file.mimetype, recipientByteEquality: true, audioSha256: sha(bytes), replyTo: received.parent?.id, inspectedStreams: inspected.streams, audioDecodeSucceeded: true, receipt});
    return String(received.id);
  }
  const first = await send('synthesized-voice', {voiceText: 'Synthetic voice-reply protocol proof.'}, 'voice-message', mp3);
  assert.equal(synthesis.length, 1, 'existing TTS capability selects native voice without an explicit asVoice flag');
  await send('wav-voice-reply', {media: wav, asVoice: true, replyTo: first}, 'voice-message', wav, first);
  await send('ordinary-audio', {media: mp3}, 'comment', mp3);
  await send('unsupported-native-voice', {media: ogg, asVoice: true}, 'comment', ogg);
  assert.equal(synthesis.length, 1, 'ordinary attachments must not synthesize speech');
  assert.deepEqual(await fs.readFile(configPath), beforeConfig);
  const shares = await ocs(user, '/apps/files_sharing/api/v1/shares');
  const roomShares = shares.filter(share => share.share_with === room.token);
  assert.equal(roomShares.length, 4);
  assert(roomShares.every(share => Number(share.share_type) === 10 && Number(share.permissions) === 1));
  presentation = await proveTalkVoicePresentation({origin, recipient, password, roomToken: room.token, cases, evidence});
} catch (error) {failure = error;}
finally {
  if (gateway?.pid && gateway.exitCode === null && gateway.signalCode === null) {
    const stopped = new Promise(resolve => gateway.once('exit', resolve)); gateway.kill('SIGTERM');
    const timer = setTimeout(() => gateway.kill('SIGKILL'), 10_000); await stopped.finally(() => clearTimeout(timer));
  }
  if (log) await new Promise(resolve => log.end(resolve));
  await close(speech);
  await fs.writeFile(path.join(evidence, 'qualification.json'), JSON.stringify({status: failure ? 'FAIL' : 'PASS', source: process.env.SOURCE_SHA,
    scope: 'Installed Gateway/message tool/TTS owner and real disposable Nextcloud35/Talk25.0.6; synthetic tone and local speech endpoint, plus actual headless Chromium presentation. Not human speech synthesis, a real LLM, production deployment, audible or mobile playback proof.',
    error: failure ? String(failure) : undefined, cases, synthesis, steps, errors, presentation, ownedGatewayStopped: !gateway || gateway.exitCode !== null || gateway.signalCode !== null, speechServerClosed: !speech?.listening}, null, 2));
}
if (failure) throw failure;
