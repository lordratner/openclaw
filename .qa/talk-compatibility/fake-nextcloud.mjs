// Fork-only loopback fixture. No source imports, real accounts, or production writes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
const root = path.resolve(process.env.QA_ARTIFACT_DIR ?? '');
if (!process.env.QA_ARTIFACT_DIR || !root.includes('/nextcloud-compat-')) throw Error('isolated nextcloud-compat-* artifact root required');
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=', 'base64');
const events = new Map();
const secret = 'nextcloud-compat-fixture-only';
if (process.env.QA_WEBHOOK_URL) { const u = new URL(process.env.QA_WEBHOOK_URL); if (u.hostname !== '127.0.0.1' || u.protocol !== 'http:') throw Error('synthetic bot callback must be loopback HTTP'); }
const auth = `Basic ${Buffer.from('qa-bot:qa-password-fixture-only').toString('base64')}`;
let seq = 0;
const record = (v) => fs.appendFileSync(path.join(root, 'nextcloud.jsonl'), `${JSON.stringify({ seq: ++seq, ...v })}\n`, { mode: 0o600 });
const ocs = (res, data, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ocs: { meta: { status: 'ok', statuscode: 100 }, data } }));
};
const read = async (req) => { const chunks = []; let size = 0; for await (const c of req) { size += c.length; if (size > 65536) throw Error('fixture request bound exceeded'); chunks.push(c); } return Buffer.concat(chunks).toString('utf8'); };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = url.pathname;
    if (route === '/__qa/fixture' && req.method === 'GET') return ocs(res, { file: { id: '9001', name: 'compat.png', path: 'Talk/compat.png', mimetype: 'image/png', size: String(png.length), type: 'file', 'hide-download': 'no' }, pngSha256: createHash('sha256').update(png).digest('hex') });
    if (route === '/__qa/events' && req.method === 'POST') {
      const event = JSON.parse(await read(req));
      if (!/^\d+$/.test(String(event.id)) || event.token !== 'qa-compat-room' || event.actorId !== 'alice') throw Error('invalid synthetic history record');
      events.set(String(event.id), event); return ocs(res, { registered: event.id });
    }
    record({ method: req.method, path: route, query: url.search });
    const messageRoute = route === '/ocs/v2.php/apps/spreed/api/v1/bot/qa-compat-room/message';
    const reactionRoute = /^\/ocs\/v2\.php\/apps\/spreed\/api\/v1\/bot\/qa-compat-room\/reaction\/\d+$/.test(route);
    if ((messageRoute || reactionRoute) && req.method === 'POST') {
      const body = JSON.parse(await read(req));
      const signedValue = messageRoute ? body.message : body.reaction;
      if (typeof signedValue !== 'string' || !signedValue) return ocs(res, {}, 400);
      const expected = createHmac('sha256', secret).update(`${req.headers['x-nextcloud-talk-bot-random'] ?? ''}${signedValue}`).digest('hex');
      const actual = String(req.headers['x-nextcloud-talk-bot-signature'] ?? '');
      if (expected.length !== actual.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) return ocs(res, {}, 401);
      record(messageRoute ? { kind: 'bot-reply', message: body.message } : { kind: 'bot-reaction', messageId: route.split('/').at(-1), reaction: body.reaction });
      return ocs(res, { id: 800000 + seq, timestamp: Math.floor(Date.now() / 1000) });
    }
    if (req.headers.authorization !== auth) return ocs(res, {}, 401);
    if (route === '/ocs/v1.php/cloud/user' && req.method === 'GET') return ocs(res, { id: 'qa-bot' });
    if (route === '/ocs/v2.php/apps/spreed/api/v4/room/qa-compat-room' && req.method === 'GET') return ocs(res, { type: 1, token: 'qa-compat-room' });
    if (route === '/ocs/v2.php/apps/spreed/api/v1/bot/admin' && req.method === 'GET') return ocs(res, [{ id: 7, name: 'QA', url: process.env.QA_WEBHOOK_URL, features: 1 | 2 | 8 }]);
    if (route === '/ocs/v2.php/apps/spreed/api/v1/chat/qa-compat-room' && req.method === 'GET') {
      const item = events.get(url.searchParams.get('lastKnownMessageId')); return ocs(res, item ? [item] : []);
    }
    if (route === '/remote.php/dav/files/qa-bot/Talk/compat.png') {
      if (req.method === 'PROPFIND') { res.writeHead(207, { 'content-type': 'application/xml' }); return res.end('<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:response><d:propstat><d:prop><oc:fileid>9001</oc:fileid></d:prop></d:propstat></d:response></d:multistatus>'); }
      if (req.method === 'GET') { record({ kind: 'media-download', sha256: createHash('sha256').update(png).digest('hex'), size: png.length }); res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length }); return res.end(png); }
    }
    record({ kind: 'unexpected-route', method: req.method, path: route }); ocs(res, {}, 404);
  } catch (e) { record({ kind: 'fixture-error', error: String(e) }); ocs(res, {}, 500); }
});
server.listen(Number(process.env.QA_NEXTCLOUD_PORT ?? 0), '127.0.0.1', () => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(root, 'nextcloud-ready.json'), `${JSON.stringify({ origin, pid: process.pid, pngSha256: createHash('sha256').update(png).digest('hex'), pngBytes: png.length })}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`nextcloud fixture listening on ${origin}`);
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
