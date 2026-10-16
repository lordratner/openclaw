// Fork-only disposable proof. Never import this module in a production process.
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

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function listen(server, host = '127.0.0.1') {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  return server.address().port;
}
async function closeServer(server) {
  if (!server.listening) return;
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}
async function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  await ended.finally(() => clearTimeout(timer));
}
async function eventually(label, check, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(500);
  }
  throw new Error(`Timed out: ${label}`);
}
async function bodyBytes(req, limit = 4 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    assert(size <= limit, 'fixture HTTP body limit exceeded');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Responses SSE shape mirrors the pinned canonical MockResponseStream owner.
function responseEvents(text, ordinal) {
  const id = `resp_nextcloud_${ordinal}`;
  const itemId = `msg_nextcloud_${ordinal}`;
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
    {type: 'response.completed', response: {id, object: 'response', status: 'completed', output: [item], usage: {input_tokens: 64, output_tokens: 32, total_tokens: 96}}},
  ];
}

export async function proveAutomaticReply({root, evidence, entry, env, origin, user, recipient, password, roomToken, mediaPath, expectedBytes, cli, ocs, history, command}) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'disposable GitHub CI only');
  assert.equal(origin, 'http://127.0.0.1:18080', 'refuse nonfixture Nextcloud');
  assert.equal(user, 'outbound-proof');
  assert.equal(recipient, 'outbound-recipient');
  assert.equal(password, 'nextcloud-disposable-proof-password');
  assert.equal(path.resolve(env.OPENCLAW_STATE_DIR), path.join(root, 'state'));
  const configPath = env.OPENCLAW_CONFIG_PATH;
  assert.equal(path.resolve(configPath), path.join(root, 'state/openclaw.json'));
  const beforeConfig = await fs.readFile(configPath);
  const cfg = JSON.parse(beforeConfig);
  const secretPath = cfg.channels['nextcloud-talk'].botSecretFile;
  assert.equal(path.resolve(secretPath), path.join(root, 'bot-secret'));
  const beforeSecret = await fs.readFile(secretPath);
  const botSecret = beforeSecret.toString().trim();
  assert(botSecret.length >= 40 && botSecret.length <= 128, 'Talk requires a 40–128 character disposable bot secret');
  const caption = `Automatic native attachment ${randomUUID()}`;
  const inboundMarker = `Request automatic native attachment ${randomUUID()}`;
  const actorMarker = `API account ordinary text control ${randomUUID()}`;
  const actorAnswer = `API account ordinary text accepted ${randomUUID()}`;
  const inference = [], utility = [], callbacks = [], errors = [], terminal = [];
  const mainModel = 'gpt-5.6-luna';
  const utilityModel = 'gpt-5.6-luna-utility';
  let gateway, gatewayLog, result, failure;
  let mock, relay;
  try {
    // This is the exact canonical fixture from the candidate checkout; do not
    // copy a guessed provider/model/runtime config into this standalone proof.
    const fixture = path.resolve(process.env.OPENCLAW_QA_SOURCE_ROOT ?? process.cwd(), 'scripts/e2e/lib/fixtures/mock-openai-config.mjs');
    const {applyMockOpenAiModelConfig} = await import(pathToFileURL(fixture).href);
    mock = http.createServer(async (req, res) => {
      try {
        if (req.method === 'GET' && req.url === '/v1/models') {
          res.writeHead(200, {'content-type': 'application/json'});
          res.end(JSON.stringify({object: 'list', data: [mainModel, utilityModel].map(id => ({id, object: 'model', owned_by: 'synthetic-proof'}))}));
          return;
        }
        assert.equal(req.method, 'POST');
        assert.equal(req.url, '/v1/responses');
        const body = JSON.parse((await bodyBytes(req)).toString());
        const bodyText = JSON.stringify(body.input);
        let text, responseId;
        if (body.model === utilityModel) {
          utility.push({ordinal: utility.length + 1, model: body.model, inputSha256: sha(bodyText)});
          text = 'Synthetic fixture utility response.';
          responseId = `utility_${utility.length}`;
        } else {
          assert.equal(body.model, mainModel);
          const sawInboundMarker = bodyText.includes(inboundMarker);
          const sawApiActorMarker = bodyText.includes(actorMarker);
          assert(sawInboundMarker || sawApiActorMarker, 'unexpected main-model call');
          inference.push({ordinal: inference.length + 1, receivedAt: Date.now(), model: body.model, inputBytes: Buffer.byteLength(bodyText), inputSha256: sha(bodyText), sawInboundMarker, sawApiActorMarker});
          text = sawApiActorMarker ? actorAnswer : `${caption}\n\nMEDIA:${mediaPath}`;
          responseId = `main_${inference.length}`;
        }
        const events = responseEvents(text, responseId);
        if (body.stream === false) {
          res.writeHead(200, {'content-type': 'application/json'});
          res.end(JSON.stringify(events.at(-1).response));
        } else {
          res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store'});
          for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
          res.end('data: [DONE]\n\n');
        }
      } catch (error) {
        errors.push(`model: ${String(error)}`);
        res.writeHead(500); res.end('synthetic fixture failed');
      }
    });
    const modelPort = await listen(mock);
    // Reserve a free fixture port immediately before starting our child. No
    // installed/user Gateway is stopped or reused; a bind race fails the proof.
    const reservation = net.createServer();
    const gatewayPort = await listen(reservation);
    await closeServer(reservation);
    relay = http.createServer(async (req, res) => {
      try {
        assert.equal(req.method, 'POST');
        assert.equal(req.url, '/nextcloud-talk-webhook');
        const raw = await bodyBytes(req);
        const random = req.headers['x-nextcloud-talk-random'];
        const supplied = req.headers['x-nextcloud-talk-signature'];
        assert.equal(typeof random, 'string');
        assert.equal(typeof supplied, 'string');
        const expected = createHmac('sha256', botSecret).update(random).update(raw).digest('hex');
        assert.equal(supplied.length, expected.length);
        assert(timingSafeEqual(Buffer.from(supplied.toLowerCase()), Buffer.from(expected)), 'real Talk callback HMAC invalid');
        assert.equal(req.headers['x-nextcloud-talk-backend'], origin + '/');
        const body = JSON.parse(raw.toString());
        const rawContent = body.object?.content;
        let parsedContent;
        try { parsedContent = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent; } catch { parsedContent = undefined; }
        const content = parsedContent && typeof parsedContent === 'object' && !Array.isArray(parsedContent)
          ? parsedContent
          : {message: typeof parsedContent === 'string' ? parsedContent : typeof rawContent === 'string' ? rawContent : '', parameters: {}};
        const callback = {receivedAt: Date.now(), actor: body.actor?.id, objectId: body.object?.id, type: body.type, signed: true, rawSha256: sha(raw), hasFile: Object.values(content.parameters ?? {}).some(item => item?.type === 'file'), hasInboundMarker: content.message?.includes(inboundMarker) === true, hasApiActorMarker: content.message?.includes(actorMarker) === true};
        callbacks.push(callback);
        // Preserve the exact signed bytes and account-selection headers.
        const response = await fetch(`http://127.0.0.1:${gatewayPort}${req.url}`, {method: 'POST', body: raw, headers: {'content-type': 'application/json', 'x-nextcloud-talk-random': random, 'x-nextcloud-talk-signature': supplied, 'x-nextcloud-talk-backend': req.headers['x-nextcloud-talk-backend']}, signal: AbortSignal.timeout(4500)});
        callback.gatewayStatus = response.status;
        callback.accepted = response.headers.get('x-openclaw-delivery-accepted');
        const responseBody = Buffer.from(await response.arrayBuffer());
        res.writeHead(response.status, {'content-type': response.headers.get('content-type') ?? 'text/plain', ...(callback.accepted ? {'x-openclaw-delivery-accepted': callback.accepted} : {})});
        res.end(responseBody);
      } catch (error) {
        errors.push(`callback: ${String(error)}`);
        res.writeHead(502); res.end('synthetic callback relay failed');
      }
    });
    const relayPort = await listen(relay, '0.0.0.0');
    const callbackUrl = `http://host.docker.internal:${relayPort}/nextcloud-talk-webhook`;
    applyMockOpenAiModelConfig(cfg, {mockPort: modelPort, modelRef: `openai/${mainModel}`, utilityModelRef: `openai/${utilityModel}`});
    // This lane proves channel delivery, not memory indexing. Utility inference
    // has its own explicit model identity, never a byte-length/order heuristic.
    cfg.memory = {...cfg.memory, search: {...cfg.memory?.search, enabled: false}};
    for (const agent of Object.values(cfg.agents.entries ?? {})) {
      agent.memory = {...agent.memory, search: {...agent.memory?.search, enabled: false}};
    }
    cfg.plugins = {...cfg.plugins, allow: [...new Set([...(cfg.plugins?.allow ?? []), 'nextcloud-talk', 'openai'])], entries: {...cfg.plugins?.entries, openai: {...cfg.plugins?.entries?.openai, enabled: true}}};
    cfg.gateway = {...cfg.gateway, mode: 'local', bind: 'loopback', port: gatewayPort, auth: {mode: 'token', token: 'disposable-automatic-proof-gateway-token'}, controlUi: {enabled: false}};
    cfg.logging = {...cfg.logging, level: 'debug', consoleLevel: 'debug', file: path.join(evidence, 'automatic-core.jsonl')};
    cfg.session = {...cfg.session, dmScope: 'per-channel-peer'};
    const senderIds = [user, recipient].map(uid => `users/${uid}`);
    cfg.channels['nextcloud-talk'] = {...cfg.channels['nextcloud-talk'], botSecretFile: secretPath, webhookPublicUrl: callbackUrl, legacyWebhook: false, dmPolicy: 'allowlist', allowFrom: senderIds, groupAllowFrom: senderIds, groupPolicy: 'allowlist', rooms: {[roomToken]: {requireMention: false}}};
    await fs.writeFile(secretPath, botSecret, {mode: 0o600});
    await fs.writeFile(configPath, JSON.stringify(cfg));
    const gatewayEnv = {...env, OPENAI_API_KEY: 'synthetic-no-real-provider-key', OPENCLAW_GATEWAY_TOKEN: cfg.gateway.auth.token};
    // Supply the synthetic env SecretRef even if config validation begins
    // resolving provider credentials in a future candidate.
    await command(process.execPath, [entry, 'config', 'validate'], 'automatic-config-validate', gatewayEnv);
    const providerInspection = JSON.parse(await command(process.execPath, [entry, 'plugins', 'inspect', 'openai', '--runtime', '--json'], 'automatic-provider-inspect', gatewayEnv));
    const providerPlugin = providerInspection.plugin ?? providerInspection;
    assert.equal(providerPlugin.status, 'loaded', 'paired package must load its bundled OpenAI provider for the local synthetic model');
    assert.equal(await fs.realpath(providerPlugin.rootDir), await fs.realpath(path.join(path.dirname(entry), 'dist/extensions/openai')), 'synthetic model must not use an external/ambient provider install');
    const occ = (args, label) => command('docker', ['exec', '--user', 'www-data', 'nextcloud-outbound-proof', 'php', 'occ', ...args], label, env);
    // BotService::sendAsyncRequest explicitly permits local callbacks. Set the
    // canonical backend header to the same published origin the plugin trusts.
    await occ(['config:system:set', 'overwrite.cli.url', '--value=' + origin], 'automatic-backend-origin');
    await occ(['config:system:set', 'allow_local_remote_servers', '--type=boolean', '--value=true'], 'automatic-local-callback-policy');
    const installed = await occ(['talk:bot:install', 'Disposable automatic attachment proof', botSecret, callbackUrl, '--feature', 'webhook', '--feature', 'response'], 'automatic-bot-install');
    const botId = installed.match(/^ID:\s*(\d+)\s*$/m)?.[1];
    assert(botId, 'official occ bot install did not return an ID');
    gatewayLog = createWriteStream(path.join(evidence, 'automatic-gateway.log'));
    gateway = spawn(process.execPath, [entry, 'gateway', 'run', '--port', String(gatewayPort), '--bind', 'loopback'], {env: gatewayEnv, stdio: ['ignore', 'pipe', 'pipe']});
    gateway.stdout.pipe(gatewayLog, {end: false});
    gateway.stderr.pipe(gatewayLog, {end: false});
    gateway.once('error', error => errors.push(`gateway: ${String(error)}`));
    await eventually('owned installed Gateway readiness', async () => {
      assert.equal(gateway.exitCode, null, 'owned Gateway exited during startup');
      assert.equal(errors.length, 0, errors.join('\n'));
      try { return (await fetch(`http://127.0.0.1:${gatewayPort}/readyz`, {signal: AbortSignal.timeout(2000)})).ok; } catch { return false; }
    });
    await ocs(user, `/apps/spreed/api/v1/bot/${roomToken}/${botId}`, {});
    const priorIds = new Set((await history(recipient, roomToken)).map(message => String(message.id)));
    const triggerLogOffset=(await fs.stat(path.join(evidence,'automatic-gateway.log'))).size;
    const triggerStartedAt = Date.now();
    const posted = await ocs(recipient, `/apps/spreed/api/v1/chat/${roomToken}`, {message: inboundMarker});
    const fileMessage = await eventually('automatic native file share', async () => (await history(recipient, roomToken)).find(message => !priorIds.has(String(message.id)) && message.actorId === user && message.messageParameters?.file && JSON.stringify(message).includes(caption)));
    assert.equal(inference.length, 1, 'unexpected additional model turn before native share');
    assert(!JSON.stringify(fileMessage).includes('MEDIA:'), 'MEDIA directive leaked into native caption');
    assert(!JSON.stringify(fileMessage).includes(mediaPath), 'local media path leaked into chat');
    const encodedPath = fileMessage.messageParameters.file.path.split('/').map(encodeURIComponent).join('/');
    const download = await fetch(`${origin}/remote.php/dav/files/${recipient}/${encodedPath}`, {headers: {Authorization: `Basic ${Buffer.from(`${recipient}:${password}`).toString('base64')}`}, redirect: 'error', signal: AbortSignal.timeout(30_000)});
    assert(download.ok, `automatic recipient download: ${download.status}`);
    assert.equal(sha(Buffer.from(await download.arrayBuffer())), sha(expectedBytes));
    const automaticShares=await ocs(user,'/apps/files_sharing/api/v1/shares?path='+encodeURIComponent('/'+fileMessage.messageParameters.file.path));
    assert(automaticShares.some(share=>Number(share.share_type)===10 && share.share_with===roomToken && Number(share.permissions)===1),'automatic file share is not read-only in the exact room');
    const ownEcho = await eventually('real API-account native-file webhook accepted by Gateway', () => callbacks.find(item => item.actor === `users/${user}` && item.hasFile && String(item.objectId) === String(fileMessage.id) && item.type === 'Activity' && item.gatewayStatus === 200 && item.accepted === null));
    const echoWindowStart = Date.now();
    // Bounded observation, not a claim that no future delayed event can exist.
    while (Date.now() - echoWindowStart < 15_000) {
      assert.equal(inference.length, 1, 'own native-file echo created a second model turn');
      assert.equal(errors.length, 0, errors.join('\n'));
      await delay(250);
    }
    const echoObservationMs = Date.now() - echoWindowStart;
    const completedTurn = async (chatId, label, startedAt, logOffset) => {
      const id = String(chatId);
      assert.match(id, /^\d+$/);
      const outcome = await eventually(label, async () => {
        const logBytes=await fs.readFile(path.join(evidence,'automatic-gateway.log'));
        // The byte checkpoint was captured before this exact real Nextcloud
        // trigger. Never borrow a diagnostic from a previous turn/session.
        const log=logBytes.subarray(logOffset).toString();
        const pattern=new RegExp(`message processed: channel=nextcloud-talk chatId=([^ ]+) messageId=${id}\\b sessionId=([^ ]+) sessionKey=([^ ]+) outcome=(\\w+)`,'g');
        const matches=[...log.matchAll(pattern)];
        const unique=new Map(matches.map(match=>[match[0],match]));
        assert(unique.size<=1,`conflicting terminal diagnostics for real chat ID ${id}`);
        const match=[...unique.values()][0];
        return match ? {chatId:id,outcome:match[4],diagnostic:match[0],diagnosticSessionId:match[2],sessionKey:match[3]} : undefined;
      });
      assert.equal(outcome.outcome,'completed',`trigger ${id} did not complete cleanly: ${outcome.diagnostic}`);
      assert(outcome.sessionKey.includes(`nextcloud-talk:group:${roomToken}`),'terminal diagnostic points outside the exact fixture room');
      let ordinal=0;
      const described=await eventually(`${label}: same session done/inactive`,async()=>{
        const result=JSON.parse(await command(process.execPath,[entry,'gateway','call','sessions.describe','--params',JSON.stringify({key:outcome.sessionKey}),'--json'],`automatic-session-${id}-${++ordinal}`,gatewayEnv));
        assert(result.session,'10.3 sessions.describe did not expose a session');
        if(result.session.lastRunError) throw new Error(`session error after trigger ${id}: ${result.session.lastRunError}`);
        return result.session.status==='done' && result.session.hasActiveRun===false ? result : undefined;
      });
      outcome.session=described.session;
      outcome.triggerStartedAt=startedAt;
      outcome.causalFreshness={exactRealChatId:id,postTriggerLogByteOffset:logOffset,diagnosticSessionKey:outcome.sessionKey};
      if(Object.hasOwn(outcome.session,'endedAt')) {
        assert.equal(typeof outcome.session.endedAt,'number','unexpected 10.3 endedAt projection');
        assert(outcome.session.endedAt>=startedAt,'session endedAt predates this exact trigger');
        outcome.endedAtEvidence='numeric completion timestamp exposed and checked';
      } else {
        outcome.endedAtEvidence='NOT EXPOSED by this 10.3 projection; freshness is the exact real chat-ID diagnostic after its pre-trigger log checkpoint plus same-session done/inactive RPC';
      }
      terminal.push(outcome);
      return outcome;
    };
    await completedTurn(posted.id,'triggering automatic turn terminal outcome',triggerStartedAt,triggerLogOffset);
    // The API actor is deliberately authorized. Stock 10.3 ignores Activity
    // events, not selectively just owned files; ordinary Create/text from
    // this same allowed API user must still dispatch a real second turn.
    const actorLogOffset=(await fs.stat(path.join(evidence,'automatic-gateway.log'))).size;
    const actorStartedAt = Date.now();
    const actorPosted = await ocs(user, `/apps/spreed/api/v1/chat/${roomToken}`, {message: actorMarker});
    const ordinaryReply = await eventually('API-account ordinary text automatic reply', async () => (await history(recipient, roomToken)).find(message => JSON.stringify(message).includes(actorAnswer)));
    assert.equal(inference.length, 2);
    assert(inference[1].sawApiActorMarker);
    assert(callbacks.some(item => item.actor === `users/${recipient}` && String(item.objectId)===String(posted.id) && item.type==='Create' && item.hasInboundMarker && item.gatewayStatus === 200 && item.accepted === 'durable'));
    assert(callbacks.some(item => item.actor === `users/${user}` && String(item.objectId)===String(actorPosted.id) && item.type==='Create' && item.hasApiActorMarker && item.gatewayStatus === 200 && item.accepted === 'durable'));
    await completedTurn(actorPosted.id,'API-account ordinary turn terminal outcome',actorStartedAt,actorLogOffset);
    assert.equal(inference.length,2,'unexpected main-model turn after the ordinary control completed');
    assert.equal(errors.length, 0, errors.join('\n'));
    assert(terminal.every(turn => turn.outcome === 'completed'), `automatic turn did not complete cleanly: ${JSON.stringify(terminal)}`);
    assert(terminal.every(turn => turn.session?.status === 'done' && turn.session.hasActiveRun === false && !turn.session.lastRunError), `automatic session did not finish successfully: ${JSON.stringify(terminal)}`);
    const finalHistory=await history(recipient,roomToken);
    assert(!finalHistory.some(message=>!priorIds.has(String(message.id)) && /No answer|No response generated/i.test(JSON.stringify(message))),'false no-answer fallback reached the room');
    result = {status: 'PASS',coreVersion:'2026.10.3',coreCommit:'59cb44796b0f1f0daa0e37af8b1495abb45d9bc1',falseNoAnswerRoomMessage:false, scope: 'Disposable official Nextcloud 35/Talk 25; official core59 installed Gateway + managed dist-only Talk automatic reply via real signed bot webhook and synthetic Responses model. No production server, deployment, UI or real-model proof.', nativeChatId: String(fileMessage.id), triggeringChatId: String(posted.id), ordinaryControlReplyId: String(ordinaryReply.id), recipientByteEquality: true, mediaSha256: sha(expectedBytes), captionAccepted: true, ownFileEcho: {objectId: String(ownEcho.objectId), gatewayStatus:200, durableAccepted:false,stockActivityIgnored:true,authorizedApiActor:true, observationMs: echoObservationMs, modelRequestsBeforeAndAfterWindow: [1, 1]}, apiActorOrdinaryTextAccepted: true, inference, utility, terminal, memorySearchDisabled: true, callbacks};
  } catch (error) {
    failure = error;
  } finally {
    try {
      await fs.writeFile(path.join(evidence, 'automatic-chat-history.json'), JSON.stringify(await history(recipient, roomToken), null, 2));
    } catch (error) {
      if (!failure) failure = error;
    }
    await stopProcess(gateway);
    if (gatewayLog) await new Promise(resolve => gatewayLog.end(resolve));
    if (relay) await closeServer(relay);
    if (mock) await closeServer(mock);
    await fs.writeFile(configPath, beforeConfig);
    await fs.writeFile(secretPath, beforeSecret, {mode: 0o600});
    await fs.writeFile(path.join(evidence, 'automatic-reply.json'), JSON.stringify(failure ? {status: 'FAIL', error: String(failure), errors, inference, utility, terminal, callbacks, ownedProcessesClosed: true} : {...result, ownedProcessesClosed: true, isolatedConfigRestored: true}, null, 2));
  }
  if (failure) throw failure;
  return result;
}
