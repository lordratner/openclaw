// Installed stock SDK + stock plugin dependencies, with only dist overlaid.
import assert from 'node:assert/strict';
import {createHash, createHmac} from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
const proof = process.env.CANARY_PROOF_DIR;
const prefix = path.join(proof, 'stock-prefix');
const host = path.join(prefix, 'lib/node_modules/openclaw');
const plugin = path.join(prefix, 'lib/node_modules/@openclaw/nextcloud-talk');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const build = JSON.parse(await fs.readFile(path.join(host, 'dist/build-info.json')));
assert.equal(build.version, '2026.10.3');
assert.equal(build.commit, '59cb44796b0f1f0daa0e37af8b1495abb45d9bc1');
const originalPackage = await fs.readFile(path.join(plugin, 'package.json'));
assert.equal(JSON.parse(originalPackage).version, '2026.10.3');
const originalManifest = await fs.readFile(path.join(plugin, 'openclaw.plugin.json'));
// Caller has installed exact official packages. Overlay only the qualified dist.
await fs.rm(path.join(plugin, 'dist'), {recursive: true});
await fs.cp(path.resolve('extensions/nextcloud-talk/dist'), path.join(plugin, 'dist'), {recursive: true});
assert.equal(sha(await fs.readFile(path.join(plugin, 'package.json'))), sha(originalPackage));
assert.equal(sha(await fs.readFile(path.join(plugin, 'openclaw.plugin.json'))), sha(originalManifest));
const requireFromPlugin = createRequire(path.join(plugin, 'package.json'));
const resolvedSdk = await fs.realpath(requireFromPlugin.resolve('openclaw/plugin-sdk/channel-outbound'));
assert.equal(resolvedSdk, await fs.realpath(path.join(host, 'dist/plugin-sdk/channel-outbound.js')), 'plugin must actually resolve the asserted stock 10.3 SDK, not another peer install');
const sdkSha256 = sha(await fs.readFile(resolvedSdk));
for (const name of ['saxes', 'xmlchars']) {
  assert.throws(() => requireFromPlugin.resolve(name), {code: 'MODULE_NOT_FOUND'}, `${name} must not resolve outside compiled artifact`);
}
const {nextcloudTalkPlugin} = await import(pathToFileURL(path.join(plugin, 'dist/channel-plugin-api.js')).href);
assert.equal(typeof nextcloudTalkPlugin.message?.send?.media, 'function');
assert.equal(typeof nextcloudTalkPlugin.message?.send?.text, 'function');
const workspace = path.join(proof, 'consumer-workspace');
await fs.mkdir(workspace, {recursive: true});
const bytes = Buffer.from('%PDF-1.4\nStock SDK lazy media consumer\n%%EOF\n');
const mediaPath = path.join(workspace, 'consumer.pdf');
await fs.writeFile(mediaPath, bytes);
const requests = [], errors = [];
const secret = 'disposable-stock-consumer-bot-secret-00000001';
let referenceId;
let upload;
const server = http.createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(request.url, 'http://fixture.invalid');
    requests.push({method: request.method, pathname: url.pathname, byteLength: body.length});
    if (url.pathname.includes('/bot/')) {
      const text = JSON.parse(body.toString()).message;
      const random = request.headers['x-nextcloud-talk-bot-random'];
      const signature = request.headers['x-nextcloud-talk-bot-signature'];
      assert.equal(signature, createHmac('sha256', secret).update(random).update(text).digest('hex'));
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify({ocs: {meta: {statuscode: 100}, data: {id: 43}}}));
      return;
    }
    assert.equal(request.headers.authorization, `Basic ${Buffer.from('fixture-api:synthetic-app-password').toString('base64')}`);
    let data;
    if (url.pathname === '/ocs/v1.php/cloud/user') data = {id: 'fixture-api'};
    else if (request.method === 'MKCOL') {
      response.writeHead(201); response.end(); return;
    } else if (request.method === 'PUT') {
      upload = body;
      response.writeHead(201); // Deliberately no oc-fileid: must load bundled parser.
      response.end(); return;
    } else if (request.method === 'PROPFIND') {
      response.writeHead(207, {'content-type': 'application/xml'});
      response.end('<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:response><d:propstat><d:prop><oc:fileid>81</oc:fileid></d:prop></d:propstat></d:response></d:multistatus>');
      return;
    } else if (url.pathname === '/ocs/v2.php/apps/files_sharing/api/v1/shares') {
      const fields = new URLSearchParams(body.toString());
      assert.equal(fields.get('shareType'), '10');
      assert.equal(fields.get('shareWith'), 'fixture-room');
      assert.equal(fields.get('permissions'), '1');
      assert.deepEqual(JSON.parse(fields.get('talkMetaData')), {caption: 'Stock SDK lazy attachment', replyTo: 41});
      referenceId = fields.get('referenceId');
      assert(referenceId);
      data = {id: '700'};
    } else if (url.pathname === '/ocs/v2.php/apps/spreed/api/v1/chat/fixture-room') {
      assert.equal(url.searchParams.get('setReadMarker'), '0');
      assert.equal(url.searchParams.get('noStatusUpdate'), '1');
      assert.equal(url.searchParams.get('markNotificationsAsRead'), '0');
      data = [{id: 42, token: 'fixture-room', actorType: 'users', actorId: 'fixture-api', referenceId, parent: {id: 41}, messageParameters: {file: {id: '81'}}}];
    } else throw new Error('unexpected fixture route');
    response.writeHead(200, {'content-type': 'application/json'});
    response.end(JSON.stringify({ocs: {meta: {statuscode: 100}, data}}));
  } catch (error) {
    errors.push(String(error));
    response.writeHead(500); response.end('fixture assertion failed');
  }
});
await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
let result, failure;
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const cfg = {channels: {'nextcloud-talk': {enabled: true, baseUrl: origin, botSecret: secret, apiUser: 'fixture-api', apiPassword: 'synthetic-app-password', network: {dangerouslyAllowPrivateNetwork: true}}}};
  const context = {cfg, to: 'room:fixture-room', text: 'Stock SDK lazy attachment', mediaUrl: mediaPath, mediaLocalRoots: [workspace], replyToId: '41'};
  result = await nextcloudTalkPlugin.message.send.media(context);
  assert.deepEqual(upload, bytes);
  assert.equal(result.messageId, '42');
  assert.deepEqual(result.receipt.platformMessageIds, ['42']);
  assert.equal(result.receipt.replyToId, '41');
  assert.equal(requests.filter(item => item.method === 'PROPFIND').length, 1);
  const textResult = await nextcloudTalkPlugin.message.send.text({...context, mediaUrl: undefined, text: 'Ordinary stock text control'});
  assert.equal(textResult.messageId, '43');
  assert.equal(errors.length, 0, errors.join('\n'));
} catch (error) {
  failure = error;
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await fs.writeFile(path.join(proof, 'stock-consumer.json'), JSON.stringify({status: failure ? 'FAIL' : 'PASS', scope: 'Compiled plugin native media and ordinary text against exact official 10.3 SDK/dependencies using real loopback HTTP; not installed Gateway or real Nextcloud proof', ...(failure ? {error: String(failure)} : {}), hostVersion: build.version, hostCommit: build.commit, stockSdkResolutionVerified: true, sdkSha256, pluginPackageSha256: sha(originalPackage), pluginManifestSha256: sha(originalManifest), lazyMediaExecuted: !failure, bundledXmlParserExecuted: !failure, parserDependenciesUnresolvable: true, packageAndManifestPreserved: true, mediaSha256: sha(bytes), requests, errors}, null, 2));
}
if (failure) throw failure;
