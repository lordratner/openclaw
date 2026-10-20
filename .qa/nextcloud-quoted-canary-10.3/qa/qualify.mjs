// GitHub-only, secretless qualification. This is not a deployment script.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertNegativeControls} from './negative-controls.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
const retained = path.resolve(process.env.CANARY_RETAINED_PROOF_DIR);
assert.equal(process.env.CANARY_RETAINED_RUN_ID, '39416877283');
const portPriorManifestSha256 = 'bdd9bca580c3344d0d949688f9db0ba7c0af37e43d36593ed672b71baf91a69d';
const release = '59cb44796b0f1f0daa0e37af8b1495abb45d9bc1';
const input = path.resolve(process.env.CANARY_INPUT_ROOT);
const qa = path.dirname(fileURLToPath(import.meta.url));
assert.equal(qa, path.join(input, 'qa'));
const proof = path.join(process.env.RUNNER_TEMP, 'nextcloud-quoted-canary-10.3');
await fs.mkdir(proof, {recursive: true});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const gates = {}, commands = [];
const env = {...process.env, CANARY_PROOF_DIR: proof, OPENCLAW_BUNDLED_PLUGIN_BUILD_IDS: 'nextcloud-talk', OPENCLAW_VITEST_MAX_WORKERS: '1', NODE_OPTIONS: '--max-old-space-size=8192'};
const immutablePaths = ['package.json', 'pnpm-lock.yaml', 'extensions/nextcloud-talk/package.json', 'extensions/nextcloud-talk/openclaw.plugin.json', 'extensions/nextcloud-talk/src/config-schema.ts'];
const immutable = new Map();
let sourceManifest, paths, parserLink, scopeOrdinal = 0, retainedReceipt;
async function command(label, executable, args, options = {}) {
  const child = spawn(executable, args, {cwd: process.cwd(), env: options.env ?? env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
  const chunks = [];
  child.stdout.on('data', value => chunks.push(value));
  child.stderr.on('data', value => chunks.push(value));
  const started = Date.now();
  let timedOut = false, hardStop;
  const stopGroup = signal => {
    try { if (child.pid) process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const timer = setTimeout(() => {
    timedOut = true;
    stopGroup('SIGTERM');
    hardStop = setTimeout(() => stopGroup('SIGKILL'), 10_000);
  }, options.timeoutMs ?? 600_000);
  const code = await new Promise((resolve, reject) => {child.once('error', reject); child.once('close', resolve);}).finally(() => {clearTimeout(timer); clearTimeout(hardStop);});
  const output = Buffer.concat(chunks).toString();
  await fs.writeFile(path.join(proof, label + '.log'), output);
  commands.push({label, code, timedOut, wallMs: Date.now() - started});
  assert.equal(timedOut, false, `${label} timed out; see its retained log`);
  if (!options.allowFailure) assert.equal(code, 0, `${label} failed; see its retained log`);
  return {code, output};
}
async function phase(name, dependencies, run) {
  if (dependencies.some(key => gates[key]?.status !== 'PASS')) {
    gates[name] = {status: 'BLOCKED', dependencies};
    return;
  }
  const started = Date.now();
  console.log(`Starting ${name}`);
  try {await run(); gates[name] = {status: 'PASS', evidence: 'fresh', wallMs: Date.now() - started};}
  catch (error) {gates[name] = {status: 'FAIL', error: String(error), wallMs: Date.now() - started};}
  console.log(`${name}: ${gates[name].status}`);
  await fs.writeFile(path.join(proof, 'gate-status.json'), JSON.stringify({gates, commands}, null, 2));
}
async function assertImmutable() {
  for (const [file, hash] of immutable) assert.equal(sha(await fs.readFile(file)), hash, `immutable release surface changed: ${file}`);
}
async function assertSource() {
  for (const [file, hash] of Object.entries(sourceManifest.files)) assert.equal(sha(await fs.readFile(file)), hash, `qualified source drift: ${file}`);
  await assertImmutable();
  const ordinal = ++scopeOrdinal;
  const tracked = (await command('tracked-scope-' + ordinal, 'git', ['diff', '--name-only'])).output.trim().split('\n').filter(Boolean);
  assert(tracked.every(file => paths.includes(file)), 'tracked changes outside the fifteen-path composed plugin port');
  const untracked = (await command('untracked-scope-' + ordinal, 'git', ['ls-files', '--others', '--exclude-standard'])).output.trim().split('\n').filter(Boolean);
  assert(untracked.every(file => paths.includes(file) || file === '.proof-tools/' || file.startsWith('.proof-tools/')), 'unexpected untracked source outside reviewed port/tools');
}
async function assertTests(label, expectedFiles, exactCounts = {}, directory = proof) {
  const result = await readJson(path.join(directory, label + '.json'));
  assert.equal(result.success, true);
  assert.equal(result.numFailedTests, 0);
  assert.equal(result.numPendingTests, 0);
  assert.equal(result.numPassedTests, Object.values(exactCounts).reduce((sum, value) => sum + value, 0));
  assert.equal(result.testResults.flatMap(suite => suite.assertionResults).length, result.numPassedTests);
  const actual = new Map(result.testResults.map(suite => [path.relative(process.cwd(), suite.name).replaceAll(path.sep, '/'), suite]));
  assert.deepEqual([...actual.keys()].sort(), [...expectedFiles].sort());
  for (const [file, suite] of actual) {
    assert(suite.assertionResults.length > 0, `zero assertions: ${file}`);
    assert(suite.assertionResults.every(test => test.status === 'passed'), `nonpassing/skipped assertions: ${file}`);
    if (exactCounts[file] !== undefined) assert.equal(suite.assertionResults.length, exactCounts[file], file);
  }
  return result;
}

const directFiles = ['extensions/nextcloud-talk/src/outbound-media.test.ts', 'extensions/nextcloud-talk/src/send.handoff.test.ts'];
const forkFiles = ['extensions/nextcloud-talk/src/inbound.behavior.test.ts', 'extensions/nextcloud-talk/src/inbound.authz.test.ts', 'extensions/nextcloud-talk/src/inbound.room-info-retry.test.ts', 'extensions/nextcloud-talk/src/webhook-spool.test.ts'];
async function validateRetained() {
  const expected = await readJson(path.join(qa, 'retained-39416877283.json'));
  const producer = await readJson(path.join(retained, 'producer-run.json'));
  assert.equal(producer.id, expected.producerRun);
  assert.equal(producer.head_sha, expected.producerQaHead);
  assert.equal(producer.status, 'completed');
  assert.equal(producer.conclusion, 'failure');
  for (const [file, hash] of Object.entries(expected.retainedFileSha256)) {
    assert.equal(sha(await fs.readFile(path.join(retained, file))), hash, 'retained input identity: ' + file);
  }
  const original = await readJson(path.join(retained, 'qualification.json'));
  assert.equal(original.status, 'FAIL', 'producer failed and must never be represented as green');
  assert.equal(original.baselineCommit, release);
  assert.equal(original.qaHead, expected.producerQaHead);
  assert.equal(original.sourceManifestSha256, expected.sourceManifestSha256);
  assert.deepEqual(Object.entries(original.gates).filter(([, value]) => value.status !== 'PASS').map(([key]) => key).sort(), ['lint', 'quote-negative-controls']);
  for (const command of original.commands) assert.equal(command.timedOut, false);
  for (const name of [...expected.retainedGates, 'types']) {
    assert.equal(original.gates[name].status, 'PASS');
    assert.equal(original.gates[name].evidence, 'fresh');
  }
  assert.equal(original.commands.find(command => command.label === 'production-types')?.code, 0);
  const previousSource = await readJson(path.join(retained, 'source-manifest.json'));
  assert.equal(previousSource.baselineCommit, release);
  assert.equal(previousSource.qaHead, expected.producerQaHead);
  assert.deepEqual(Object.keys(previousSource.files).sort(), paths.slice().sort());
  for (const [file, hash] of Object.entries(previousSource.files)) {
    assert.equal(sha(await fs.readFile(path.join(retained, 'formatted', file))), hash, 'retained formatted file ' + file);
    if (!expected.allowedChangedSourceFiles.includes(file)) {
      assert.equal(sourceManifest.files[file], hash, 'reused gate source changed: ' + file);
    } else {
      let previous = await fs.readFile(path.join(retained, 'formatted', file), 'utf8');
      const repairs = expected.testOnlyRepairs[file];
      assert(repairs?.length > 0);
      for (const {before, after} of repairs) {
        assert.equal(previous.split(before).length, 2, 'repair must match exactly once');
        previous = previous.replace(before, after);
      }
      assert.equal(sha(Buffer.from(previous)), sourceManifest.files[file], 'only reviewed test braces may differ');
    }
  }
  for (const [file, hash] of Object.entries(expected.productionSourceFiles)) assert.equal(sourceManifest.files[file], hash, 'all production bytes must remain identical');
  for (const [file, hash] of Object.entries(expected.retainedTestFiles)) assert.equal(sourceManifest.files[file], hash, 'retained direct test changed');
  await assertTests('direct-tests', directFiles, {[directFiles[0]]: 31, [directFiles[1]]: 6}, retained);
  for (const [label, kind, count] of [['baseline-direct', 'original-direct', 2], ['baseline-automatic', 'original-auto', 3], ['review-baseline-direct', 'review-direct', 6], ['review-baseline-automatic', 'review-auto', 3]]) {
    assert.equal(original.commands.find(command => command.label === label)?.code, 1);
    assertNegativeControls(await readJson(path.join(retained, label + '.json')), kind, count);
  }
  retainedReceipt = {status: 'PASS', producerRun: expected.producerRun, producerQaHead: expected.producerQaHead, producerConclusion: 'failure', producerQualificationStatus: 'FAIL', retainedProducerNeverCalledGreen: true, retainedSourceManifestSha256: expected.sourceManifestSha256, retainedFileSha256: expected.retainedFileSha256, allProductionBytesIdentical: true, onlyThreeTestBraceRepairs: true, retainedPassingTests: 37, retainedOriginalNegativeControls: 5, retainedReviewNegativeControls: 9, retainedProductionTypes: true};
  const retainedPacket = path.join(proof, 'retained-39416877283');
  await fs.mkdir(retainedPacket, {recursive: true});
  for (const file of [...Object.keys(expected.retainedFileSha256), 'producer-run.json']) {
    await fs.copyFile(path.join(retained, file), path.join(retainedPacket, file));
  }
  for (const file of Object.keys(previousSource.files)) {
    const target = path.join(retainedPacket, 'formatted', file);
    await fs.mkdir(path.dirname(target), {recursive: true});
    await fs.copyFile(path.join(retained, 'formatted', file), target);
  }
  await fs.copyFile(path.join(retained, 'direct-tests.json'), path.join(proof, 'direct-tests.json'));
  assert.equal(sha(await fs.readFile(path.join(proof, 'direct-tests.json'))), expected.retainedFileSha256['direct-tests.json']);
  Object.assign(retainedReceipt, {retainedRawPacket: 'retained-39416877283/', rootDirectTestsReport: {path: 'direct-tests.json', evidence: 'retained', producerRun: 39416877283, sha256: expected.retainedFileSha256['direct-tests.json']}});
  await fs.writeFile(path.join(proof, 'retained-proof.json'), JSON.stringify(retainedReceipt, null, 2));
}
async function retainPhase(name, run) {
  await phase(name, ['prepare-and-format'], async () => {
    assert.equal(retainedReceipt?.status, 'PASS');
    await run();
  });
  if (gates[name].status === 'PASS') Object.assign(gates[name], {evidence: 'retained', producerRun: 39416877283});
}
await phase('prepare-and-format', [], async () => {
  const head = (await command('checkout-head', 'git', ['rev-parse', 'HEAD'])).output.trim();
  assert.equal(head, release);
  const recipe = await readJson(path.join(qa, 'recipe-manifest.json'));
  assert.equal(recipe.baselineCommit, release);
  assert.equal(recipe.freshOnly, false);
  assert.equal(recipe.qualificationMode, 'bounded-test-only-delta');
  for (const [name, hash] of Object.entries(recipe.files)) {
    assert(!path.isAbsolute(name) && !name.split('/').includes('..'), name);
    assert.equal(sha(await fs.readFile(path.join(qa, name))), hash, `QA input drift: ${name}`);
  }
  for (const [name, hash] of Object.entries(recipe.rootInputs)) assert.equal(sha(await fs.readFile(path.join(input, name))), hash, `root input drift: ${name}`);
  const baseline = await readJson(path.join(input, 'release-manifest.json'));
  assert.equal(baseline.commit, release);
  for (const [file, hash] of Object.entries(baseline.files)) assert.equal(sha(await fs.readFile(file)), hash, `not exact release baseline: ${file}`);
  const prior = await readJson(path.join(input, 'attachment-source-manifest.json'));
  assert.equal(prior.qaHead, '754eb4bda906c5a3f7470ddc29b3357e6f98256c');
  assert.equal(sha(await fs.readFile(path.join(input, 'attachment-source-manifest.json'))), portPriorManifestSha256);
  paths = await readJson(path.join(input, 'paths.json'));
  const port = await readJson(path.join(input, 'port-manifest.json'));
  assert.equal(port.baselineCommit, release);
  assert.equal(paths.length, 15);
  assert.deepEqual(paths.slice().sort(), Object.keys(port.files).sort());
  for (const file of immutablePaths) immutable.set(file, sha(await fs.readFile(file)));
  for (const file of paths) {
    assert(file.startsWith('extensions/nextcloud-talk/') && !file.includes('..'));
    const bytes = await fs.readFile(path.join(input, 'source', file));
    assert.equal(sha(bytes), port.files[file].candidateSha256, file);
    await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.writeFile(file, bytes);
    const rawTarget = path.join(proof, 'raw', file);
    await fs.mkdir(path.dirname(rawTarget), {recursive: true});
    await fs.writeFile(rawTarget, bytes);
  }
  await command('format', 'pnpm', ['exec', 'oxfmt', '--write', ...paths]);
  await command('whitespace', 'git', ['diff', '--check']);
  sourceManifest = {baselineCommit: release, qaHead: process.env.GITHUB_SHA, inputPortManifestSha256: sha(await fs.readFile(path.join(input, 'port-manifest.json'))), inputRecipeManifestSha256: sha(await fs.readFile(path.join(qa, 'recipe-manifest.json'))), freshOnly: false, qualificationMode: 'bounded-test-only-delta', retainedProducerRun: 39416877283, files: {}};
  for (const file of paths) {
    const bytes = await fs.readFile(file);
    sourceManifest.files[file] = sha(bytes);
    // Preserve both exact raw inputs and the canonical formatter output.
    // The root reviews format.patch before admitting the artifact.
    const target = path.join(proof, 'formatted', file);
    await fs.mkdir(path.dirname(target), {recursive: true});
    await fs.writeFile(target, bytes);
  }
  await fs.writeFile(path.join(proof, 'source-manifest.json'), JSON.stringify(sourceManifest, null, 2));
  await fs.writeFile(path.join(proof, 'source.patch'), (await command('source-diff', 'git', ['diff', '--binary'])).output);
  const formattingPatches = [];
  for (const [index, file] of paths.entries()) {
    const diff = await command('format-diff-' + index, 'git', ['diff', '--no-index', '--binary', '--', path.join(proof, 'raw', file), file], {allowFailure: true});
    assert([0, 1].includes(diff.code), 'formatter patch generation failed');
    formattingPatches.push(diff.output);
  }
  await fs.writeFile(path.join(proof, 'format.patch'), formattingPatches.join(''));
  await fs.writeFile(path.join(proof, 'raw-source-manifest.json'), JSON.stringify({files: Object.fromEntries(paths.map(file => [file, port.files[file].candidateSha256]))}, null, 2));
  await assertSource();
  await validateRetained();
});

const parserPrefix = path.join(proof, 'parser-build-inputs');
await phase('parser-build-inputs', ['prepare-and-format'], async () => {
  await command('parser-prefix-install', 'npm', ['install', '--prefix', parserPrefix, '--registry', 'https://registry.npmjs.org', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', 'saxes@6.0.0', 'xmlchars@2.2.0']);
  const expected = await readJson(path.join(qa, 'parser-build-inputs.json'));
  const lock = await readJson(path.join(parserPrefix, 'package-lock.json'));
  for (const name of ['saxes', 'xmlchars']) {
    const actual = lock.packages['node_modules/' + name];
    assert.equal(actual.version, expected.packages[name].version);
    assert.equal(actual.integrity, expected.packages[name].integrity);
  }
  for (const [location, actual] of Object.entries(lock.packages)) {
    const name = location.match(/(?:^|\/)node_modules\/(saxes|xmlchars)$/)?.[1];
    if (name) {
      assert.equal(actual.version, expected.packages[name].version, location);
      assert.equal(actual.integrity, expected.packages[name].integrity, location);
    }
  }
  assert.equal(expected.packages.saxes.legal.asset, 'legal/saxes-6.0.0-LICENSE.txt');
  assert.equal(sha(await fs.readFile(path.join(qa, expected.packages.saxes.legal.asset))), expected.packages.saxes.legal.sha256, 'pinned upstream Saxes notice changed');
  assert.equal(expected.packages.xmlchars.legal.packagePath, 'LICENSE');
  assert.equal(sha(await fs.readFile(path.join(parserPrefix, 'node_modules/xmlchars/LICENSE'))), expected.packages.xmlchars.legal.sha256, 'pinned XMLChars notice changed');
  const proposedLink = path.resolve('extensions/nextcloud-talk/node_modules/saxes');
  await fs.mkdir(path.dirname(proposedLink), {recursive: true});
  assert.equal(await fs.lstat(proposedLink).then(() => true, () => false), false, 'do not replace an existing source dependency');
  await fs.symlink(path.join(parserPrefix, 'node_modules/saxes'), proposedLink, 'dir');
  parserLink = proposedLink;
  await fs.writeFile(path.join(proof, 'parser-input-receipt.json'), JSON.stringify({status: 'PASS', source: expected, lockSha256: sha(await fs.readFile(path.join(parserPrefix, 'package-lock.json'))), link: parserLink, productionDependencyChanges: false}, null, 2));
  await assertImmutable();
});

await phase('runtime-prerequisites', ['parser-build-inputs'], () => command('runtime-prerequisites', 'pnpm', ['build', 'qaRuntime'], {timeoutMs: 1_800_000}));
await phase('types', ['runtime-prerequisites'], async () => {
  assert.equal(retainedReceipt?.retainedProductionTypes, true);
  await command('test-types', 'pnpm', ['tsgo:extensions:test']);
});
if (gates.types.status === 'PASS') Object.assign(gates.types, {evidence: 'mixed', production: {evidence: 'retained', producerRun: 39416877283}, tests: {evidence: 'fresh'}});
await phase('lint', ['parser-build-inputs'], () => command('lint', process.execPath, ['scripts/run-oxlint.mjs', '--tsconfig', 'extensions/tsconfig.json', 'extensions/nextcloud-talk']));

const vitest = (config, files, label, more = []) => ['scripts/run-vitest.mjs', 'run', '--config', config, ...files, '--maxWorkers=1', ...more, '--reporter=json', '--outputFile=' + path.join(proof, label + '.json')];
const directConfig = 'test/vitest/vitest.extension-messaging.config.ts';
const forkConfig = path.join(qa, 'fork-profile.ts');
await retainPhase('negative-controls', async () => {
  assert.equal(retainedReceipt.retainedOriginalNegativeControls, 5);
});
await retainPhase('review-negative-controls', async () => {
  assert.equal(retainedReceipt.retainedReviewNegativeControls, 9);
});
await phase('quote-negative-controls', ['runtime-prerequisites'], async () => {
  const prior = await readJson(path.join(qa, 'prior-attachment/manifest.json'));
  assert.equal(prior.producerRun, 38940720388);
  assert.equal(prior.producerQaHead, '754eb4bda906c5a3f7470ddc29b3357e6f98256c');
  const restored = Object.keys(prior.files);
  assert.deepEqual(restored.slice().sort(), ['inbound.ts', 'types.ts', 'webhook-spool-state.ts', 'webhook-spool.ts'].map(file => 'extensions/nextcloud-talk/src/' + file).sort());
  const saved = new Map(await Promise.all(restored.map(async file => [file, await fs.readFile(file)])));
  try {
    for (const file of restored) {
      const bytes = await fs.readFile(path.join(qa, 'prior-attachment', file));
      assert.equal(sha(bytes), prior.files[file], file);
      await fs.writeFile(file, bytes);
    }
    for (const [label, file, pattern, expectedPassed, title, failure] of [
      ['quote-baseline-inbound', forkFiles[0], 'keeps quoted context separate from current command and reply targets', 0, 'keeps quoted context separate from current command and reply targets', 'expected undefined to deeply equal'],
      ['quote-baseline-durable', forkFiles[3], 'retains one quoted parent through durable admission and delivery|keeps the current message when optional quote', 5, 'retains one quoted parent through durable admission and delivery', 'to deeply equal'],
    ]) {
      const run = await command(label, process.execPath, vitest(forkConfig, [file], label, ['--testNamePattern', pattern]), {allowFailure: true});
      assert.equal(run.code, 1, label);
      const report = await readJson(path.join(proof, label + '.json'));
      assert.equal(report.success, false);
      assert.equal(report.numFailedTests, 1);
      assert.equal(report.numPassedTests, expectedPassed);
      assert.equal(report.testResults.length, 1);
      const assertions = report.testResults[0].assertionResults;
      assert(assertions.every(test => ['passed', 'failed', 'pending', 'skipped'].includes(test.status)));
      const active = assertions.filter(test => test.status === 'passed' || test.status === 'failed');
      const skipped = assertions.filter(test => test.status === 'pending' || test.status === 'skipped');
      assert.equal(skipped.length, report.numPendingTests);
      assert.equal(active.length + skipped.length, assertions.length);
      assert.equal(active.length, 1 + expectedPassed);
      const failed = active.filter(test => test.status === 'failed');
      assert.equal(failed.length, 1);
      assert(failed[0].fullName.endsWith(title));
      assert(failed[0].failureMessages.join(' ').includes(failure), 'must fail by missing quote assertion, never import/fixture failure');
      assert(active.filter(test => test.status === 'passed').every(test => test.fullName.includes('keeps the current message when optional quote')));
    }
  } finally {
    for (const [file, bytes] of saved) await fs.writeFile(file, bytes);
  }
  await assertSource();
});
await retainPhase('direct-manual-custody-parser', async () => {
  assert.equal(retainedReceipt.retainedPassingTests, 37);
});
await phase('automatic-auth-stock-ingress', ['runtime-prerequisites'], async () => {
  await command('fork-tests', process.execPath, vitest(forkConfig, forkFiles, 'fork-tests'));
  const result = await assertTests('fork-tests', forkFiles, {[forkFiles[0]]: 42, [forkFiles[1]]: 2, [forkFiles[2]]: 3, [forkFiles[3]]: 21});
  const automatic = result.testResults.find(suite => suite.name.endsWith('/inbound.behavior.test.ts'));
  assert.equal(automatic.assertionResults.filter(test => test.fullName.includes('uploads an automatic')).length, 3);
  assert.equal(automatic.assertionResults.filter(test => test.fullName.includes('preserves a bot-only automatic')).length, 3);
  assert.equal(automatic.assertionResults.filter(test => test.fullName.includes('retains the first bot-only')).length, 2);
  assert.equal(automatic.assertionResults.filter(test => test.fullName.includes('keeps command and raw projections separate')).length, 10);
  await command('stock-ingress-control', process.execPath, ['--import', './scripts/tsx.mjs', path.join(qa, 'stock-ingress.mjs')]);
  assert.equal((await readJson(path.join(proof, 'stock-ingress.json'))).status, 'PASS');
});

async function filesBelow(root) {
  const result = [];
  for (const entry of await fs.readdir(root, {withFileTypes: true})) {
    const file = path.join(root, entry.name);
    assert(!entry.isSymbolicLink(), `artifact symlink: ${file}`);
    if (entry.isDirectory()) result.push(...await filesBelow(file));
    else if (entry.isFile()) result.push(file);
    else throw new Error('unexpected artifact file type');
  }
  return result;
}
await phase('canonical-plugin-artifact', ['runtime-prerequisites'], async () => {
  await assertSource();
  await command('canonical-plugin-build', process.execPath, ['scripts/lib/plugin-npm-runtime-build.mjs', 'extensions/nextcloud-talk']);
  const dist = path.resolve('extensions/nextcloud-talk/dist');
  await fs.mkdir(path.join(dist, 'legal'), {recursive: true});
  const legal = await readJson(path.join(qa, 'parser-build-inputs.json'));
  const notices = {
    saxes: path.join(qa, legal.packages.saxes.legal.asset),
    xmlchars: path.join(parserPrefix, 'node_modules/xmlchars', legal.packages.xmlchars.legal.packagePath),
  };
  for (const [name, file] of Object.entries(notices)) {
    assert.equal(sha(await fs.readFile(file)), legal.packages[name].legal.sha256);
    await fs.copyFile(file, path.join(dist, 'legal', name + '-LICENSE.txt'));
  }
  const entries = [];
  for (const file of await filesBelow(dist)) {
    const bytes = await fs.readFile(file);
    entries.push({path: path.relative(path.dirname(dist), file).replaceAll(path.sep, '/'), sha256: sha(bytes), mode: (await fs.stat(file)).mode & 0o777, bytes: bytes.length});
    if (/\.(?:mjs|cjs|js)$/.test(file)) {
      const text = bytes.toString();
      const imports = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\b(?:_+)?require\d*\s*\(\s*)["']([^"']+)["']/g)].map(match => match[1]);
      assert(!imports.some(value => /^(?:saxes|xmlchars)(?:\/|$)/.test(value)), 'external parser dependency remains');
      assert(!imports.some(value => value.startsWith(process.env.RUNNER_TEMP) || value.startsWith('/tmp/') || value.startsWith('/home/runner/')), 'temporary absolute runtime import remains');
    }
  }
  await assertSource();
  await fs.writeFile(path.join(proof, 'dist-manifest.json'), JSON.stringify({status: 'PASS', baselineCommit: release, sourceManifestSha256: sha(await fs.readFile(path.join(proof, 'source-manifest.json'))), files: entries.sort((a, b) => a.path.localeCompare(b.path)), runtimeExternalParserImports: false, legalNoticesIncluded: ['saxes/ISC', 'xmlchars/MIT']}, null, 2));
  await command('dist-tarball', 'tar', ['-czf', path.join(proof, 'nextcloud-talk-dist.tgz'), '-C', path.dirname(dist), 'dist']);
});

await phase('stock-sdk-lazy-consumer', ['canonical-plugin-artifact'], async () => {
  assert((await fs.lstat(parserLink)).isSymbolicLink());
  assert.equal(await fs.readlink(parserLink), path.join(parserPrefix, 'node_modules/saxes'));
  await fs.unlink(parserLink);
  parserLink = undefined;
  const home = path.join(proof, 'consumer-home');
  await fs.mkdir(home, {recursive: true});
  const consumerEnv = {...env, HOME: home, OPENCLAW_HOME: home, OPENCLAW_STATE_DIR: path.join(home, 'state'), OPENCLAW_CONFIG_PATH: path.join(home, 'state/openclaw.json'), OPENCLAW_DISABLE_BONJOUR: '1'};
  for (const key of ['CODEX_HOME', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENCLAW_AGENT_DIR', 'OPENCLAW_SESSION_KEY']) delete consumerEnv[key];
  await command('stock-packages-install', 'npm', ['install', '--global', '--prefix', path.join(proof, 'stock-prefix'), '--registry', 'https://registry.npmjs.org', '--no-audit', '--no-fund', 'openclaw@2026.10.3', '@openclaw/nextcloud-talk@2026.10.3'], {env: consumerEnv});
  await command('stock-sdk-lazy-consumer', process.execPath, [path.join(qa, 'stock-consumer.mjs')], {env: consumerEnv});
  assert.equal((await readJson(path.join(proof, 'stock-consumer.json'))).status, 'PASS');
  await assertSource();
});

// On failure, remove only the task-created parser link; never write a PASS to
// rescue a failed gate or publish an artifact as deployable on partial evidence.
if (parserLink) {
  assert((await fs.lstat(parserLink)).isSymbolicLink());
  assert.equal(await fs.readlink(parserLink), path.join(parserPrefix, 'node_modules/saxes'));
  await fs.unlink(parserLink);
}
const requiredGates = ['prepare-and-format', 'parser-build-inputs', 'runtime-prerequisites', 'types', 'lint', 'negative-controls', 'review-negative-controls', 'quote-negative-controls', 'direct-manual-custody-parser', 'automatic-auth-stock-ingress', 'canonical-plugin-artifact', 'stock-sdk-lazy-consumer'];
assert.deepEqual(Object.keys(gates).sort(), requiredGates.sort());
const expectedEvidence = Object.fromEntries(requiredGates.map(name => [name, name === 'types' ? 'mixed' : ['negative-controls', 'review-negative-controls', 'direct-manual-custody-parser'].includes(name) ? 'retained' : 'fresh']));
const passed = Object.entries(gates).every(([name, gate]) => gate.status === 'PASS' && gate.evidence === expectedEvidence[name]);
await fs.writeFile(path.join(proof, 'qualification.json'), JSON.stringify({status: passed ? 'PASS' : 'FAIL', scope: 'Exact 10.3 source/unit/build/native SDK-consumer qualification only; not Gateway activation, real Nextcloud, production or upstream-head proof', baselineCommit: release, qaHead: process.env.GITHUB_SHA, sourceManifestSha256: sourceManifest ? sha(await fs.readFile(path.join(proof, 'source-manifest.json'))) : null, distArtifactSha256: gates['canonical-plugin-artifact']?.status === 'PASS' ? sha(await fs.readFile(path.join(proof, 'nextcloud-talk-dist.tgz'))) : null, freshOnly: false, qualificationMode: 'bounded-test-only-delta', totalQualifiedPassingTests: passed ? 105 : null, freshPassingTests: passed ? 68 : null, retainedPassingTests: passed ? 37 : null, freshOriginalNegativeControls: 0, freshReviewNegativeControls: 0, retainedOriginalNegativeControls: gates['negative-controls']?.status === 'PASS' ? 5 : null, retainedReviewNegativeControls: gates['review-negative-controls']?.status === 'PASS' ? 9 : null, retainedProducerRun: 39416877283, retainedProducerConclusion: 'failure', retainedProof: retainedReceipt ?? null, freshQuoteNegativeControls: gates['quote-negative-controls']?.status === 'PASS' ? 2 : null, freshQuoteBaselineControls: gates['quote-negative-controls']?.status === 'PASS' ? 5 : null, gates, commands, parserSourceLinkRemoved: true, noCoreOrManifestChanges: passed}, null, 2));
if (!passed) process.exitCode = 1;
