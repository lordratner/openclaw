// Fork-only assertions on exported public CLI JSON and isolated fixture logs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const [command, ...args] = process.argv.slice(2);
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canon = (value) => Array.isArray(value) ? value.map(canon) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon(value[key])])) : value;
const channel = (value) => value.channels?.['nextcloud-talk'] ?? value;
const visit = (value, fn) => { if (!value || typeof value !== 'object') return; fn(value); for (const child of Object.values(value)) visit(child, fn); };
if (command === 'checkpoint') {
  const [cloudLog, modelLog, output] = args;
  fs.writeFileSync(output, JSON.stringify({ cloudRows: rows(cloudLog).length, modelRows: rows(modelLog).length }) + '\n', { flag: 'wx', mode: 0o600 });
} else if (command === 'config-survived') {
  const [beforeFile, afterFile] = args;
  const before = channel(json(beforeFile)); const after = channel(json(afterFile));
  assert(!Object.hasOwn(before, 'mediaAllowFrom'), 'baseline must omit new media setting');
  assert(!Object.hasOwn(after, 'mediaAllowFrom'), 'upgrade must not silently opt into media');
  assert.deepEqual(canon(after), canon(before), 'authored Talk settings changed during upgrade');
  console.log(JSON.stringify({ assertion: command, status: 'PASS', baselineSha256: sha(canon(before)), upgradedSha256: sha(canon(after)) }));
} else if (command === 'session-survived') {
  const [beforeFile, afterFile, key] = args;
  const find = (value) => { const found = []; visit(value, (node) => { if (node.key === key || node.sessionKey === key) found.push(node); }); assert.equal(found.length, 1, `expected exactly one public session row for ${key}`); return found[0]; };
  const before = find(json(beforeFile)); const after = find(json(afterFile));
  assert.equal(typeof before.sessionId, 'string'); assert(before.sessionId.length > 0);
  assert.equal(after.sessionId, before.sessionId, 'stable-created session identity lost');
  console.log(JSON.stringify({ assertion: command, status: 'PASS', sessionKey: key, sessionIdPreserved: true }));
} else if (command === 'delivery') {
  const [mode, checkpointFile, cloudLog, modelLog, caption] = args;
  assert(['text', 'denied-image', 'allowed-image'].includes(mode));
  const checkpoint = json(checkpointFile);
  const cloud = rows(cloudLog).slice(checkpoint.cloudRows);
  const model = rows(modelLog).slice(checkpoint.modelRows);
  assert(!model.some((row) => row.contentFactsTruncated === true), 'provider content facts truncated; cannot prove image absence or completeness');
  assert(model.some((row) => JSON.stringify(row.body).includes(caption)), 'unique current caption did not reach provider');
  assert(cloud.some((row) => row.kind === 'bot-reply'), 'no genuine outbound Talk response after checkpoint');
  const imageFacts = model.flatMap((row) => row.contentFacts ?? []).filter((fact) => ['input_image', 'image_url', 'image'].includes(fact.type));
  const downloads = cloud.filter((row) => row.kind === 'media-download');
  if (mode === 'allowed-image') {
    assert.equal(downloads.length, 1, 'expect exactly one authenticated fixture image download');
    assert(imageFacts.some((fact) => fact.mimeType === 'image/png' && fact.byteLength === downloads[0].size), 'actual provider PNG content fact missing or incorrect byte size');
  } else {
    assert.equal(downloads.length, 0, 'closed media policy unexpectedly downloaded image');
    assert.equal(imageFacts.length, 0, 'unexpected image content reached provider');
  }
  assert(!cloud.some((row) => ['fixture-error', 'unexpected-route'].includes(row.kind)), 'unhandled fixture route/error');
  console.log(JSON.stringify({ assertion: command, mode, status: 'PASS', modelRequests: model.length, mediaDownloads: downloads.length, providerImages: imageFacts.length }));
} else {
  throw Error('commands: checkpoint CLOUD_LOG MODEL_LOG OUTPUT | config-survived BEFORE AFTER | session-survived BEFORE AFTER KEY | delivery text|denied-image|allowed-image CHECKPOINT CLOUD_LOG MODEL_LOG CAPTION');
}
// No aggregate PASS is emitted. These assertions do not substitute package/trust/source checks.
