// GitHub-only, secretless qualification. This is not a deployment script.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
const release = '59cb44796b0f1f0daa0e37af8b1495abb45d9bc1';
const input = path.resolve(process.env.CANARY_INPUT_ROOT);
const qa = path.dirname(fileURLToPath(import.meta.url));
assert.equal(qa, path.join(input, 'qa'));
const proof = path.join(process.env.RUNNER_TEMP, 'nextcloud-outbound-canary-10.3');
await fs.mkdir(proof, {recursive: true});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const gates = {}, commands = [];
const env = {...process.env, CANARY_PROOF_DIR: proof, OPENCLAW_BUNDLED_PLUGIN_BUILD_IDS: 'nextcloud-talk', OPENCLAW_VITEST_MAX_WORKERS: '1', NODE_OPTIONS: '--max-old-space-size=8192'};
const immutablePaths = ['package.json', 'pnpm-lock.yaml', 'extensions/nextcloud-talk/package.json', 'extensions/nextcloud-talk/openclaw.plugin.json', 'extensions/nextcloud-talk/src/config-schema.ts', 'extensions/nextcloud-talk/src/types.ts', 'extensions/nextcloud-talk/src/webhook-spool.ts', 'extensions/nextcloud-talk/src/webhook-spool-state.ts'];
const immutable = new Map();
let sourceManifest, paths, parserLink, scopeOrdinal = 0;
let retainedProof;
const retainedPhaseNames = new Set(['types', 'lint', 'negative-controls', 'direct-manual-custody-parser', 'automatic-auth-stock-ingress']);
const priorRun = 38909679105;
const priorQaHead = 'dab72ab69927942aa2a1f62008031a4f23e0a760';

async function validateRetainedProof(directory) {
  assert.equal(path.resolve(directory), path.join(process.env.RUNNER_TEMP, 'nextcloud-outbound-canary-10.3-prior'));
  const prior = await readJson(path.join(directory, 'qualification.json'));
  assert.equal(prior.status, 'FAIL');
  assert.equal(prior.baselineCommit, release);
  assert.equal(prior.qaHead, priorQaHead);
  assert.equal(prior.distArtifactSha256, null);
  const expectedNames = ['prepare-and-format', 'parser-build-inputs', 'runtime-prerequisites', ...retainedPhaseNames, 'canonical-plugin-artifact', 'stock-sdk-lazy-consumer'];
  assert.deepEqual(Object.keys(prior.gates).sort(), expectedNames.sort());
  for (const name of expectedNames.filter(name => !['canonical-plugin-artifact', 'stock-sdk-lazy-consumer'].includes(name))) assert.equal(prior.gates[name].status, 'PASS', `unknown prior failure: ${name}`);
  assert.equal(prior.gates['canonical-plugin-artifact'].status, 'FAIL');
  assert.match(prior.gates['canonical-plugin-artifact'].error, /^Error: ENOENT: no such file or directory, copyfile '[^']*\/parser-build-inputs\/node_modules\/saxes\/LICENSE' -> '[^']*\/extensions\/nextcloud-talk\/dist\/legal\/saxes-LICENSE\.txt'$/);
  assert.equal(prior.gates['stock-sdk-lazy-consumer'].status, 'BLOCKED');
  assert.deepEqual(prior.gates['stock-sdk-lazy-consumer'].dependencies, ['canonical-plugin-artifact']);
  assert(prior.commands.every(item => item.timedOut === false && (item.code === 0 || ['baseline-direct', 'baseline-automatic'].includes(item.label))), 'unexpected prior command failure');
  for (const label of ['runtime-prerequisites', 'production-types', 'test-types', 'lint', 'direct-tests', 'fork-tests', 'stock-ingress-control', 'canonical-plugin-build']) {
    const matches = prior.commands.filter(item => item.label === label);
    assert.equal(matches.length, 1, label);
    assert.equal(matches[0].code, 0, label);
  }
  const sourceBytes = await fs.readFile(path.join(directory, 'source-manifest.json'));
  assert.equal(sha(sourceBytes), prior.sourceManifestSha256);
  const previousSource = JSON.parse(sourceBytes);
  assert.equal(previousSource.baselineCommit, release);
  assert.equal(previousSource.qaHead, priorQaHead);
  assert.deepEqual(previousSource.files, sourceManifest.files, 'cannot retain proof across source differences');
  assert.equal(Object.keys(previousSource.files).length, 11);
  for (const [file, hash] of Object.entries(previousSource.files)) assert.equal(sha(await fs.readFile(path.join(directory, 'formatted', file))), hash, file);
  const expectedSuites = {
    'direct-tests': {'outbound-media.test.ts': 18, 'send.handoff.test.ts': 6},
    'fork-tests': {'inbound.behavior.test.ts': 23, 'inbound.authz.test.ts': 2, 'inbound.room-info-retry.test.ts': 3, 'webhook-spool.test.ts': 12},
  };
  for (const [label, counts] of Object.entries(expectedSuites)) {
    const result = await readJson(path.join(directory, label + '.json'));
    assert.equal(result.success, true);
    assert.equal(result.numFailedTests, 0);
    assert.equal(result.numPendingTests, 0);
    assert.equal(result.numPassedTests, Object.values(counts).reduce((sum, value) => sum + value, 0));
    assert.equal(result.testResults.length, Object.keys(counts).length);
    const actual = new Map(result.testResults.map(suite => [path.basename(suite.name), suite]));
    assert.deepEqual([...actual.keys()].sort(), Object.keys(counts).sort());
    for (const [name, count] of Object.entries(counts)) {
      const suite = actual.get(name);
      assert.equal(suite.assertionResults.length, count, name);
      assert(suite.assertionResults.every(test => test.status === 'passed'), name);
    }
    if (label === 'fork-tests') {
      const automatic = actual.get('inbound.behavior.test.ts').assertionResults;
      assert.equal(automatic.filter(test => test.fullName.includes('uploads an automatic')).length, 3);
      assert.equal(automatic.filter(test => test.fullName.includes('keeps command and raw projections separate')).length, 10);
    }
  }
  for (const [label, count, needle] of [['baseline-direct', 2, 'delivers a real file share'], ['baseline-automatic', 3, 'uploads an automatic']]) {
    const runs = prior.commands.filter(item => item.label === label);
    assert.equal(runs.length, 1, label);
    assert.equal(runs[0].code, 1, label);
    const result = await readJson(path.join(directory, label + '.json'));
    assert.equal(result.success, false);
    assert.equal(result.numPassedTests, 0);
    assert.equal(result.testResults.length, 1);
    const failures = result.testResults.flatMap(suite => suite.assertionResults).filter(test => test.status === 'failed');
    assert.equal(result.numFailedTests, count);
    assert.equal(failures.length, count);
    assert(failures.every(test => test.fullName.includes(needle) && test.failureMessages.some(message => /undefined/i.test(message) && /equal/i.test(message))), label);
  }
  const ingress = await readJson(path.join(directory, 'stock-ingress.json'));
  assert.equal(ingress.status, 'PASS');
  assert.equal(ingress.fileActivityIgnored, true);
  assert.equal(ingress.updateIgnored, true);
  assert.equal(ingress.ordinaryApiActorCreateAdmissible, true);
  const previousParser = await readJson(path.join(directory, 'parser-input-receipt.json'));
  assert.equal(previousParser.status, 'PASS');
  const parserInputs = await readJson(path.join(qa, 'parser-build-inputs.json'));
  for (const name of ['saxes', 'xmlchars']) for (const key of ['version', 'integrity']) assert.equal(previousParser.source.packages[name][key], parserInputs.packages[name][key]);
  // Preserve original FAIL and every producer log/receipt under a separate name.
  const retainedFiles = await filesBelow(directory);
  const hashes = {};
  for (const file of retainedFiles) hashes[path.relative(directory, file).replaceAll(path.sep, '/')] = sha(await fs.readFile(file));
  await fs.cp(directory, path.join(proof, 'retained-prior'), {recursive: true});
  const receipt = {status: 'PASS', producerRun: priorRun, producerQaHead: priorQaHead, sourceManifestSha256: prior.sourceManifestSha256, retainedPassingTests: 64, retainedExpectedNegativeControls: 5, retainedPhases: [...retainedPhaseNames], originalFailurePreserved: true, files: hashes};
  await fs.writeFile(path.join(proof, 'retained-proof.json'), JSON.stringify(receipt, null, 2));
  return receipt;
}

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
  if (retainedProof && retainedPhaseNames.has(name)) {
    gates[name] = {status: 'PASS', evidence: 'retained', producerRun: priorRun, producerQaHead: priorQaHead};
    console.log(`${name}: PASS (retained exact-source evidence from ${priorRun})`);
    await fs.writeFile(path.join(proof, 'gate-status.json'), JSON.stringify({gates, commands}, null, 2));
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
  assert(tracked.every(file => paths.includes(file)), 'tracked changes outside the eleven-path plugin port');
  const untracked = (await command('untracked-scope-' + ordinal, 'git', ['ls-files', '--others', '--exclude-standard'])).output.trim().split('\n').filter(Boolean);
  assert(untracked.every(file => paths.includes(file) || file === '.proof-tools/' || file.startsWith('.proof-tools/')), 'unexpected untracked source outside reviewed port/tools');
}
async function assertTests(label, expectedFiles, exactCounts = {}) {
  const result = await readJson(path.join(proof, label + '.json'));
  assert.equal(result.success, true);
  assert.equal(result.numFailedTests, 0);
  assert.equal(result.numPendingTests, 0);
  assert(result.numPassedTests > 0);
  const actual = new Map(result.testResults.map(suite => [path.relative(process.cwd(), suite.name).replaceAll(path.sep, '/'), suite]));
  assert.deepEqual([...actual.keys()].sort(), [...expectedFiles].sort());
  for (const [file, suite] of actual) {
    assert(suite.assertionResults.length > 0, `zero assertions: ${file}`);
    assert(suite.assertionResults.every(test => test.status === 'passed'), `nonpassing/skipped assertions: ${file}`);
    if (exactCounts[file] !== undefined) assert.equal(suite.assertionResults.length, exactCounts[file], file);
  }
  return result;
}

await phase('prepare-and-format', [], async () => {
  const head = (await command('checkout-head', 'git', ['rev-parse', 'HEAD'])).output.trim();
  assert.equal(head, release);
  const baseline = await readJson(path.join(input, 'release-manifest.json'));
  assert.equal(baseline.commit, release);
  for (const [file, hash] of Object.entries(baseline.files)) assert.equal(sha(await fs.readFile(file)), hash, `not exact release baseline: ${file}`);
  paths = await readJson(path.join(input, 'paths.json'));
  const port = await readJson(path.join(input, 'port-manifest.json'));
  assert.equal(port.baselineCommit, release);
  assert.equal(paths.length, 11);
  assert.deepEqual(paths.slice().sort(), Object.keys(port.files).sort());
  for (const file of immutablePaths) immutable.set(file, sha(await fs.readFile(file)));
  for (const file of paths) {
    assert(file.startsWith('extensions/nextcloud-talk/') && !file.includes('..'));
    const bytes = await fs.readFile(path.join(input, 'source', file));
    assert.equal(sha(bytes), port.files[file].candidateSha256, file);
    await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.writeFile(file, bytes);
  }
  await command('format', 'pnpm', ['exec', 'oxfmt', '--write', ...paths]);
  await command('whitespace', 'git', ['diff', '--check']);
  sourceManifest = {baselineCommit: release, qaHead: process.env.GITHUB_SHA, files: {}};
  for (const file of paths) {
    const bytes = await fs.readFile(file);
    sourceManifest.files[file] = sha(bytes);
    const target = path.join(proof, 'formatted', file);
    await fs.mkdir(path.dirname(target), {recursive: true});
    await fs.writeFile(target, bytes);
  }
  await fs.writeFile(path.join(proof, 'source-manifest.json'), JSON.stringify(sourceManifest, null, 2));
  await fs.writeFile(path.join(proof, 'format.patch'), (await command('format-diff', 'git', ['diff', '--binary'])).output);
  await assertSource();
  if (process.env.CANARY_RETAINED_PROOF_DIR) retainedProof = await validateRetainedProof(process.env.CANARY_RETAINED_PROOF_DIR);
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
  await command('production-types', 'pnpm', ['tsgo:extensions']);
  await command('test-types', 'pnpm', ['tsgo:extensions:test']);
});
await phase('lint', ['parser-build-inputs'], () => command('lint', process.execPath, ['scripts/run-oxlint.mjs', '--tsconfig', 'extensions/tsconfig.json', 'extensions/nextcloud-talk']));

const directFiles = ['extensions/nextcloud-talk/src/outbound-media.test.ts', 'extensions/nextcloud-talk/src/send.handoff.test.ts'];
const forkFiles = ['extensions/nextcloud-talk/src/inbound.behavior.test.ts', 'extensions/nextcloud-talk/src/inbound.authz.test.ts', 'extensions/nextcloud-talk/src/inbound.room-info-retry.test.ts', 'extensions/nextcloud-talk/src/webhook-spool.test.ts'];
const vitest = (config, files, label, more = []) => ['scripts/run-vitest.mjs', 'run', '--config', config, ...files, '--maxWorkers=1', ...more, '--reporter=json', '--outputFile=' + path.join(proof, label + '.json')];
const directConfig = 'test/vitest/vitest.extension-messaging.config.ts';
const forkConfig = path.join(qa, 'fork-profile.ts');
await phase('negative-controls', ['runtime-prerequisites'], async () => {
  const restored = ['runtime-api.ts', 'src/inbound.ts', 'src/message-adapter.ts'].map(file => 'extensions/nextcloud-talk/' + file);
  const saved = new Map(await Promise.all(restored.map(async file => [file, await fs.readFile(file)])));
  try {
    for (const file of restored) await fs.writeFile(file, (await command('baseline-' + path.basename(file), 'git', ['show', release + ':' + file])).output);
    for (const [label, config, files, needle, count] of [
      ['baseline-direct', directConfig, [directFiles[0]], 'delivers a real file share', 2],
      ['baseline-automatic', forkConfig, [forkFiles[0]], 'uploads an automatic', 3],
    ]) {
      const run = await command(label, process.execPath, vitest(config, files, label, ['--testNamePattern', needle]), {allowFailure: true});
      assert.notEqual(run.code, 0, `${label} unexpectedly passed`);
      const result = await readJson(path.join(proof, label + '.json'));
      const failed = result.testResults.flatMap(suite => suite.assertionResults).filter(test => test.status === 'failed');
      assert.equal(result.numFailedTests, count);
      assert.equal(failed.length, count);
      assert(failed.every(test => test.fullName.includes(needle) && test.failureMessages.some(message => /undefined/i.test(message) && /equal/i.test(message))), `${label} failed at wrong boundary`);
    }
  } finally {
    for (const [file, bytes] of saved) await fs.writeFile(file, bytes);
  }
  await assertSource();
});
await phase('direct-manual-custody-parser', ['runtime-prerequisites'], async () => {
  await command('direct-tests', process.execPath, vitest(directConfig, directFiles, 'direct-tests'));
  await assertTests('direct-tests', directFiles, {[directFiles[0]]: 18, [directFiles[1]]: 6});
});
await phase('automatic-auth-stock-ingress', ['runtime-prerequisites'], async () => {
  await command('fork-tests', process.execPath, vitest(forkConfig, forkFiles, 'fork-tests'));
  const result = await assertTests('fork-tests', forkFiles, {[forkFiles[0]]: 23});
  const automatic = result.testResults.find(suite => suite.name.endsWith('/inbound.behavior.test.ts'));
  assert.equal(automatic.assertionResults.filter(test => test.fullName.includes('uploads an automatic')).length, 3);
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
const passed = Object.values(gates).every(gate => gate.status === 'PASS');
await fs.writeFile(path.join(proof, 'qualification.json'), JSON.stringify({status: passed ? 'PASS' : 'FAIL', scope: 'Exact 10.3 source/unit/build/native SDK-consumer qualification only; not Gateway activation, real Nextcloud, production or upstream-head proof', baselineCommit: release, qaHead: process.env.GITHUB_SHA, sourceManifestSha256: sourceManifest ? sha(await fs.readFile(path.join(proof, 'source-manifest.json'))) : null, distArtifactSha256: gates['canonical-plugin-artifact']?.status === 'PASS' ? sha(await fs.readFile(path.join(proof, 'nextcloud-talk-dist.tgz'))) : null, ...(retainedProof ? {retainedProof: {producerRun: priorRun, producerQaHead: priorQaHead, passingTests: 64, expectedNegativeControls: 5, receipt: 'retained-proof.json'}} : {}), gates, commands, parserSourceLinkRemoved: true, noCoreOrManifestChanges: passed}, null, 2));
if (!passed) process.exitCode = 1;
