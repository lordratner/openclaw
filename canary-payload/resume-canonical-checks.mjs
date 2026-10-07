import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const proof = path.join(process.env.RUNNER_TEMP, 'release-canary-proof');
const payload = path.join(process.env.RUNNER_TEMP, 'canary-payload');
const ledger = JSON.parse(readFileSync(path.join(payload, 'CI7-GATE-LEDGER.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(path.join(payload, 'release-canary-source-manifest.json'), 'utf8'));
const { detectChangedLanesForPaths } = await import(pathToFileURL(path.join(root, 'scripts/changed-lanes.mts')).href);
const { createChangedCheckPlan, createPnpmManagedCommand } = await import(pathToFileURL(path.join(root, 'scripts/check-changed.mts')).href);
assert(!Object.keys(process.env).some(k => k.startsWith('OPENCLAW_CHECK_CHANGED_SKIP_')));
const paths = [...manifest.files.map(x => x.path), 'docs/.generated/config-baseline.sha256', 'docs/.generated/config-baseline.counts.json'];
const result = detectChangedLanesForPaths({ paths, base: manifest.release_commit, head: manifest.release_commit, staged: false });
const plan = createChangedCheckPlan(result, { explicitPaths: true });
assert.equal(plan.commands.length, 41);
assert.deepEqual(plan.commands.slice(0, 39).map(c => c.name), ledger.completedCheckNames);
const tail = plan.commands.slice(39);
assert.deepEqual(tail.map(c => c.name), ledger.remainingCanonicalChecks);
if (process.argv[2] === '--reuse-passed-tail') {
  const previous = JSON.parse(readFileSync(path.join(process.env.RUNNER_TEMP, 'prior-ci8/resumed-canonical-checks.json'), 'utf8'));
  assert.equal(previous.status, 'PASS');
  assert.equal(previous.sourceManifestSha256, ledger.sourceManifestSha256);
  assert.equal(previous.priorRun, ledger.run);
  assert.equal(previous.totalChecks, 41);
  assert.equal(previous.canonicalPlanMatchedEntirePriorPrefixAndRemainingTail, true);
  assert.equal(previous.singleWholeChangedCheckInvocationPassed, false);
  assert.deepEqual(previous.records.map(r=>r.name), tail.map(c=>c.name));
  for (let i=0;i<tail.length;i++) {
    const managed=tail[i].bin ? tail[i] : createPnpmManagedCommand(tail[i]);
    const r=previous.records[i];
    assert.equal(r.exitCode, 0); assert.equal(r.signal, null);
    assert.equal(r.bin, managed.bin); assert.deepEqual(r.args, managed.args);
  }
  writeFileSync(path.join(proof,'resumed-canonical-checks.json'),JSON.stringify({...previous,
    passedTailReusedFromRun:37557414361, repeatedGuardExecution:false},null,2)+'\n');
  console.log('All41 exact-source canonical checks verified from CI7+CI8; no guards rerun.');
  process.exit(0);
}
const records = [];
for (const command of tail) {
  const managed = command.bin ? command : createPnpmManagedCommand(command);
  console.log('[check:changed:continued] ' + command.name);
  const start = Date.now();
  const r = spawnSync(managed.bin, managed.args, { env: managed.env ?? process.env,
    stdio: 'inherit', timeout: 600_000 });
  records.push({ name: command.name, bin: managed.bin, args: managed.args,
    exitCode: r.status, signal: r.signal, durationMs: Date.now() - start });
  writeFileSync(path.join(proof, 'resumed-canonical-checks.json'), JSON.stringify({
    status: r.status === 0 ? 'IN_PROGRESS' : 'FAIL', inheritedChecks: 39, records,
    sourceManifestSha256: ledger.sourceManifestSha256, priorRun: ledger.run,
  }, null, 2) + '\n');
  assert.equal(r.error, undefined);
  assert.equal(r.status, 0, command.name);
}
writeFileSync(path.join(proof, 'resumed-canonical-checks.json'), JSON.stringify({
  status: 'PASS', inheritedChecks: 39, resumedChecks: 2, totalChecks: 41, records,
  sourceManifestSha256: ledger.sourceManifestSha256, priorRun: ledger.run,
  canonicalPlanMatchedEntirePriorPrefixAndRemainingTail: true,
  singleWholeChangedCheckInvocationPassed: false,
}, null, 2) + '\n');
