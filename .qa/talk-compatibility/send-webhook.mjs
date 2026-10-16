// Actual signed HTTP webhook. Payload matches monitor.test-fixtures.ts Activity/Create contracts.
import fs from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
const [kind, id, caption] = process.argv.slice(2);
if (!['text', 'image'].includes(kind) || !/^\d+$/.test(id ?? '') || !caption) throw Error('usage: send-webhook.mjs text|image NUMERIC_ID UNIQUE_CAPTION');
const backend = process.env.QA_NEXTCLOUD_ORIGIN;
const webhook = process.env.QA_WEBHOOK_URL;
for (const value of [backend, webhook]) { const u = new URL(value); if (u.hostname !== '127.0.0.1' || u.protocol !== 'http:') throw Error('loopback HTTP only'); }
const request = async (url, options) => { const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) }); const text = await response.text(); if (!response.ok) throw Error(`${response.status}: ${text}`); return { response, text }; };
const payload = { type: 'Create', actor: { type: 'Person', id: 'users/alice', name: 'Synthetic Alice' }, object: { type: 'Note', id, name: caption, content: caption, mediaType: 'text/plain' }, target: { type: 'Collection', id: 'qa-compat-room', name: 'Synthetic compatibility room' } };
if (kind === 'image') {
  const { text } = await request(`${backend}/__qa/fixture`);
  const { file } = JSON.parse(text).ocs.data;
  file.link = `${backend}/s/qa-fixture-share`;
  payload.type = 'Activity';
  payload.object.name = 'message';
  payload.object.mediaType = 'text/markdown';
  payload.object.content = JSON.stringify({ message: caption, parameters: { actor: { type: 'user', id: 'alice', name: 'Synthetic Alice' }, file } });
  await request(`${backend}/__qa/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, token: 'qa-compat-room', actorType: 'users', actorId: 'alice', messageType: 'comment', messageParameters: { file } }) });
}
const body = JSON.stringify(payload);
const random = randomBytes(32).toString('hex');
const signature = createHmac('sha256', 'nextcloud-compat-fixture-only').update(random + body).digest('hex');
const { response, text } = await request(webhook, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-nextcloud-talk-random': random, 'x-nextcloud-talk-signature': signature, 'x-nextcloud-talk-backend': backend } });
const receipt = { kind, id, caption, status: response.status, durableAdmission: response.headers.get('x-openclaw-delivery-accepted') === 'durable', response: text };
if (process.env.QA_WEBHOOK_RECEIPT) fs.writeFileSync(process.env.QA_WEBHOOK_RECEIPT, JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(receipt));
// Admission is not delivery. Provider/outbound assertions are deliberately separate.
