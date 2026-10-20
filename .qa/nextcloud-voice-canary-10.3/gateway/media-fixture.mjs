// External DAV/OCS protocol fixture only; never imports plugin implementation.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const sha = value => createHash('sha256').update(value).digest('hex');
export function createMediaFixture({room, apiUser, apiPassword}) {
  const authorization = `Basic ${Buffer.from(`${apiUser}:${apiPassword}`).toString('base64')}`;
  const files = new Map(), messages = [], cases = [];
  let expected;
  const ocs = (res, data) => {
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({ocs: {meta: {status: 'ok', statuscode: 100}, data}}));
  };
  return {
    cases,
    begin(value) {assert.equal(expected, undefined); expected = {...value, uploads: 0, shares: 0};},
    finish() {
      assert(expected); assert.equal(expected.uploads, 1); assert.equal(expected.shares, 1);
      const result = cases.at(-1); assert.equal(result.label, expected.label);
      expected = undefined; return result;
    },
    async handle(req, res, body) {
      const url = new URL(req.url, 'http://fixture.invalid');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('/bot/')) return false;
      assert.equal(req.headers.authorization, authorization, 'API authentication must use the configured disposable account');
      if (req.method === 'GET' && pathname === '/ocs/v1.php/cloud/user') {
        ocs(res, {id: apiUser}); return true;
      }
      if (req.method === 'GET' && pathname === `/ocs/v2.php/apps/spreed/api/v4/room/${room}`) {
        ocs(res, {token: room, type: 2, displayName: 'Disposable composed canary proof'}); return true;
      }
      if (req.method === 'MKCOL' && pathname === `/remote.php/dav/files/${apiUser}/OpenClaw`) {
        res.writeHead(201); res.end(); return true;
      }
      const davPrefix = `/remote.php/dav/files/${apiUser}`;
      if (req.method === 'PUT' && pathname.startsWith(davPrefix + '/OpenClaw/')) {
        assert(expected, 'unexpected upload'); assert.equal(req.headers['if-none-match'], '*');
        assert(!files.has(pathname), 'upload must not overwrite');
        assert.deepEqual(body, expected.bytes, 'uploaded bytes must match the audio source');
        const file = {id: String(80 + files.size), path: pathname.slice(davPrefix.length), bytes: body, contentType: req.headers['content-type']};
        files.set(pathname, file); expected.uploads++;
        res.writeHead(201, {'oc-fileid': file.id}); res.end(); return true;
      }
      if (req.method === 'PROPFIND' && files.has(pathname)) {
        const file = files.get(pathname);
        res.writeHead(207, {'content-type': 'application/xml'});
        res.end(`<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:response><d:propstat><d:prop><oc:fileid>${file.id}</oc:fileid></d:prop></d:propstat></d:response></d:multistatus>`);
        return true;
      }
      if (req.method === 'POST' && pathname === '/ocs/v2.php/apps/files_sharing/api/v1/shares') {
        assert(expected, 'unexpected native share');
        const share = new URLSearchParams(body.toString()), metadata = JSON.parse(share.get('talkMetaData'));
        assert.equal(share.get('shareType'), '10'); assert.equal(share.get('shareWith'), room); assert.equal(share.get('permissions'), '1');
        assert.equal(metadata.caption, expected.caption);
        assert.equal(metadata.messageType ?? 'comment', expected.messageType);
        assert.equal(metadata.replyTo === undefined ? undefined : String(metadata.replyTo), expected.replyTo);
        const file = [...files.values()].find(item => item.path === share.get('path'));
        assert(file); assert.match(share.get('referenceId'), /^[a-f0-9]{64}$/u);
        const nativeChatId = String(1001 + messages.length);
        messages.push({id: Number(nativeChatId), token: room, actorType: 'users', actorId: apiUser,
          referenceId: share.get('referenceId'), messageType: metadata.messageType ?? 'comment',
          message: metadata.caption, ...(metadata.replyTo ? {parent: {id: metadata.replyTo}} : {}),
          messageParameters: {file: {id: file.id, path: file.path.slice(1), mimetype: file.contentType}}});
        cases.push({label: expected.label, nativeChatId, messageType: metadata.messageType ?? 'comment',
          caption: metadata.caption, replyTo: expected.replyTo, uploadedByteEquality: true,
          audioSha256: sha(file.bytes), uploadedBytes: file.bytes.length, contentType: file.contentType});
        expected.shares++;
        ocs(res, {id: String(700 + messages.length), file_source: Number(file.id)}); return true;
      }
      if (req.method === 'GET' && pathname === `/ocs/v2.php/apps/spreed/api/v1/chat/${room}`) {
        ocs(res, messages); return true;
      }
      throw new Error(`Unexpected disposable media request: ${req.method} ${pathname}`);
    },
  };
}
