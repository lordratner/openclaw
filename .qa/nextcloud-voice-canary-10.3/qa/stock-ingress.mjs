// Source-owner control, not an installed Gateway/webhook claim.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
const {inspectNextcloudTalkWebhookEnvelope} = await import(pathToFileURL(path.resolve('extensions/nextcloud-talk/src/webhook-spool-state.ts')).href);
const event = {
  type: 'Activity',
  actor: {type: 'Person', id: 'users/disposable-api-user', name: 'Fixture API'},
  object: {type: 'Note', id: '42', name: 'file_shared', mediaType: 'text/markdown', content: JSON.stringify({message: '{file}', parameters: {file: {type: 'file', id: '81', name: 'openclaw-00000000-0000-4000-8000-000000000000-report.pdf'}}})},
  target: {type: 'Collection', id: 'fixture-room', name: 'Fixture'},
};
assert.equal(inspectNextcloudTalkWebhookEnvelope(JSON.stringify(event)), null);
assert.equal(inspectNextcloudTalkWebhookEnvelope(JSON.stringify({...event, type: 'Update'})), null);
assert.deepEqual(inspectNextcloudTalkWebhookEnvelope(JSON.stringify({...event, type: 'Create', object: {...event.object, name: 'message', content: 'Ordinary API-user text'}})), {eventId: '42', laneKey: 'room:fixture-room'});
await fs.writeFile(path.join(process.env.CANARY_PROOF_DIR, 'stock-ingress.json'), JSON.stringify({status: 'PASS', scope: 'Exact unchanged release admission owner, not installed Gateway or sender authorization proof', fileActivityIgnored: true, updateIgnored: true, ordinaryApiActorCreateAdmissible: true}, null, 2));
