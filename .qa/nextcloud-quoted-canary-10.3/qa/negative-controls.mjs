// Strict assertion-bound negative proof; handles Vitest's clipped actual strings.
import assert from 'node:assert/strict';

export function assertNegativeControls(result, kind, count) {
  assert.equal(result.success, false);
  assert.equal(result.numPassedTests, 0);
  assert.equal(result.testResults.length, 1);
  const failed = result.testResults.flatMap(suite => suite.assertionResults).filter(test => test.status === 'failed');
  assert.equal(result.numFailedTests, count);
  assert.equal(failed.length, count);
  const recoveryStatuses = [];
  let links = 0;
  for (const test of failed) {
    const title = test.fullName;
    const message = test.failureMessages.join(' ');
    if (kind === 'original-direct' || kind === 'original-auto') {
      assert(title.includes(kind === 'original-direct' ? 'delivers a real file share' : 'uploads an automatic'));
      assert(message.includes('expected undefined to deeply equal Buffer'));
    } else if (kind === 'review-auto') {
      assert(title.includes('preserves a bot-only automatic'));
      assert(message.includes('apiUser') && message.includes('apiPassword'));
    } else if (kind === 'review-direct') {
      if (title.includes('preserves bot-only web attachment links')) {
        links++;
        assert(message.includes('apiUser') && message.includes('apiPassword'));
      } else {
        assert(title.includes('explains recovery without sharing'));
        const status = Number(title.match(/\((401|507|403|500)\)$/)?.[1]);
        const expected = {401: 'apiUser', 507: 'Files storage', 403: 'Nextcloud server logs', 500: 'Nextcloud server logs'}[status];
        assert(expected);
        recoveryStatuses.push(status);
        assert(message.includes('attachment upload fail') && message.includes('to match /' + expected));
      }
    } else throw new Error('unknown negative proof kind');
  }
  if (kind === 'review-direct') {
    assert.equal(links, 2);
    assert.deepEqual(recoveryStatuses.sort((a, b) => a - b), [401, 403, 500, 507]);
  }
}
