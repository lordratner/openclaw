// Fork-only proof against an isolated official Nextcloud/Talk container.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {proveAutomaticReply} from './automatic-nextcloud.mjs';
import {overlayQualifiedDist} from './overlay-dist.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
const root = path.join(process.env.RUNNER_TEMP, 'nextcloud-outbound-live');
const evidence = path.join(root, 'evidence');
await fs.mkdir(evidence, {recursive: true});
const origin = 'http://127.0.0.1:18080';
const user = 'outbound-proof';
const recipient = 'outbound-recipient';
// Synthetic credentials exist only in this disposable CI server.
const password = 'nextcloud-disposable-proof-password';
const authorization = actor => `Basic ${Buffer.from(`${actor}:${password}`).toString('base64')}`;
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
const steps = [];

async function command(executable, args, label, env = process.env, expected = 0) {
  const started = Date.now();
  const child = spawn(executable, args, {env, stdio: ['ignore', 'pipe', 'pipe']});
  const output = [], errors = [];
  child.stdout.on('data', chunk => output.push(chunk));
  child.stderr.on('data', chunk => errors.push(chunk));
  const timeout = setTimeout(() => child.kill('SIGKILL'), 600_000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  }).finally(() => clearTimeout(timeout));
  const stdout = Buffer.concat(output).toString();
  const stderr = Buffer.concat(errors).toString();
  await fs.writeFile(path.join(evidence, label + '.log'), stdout + '\nSTDERR:\n' + stderr);
  steps.push({label, code, wallMs: Date.now() - started});
  if (expected === 0) { assert.equal(code, 0, `${label}: ${stderr.slice(-3000)}`); }
  else if (expected === 'failure') {
    if (code === 0) { assert.equal(JSON.parse(stdout).ok, false, `${label}: unexpectedly succeeded`); }
  } else { assert.notEqual(code, 0, `${label}: unexpectedly succeeded`); }
  return stdout;
}

async function ocs(actor, endpoint, body) {
  const response = await fetch(origin + '/ocs/v2.php' + endpoint, {
    method: body ? 'POST' : 'GET',
    headers: {Authorization: authorization(actor), 'OCS-APIRequest': 'true', Accept: 'application/json'},
    ...(body ? {body: new URLSearchParams(body)} : {}),
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, `OCS ${endpoint}: ${response.status}`);
  const result = await response.json();
  assert.equal(result.ocs.meta.status, 'ok');
  return result.ocs.data;
}

async function history(actor, token) {
  return await ocs(actor, `/apps/spreed/api/v1/chat/${token}?lookIntoFuture=0&limit=100&setReadMarker=0&noStatusUpdate=1&markNotificationsAsRead=0`);
}

const state = path.join(root, 'state');
const prefix = path.join(root, 'prefix');
const workspace = path.join(root, 'workspace');
await fs.mkdir(state, {recursive: true});
await fs.mkdir(workspace, {recursive: true});
const configPath = path.join(state, 'openclaw.json');
const apiPasswordFile = path.join(root, 'app-password');
const botSecretFile = path.join(root, 'bot-secret');
await fs.writeFile(apiPasswordFile, password, {mode: 0o600});
await fs.writeFile(botSecretFile, 'nextcloud-disposable-outbound-proof-bot-secret-20261015', {mode: 0o600});
const env = {...process.env};
for(const key of Object.keys(env)) if(key.startsWith('OPENCLAW_') && key!=='OPENCLAW_QA_SOURCE_ROOT') delete env[key];
Object.assign(env,{HOME:root,OPENCLAW_HOME:root,OPENCLAW_STATE_DIR:state,OPENCLAW_CONFIG_PATH:configPath,OPENCLAW_DISABLE_BONJOUR:'1'});
delete env.CODEX_HOME;
delete env.OPENAI_API_KEY;
for (const key of ['OPENCLAW_PROFILE','OPENCLAW_AGENT_DIR','PI_CODING_AGENT_DIR','OPENCLAW_SESSION_KEY','OPENCLAW_SESSION_ID','OPENCLAW_AGENT_ID','OPENCLAW_DELIVERY_TARGET','OPENCLAW_CHANNEL','OPENCLAW_ACCOUNT_ID','ANTHROPIC_API_KEY']) delete env[key];
env.npm_config_registry='https://registry.npmjs.org';
env.npm_config_prefix=prefix;
const entry = path.join(prefix, 'lib/node_modules/openclaw/openclaw.mjs');
const cli = (args, label, expected = 0) => command(process.execPath, [entry, ...args], label, env, expected);

try {
  await command('npm', ['install', '--global', '--prefix', prefix, '--registry', 'https://registry.npmjs.org', 'openclaw@2026.10.3', '--no-audit', '--no-fund'], 'install-official-core-103', env);
  const coreRoot=path.dirname(entry);
  const build=JSON.parse(await fs.readFile(path.join(coreRoot,'dist/build-info.json')));
  assert.equal(build.version,'2026.10.3');
  assert.equal(build.commit,'59cb44796b0f1f0daa0e37af8b1495abb45d9bc1');
  const protectedCorePaths=['openclaw.mjs','package.json','dist/build-info.json','dist/extensions/openai/index.js','dist/plugin-sdk/channel-outbound.js'];
  const coreHashes=Object.fromEntries(await Promise.all(protectedCorePaths.map(async p=>[p,sha(await fs.readFile(path.join(coreRoot,p)))])));
  await fs.writeFile(configPath, JSON.stringify({
    gateway: {mode: 'local'},
    agents: {entries: {main: {}}, defaults: {workspace, systemAgent: {agentId: 'main'}, heartbeat: {every: '0m'}}},
  }));
  // Canonical CLI installation retains official provenance and managed records.
  // A bare npm sibling or local tarball install would not prove the same trust.
  await cli(['plugins','install','@openclaw/nextcloud-talk@2026.10.3'], 'install-official-managed-talk-103');
  const inspectPlugin = async label => {
    const inspected=JSON.parse(await cli(['plugins','inspect','nextcloud-talk','--runtime','--json'],label));
    const p=inspected.plugin ?? inspected;
    assert.equal(p.packageName,'@openclaw/nextcloud-talk');
    assert.equal(p.version,'2026.10.3');
    assert.equal(p.trustedOfficialInstall,true);
    assert.equal(p.trust?.reason,'trusted-official');
    assert.equal(await fs.realpath(p.rootDir),path.resolve(p.rootDir));
    assert(path.resolve(p.rootDir).startsWith(root+path.sep),'ambient plugin install refused');
    return p;
  };
  const stockPlugin=await inspectPlugin('official-plugin-stock-inspect');
  const installerConfig=JSON.parse(await fs.readFile(configPath));
  assert(installerConfig.plugins,'canonical install did not preserve plugin configuration');
  const beforePluginConfig=structuredClone(installerConfig.plugins);
  installerConfig.plugins={...installerConfig.plugins,
    allow:[...new Set([...(installerConfig.plugins.allow ?? []),'nextcloud-talk'])],
    entries:{...installerConfig.plugins.entries,'nextcloud-talk':{...installerConfig.plugins.entries?.['nextcloud-talk'],enabled:true}}};
  installerConfig.channels={...installerConfig.channels,'nextcloud-talk':{enabled:true,baseUrl:origin,botSecretFile,apiUser:user,apiPasswordFile,network:{dangerouslyAllowPrivateNetwork:true}}};
  assert(!Object.hasOwn(installerConfig.channels['nextcloud-talk'],'mediaAllowFrom'),'main-only inbound option is unsupported on 10.3');
  await fs.writeFile(configPath,JSON.stringify(installerConfig));
  const overlay=await overlayQualifiedDist({root,pluginRoot:stockPlugin.rootDir,evidence});
  await cli(['config','validate'],'config-validate-103');
  const candidatePlugin=await inspectPlugin('official-plugin-candidate-inspect');
  assert.equal(candidatePlugin.rootDir,stockPlugin.rootDir);
  assert.equal(candidatePlugin.status,'loaded');
  const afterPluginConfig=JSON.parse(await fs.readFile(configPath)).plugins;
  assert.deepEqual(afterPluginConfig.installs,beforePluginConfig.installs,'official install records changed');
  const resolveFromPlugin=createRequire(path.join(candidatePlugin.rootDir,'package.json'));
  const resolvedSdk=await fs.realpath(resolveFromPlugin.resolve('openclaw/plugin-sdk/channel-outbound'));
  assert.equal(resolvedSdk,await fs.realpath(path.join(coreRoot,'dist/plugin-sdk/channel-outbound.js')),'managed plugin resolves another SDK instead of the asserted official 10.3 host');
  for(const [p,hash] of Object.entries(coreHashes)) assert.equal(sha(await fs.readFile(path.join(coreRoot,p))),hash,`core file changed during plugin installation/overlay: ${p}`);
  await fs.writeFile(path.join(evidence,'official-install.json'),JSON.stringify({status:'PASS',version:build.version,commit:build.commit,
    officialManagedPluginRoot:candidatePlugin.rootDir,officialTrust:true,installRecordsPreserved:true,coreHashes,resolvedSdk,
    scope:'official npm 10.3 core and canonical official managed Talk install; only qualified Talk dist overlaid',overlayArtifactSha256:overlay.distArtifactSha256},null,2));
  const room = await ocs(user, '/apps/spreed/api/v4/room', {roomType: '2', roomName: 'Disposable outbound proof'});
  const token = room.token;
  await ocs(user, `/apps/spreed/api/v4/room/${token}/participants`, {newParticipant: recipient});
  const file = path.join(workspace, 'report.pdf');
  const bytes = Buffer.from('%PDF-1.4\nDisposable proof document\n%%EOF\n');
  await fs.writeFile(file, bytes);
  const result = JSON.parse(await cli(['message', 'send', '--channel', 'nextcloud-talk', '--target', token, '--message', 'Disposable caption', '--media', file, '--json'], 'captioned-file'));
  const ownHistory = await history(user, token);
  const first = ownHistory.find(message => message.actorType === 'users' && message.actorId === user && message.messageParameters?.file);
  assert(first, 'missing real native file chat message');
  assert(JSON.stringify(first).includes('Disposable caption'), 'caption missing');
  assert.equal(String(result.messageId), String(first.id), 'CLI did not return the native chat ID');
  const shares = await ocs(user, '/apps/files_sharing/api/v1/shares?path=' + encodeURIComponent('/' + first.messageParameters.file.path));
  assert(shares.some(share => Number(share.share_type) === 10 && share.share_with === token && Number(share.permissions) === 1));
  const recipientHistory = await history(recipient, token);
  const received = recipientHistory.find(message => message.id === first.id);
  assert(received?.messageParameters?.file?.path, 'recipient has no native attachment');
  const davPath = received.messageParameters.file.path.split('/').map(encodeURIComponent).join('/');
  const download = await fetch(`${origin}/remote.php/dav/files/${recipient}/${davPath}`, {headers: {Authorization: authorization(recipient)}, redirect: 'error'});
  assert(download.ok, `recipient download failed: ${download.status}`);
  assert.equal(sha(Buffer.from(await download.arrayBuffer())), sha(bytes));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const image = path.join(workspace, 'image.png');
  await fs.writeFile(image, png);
  const imageResult = JSON.parse(await cli(['message', 'send', '--channel', 'nextcloud-talk', '--target', token, '--media', image, '--reply-to', String(first.id), '--json'], 'captionless-image-reply'));
  const updated = await history(user, token);
  const second = updated.find(message => message.id !== first.id && message.messageParameters?.file);
  assert(second, 'missing captionless image');
  assert.equal(String(imageResult.messageId), String(second.id), 'CLI image receipt did not return the native chat ID');
  assert.equal(String(second.parent?.id), String(first.id));
  const secondRecipient = (await history(recipient, token)).find(message => message.id === second.id);
  const imageShares=await ocs(user,'/apps/files_sharing/api/v1/shares?path='+encodeURIComponent('/'+second.messageParameters.file.path));
  assert(imageShares.some(share=>Number(share.share_type)===10 && share.share_with===token && Number(share.permissions)===1));
  const imagePath = secondRecipient.messageParameters.file.path.split('/').map(encodeURIComponent).join('/');
  const imageDownload = await fetch(`${origin}/remote.php/dav/files/${recipient}/${imagePath}`, {headers: {Authorization: authorization(recipient)}, redirect: 'error'});
  assert(imageDownload.ok);
  assert.equal(sha(Buffer.from(await imageDownload.arrayBuffer())), sha(png));
  const foreignRoom = await ocs(recipient, '/apps/spreed/api/v4/room', {roomType: '2', roomName: 'Excluded API user'});
  await cli(['message', 'send', '--channel', 'nextcloud-talk', '--target', foreignRoom.token, '--media', file, '--json'], 'nonparticipant-rejected', 'failure');
  const rejectedLog = await fs.readFile(path.join(evidence, 'nonparticipant-rejected.log'), 'utf8');
  assert.match(rejectedLog, /attachment delivery not confirmed/);
  const ownedShares = await ocs(user, '/apps/files_sharing/api/v1/shares');
  assert.equal(ownedShares.filter(share => share.share_with === foreignRoom.token).length, 0, 'excluded room received a share');
  assert.equal((await history(recipient, foreignRoom.token)).filter(message => message.messageParameters?.file).length, 0);
  const automatic = await proveAutomaticReply({root, evidence, entry, env, origin, user, recipient, password, roomToken: token, mediaPath: file, expectedBytes: bytes, cli, ocs, history, command});
  assert.equal(automatic.status, 'PASS');
  for(const [p,hash] of Object.entries(coreHashes)) assert.equal(sha(await fs.readFile(path.join(coreRoot,p))),hash,`core file changed: ${p}`);
  await fs.writeFile(path.join(evidence, 'qualification.json'), JSON.stringify({status: 'PASS', scope: 'Official OpenClaw 2026.10.3 core59 + official managed Talk with qualified dist-only canary; disposable Nextcloud35/Talk25, not production/UI/real-model proof', coreVersion:build.version, coreCommit:build.commit, producerRun:overlay.producerRun, distArtifactSha256:overlay.distArtifactSha256, sourceManifestSha256:overlay.sourceManifestSha256, officialTrust:true, guardedCoreFilesUnchanged:true, nativeFileMessages: 2, recipientByteEquality: true, readOnlyRoomShares: true, captionAndNativeReply: true, nonparticipantDenied: true, automaticGatewayProof: 'automatic-reply.json', automaticNativeAttachment: true, signedOwnEchoReceived: true, apiActorTextPreserved: true, steps}, null, 2));
} catch (error) {
  await fs.writeFile(path.join(evidence, 'failure.json'), JSON.stringify({status: 'FAIL', error: String(error), steps}, null, 2));
  throw error;
}
