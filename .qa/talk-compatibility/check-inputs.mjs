// Read-only preflight for the GitHub artifact consumer; no installs/builds/tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'runner is GitHub-only');
const root = fs.realpathSync(process.env.RUNNER_TEMP);
const within = (file) => { const resolved = fs.realpathSync(file); assert(resolved.startsWith(`${root}${path.sep}`), 'input must be staged under RUNNER_TEMP'); return resolved; };
assert.equal(manifest.kind, 'paired-pr-host-plugin');
assert.match(manifest.prHead, /^[a-f0-9]{40}$/);
assert.equal(manifest.hostSourceHead, manifest.prHead);
assert.equal(manifest.pluginSourceHead, manifest.prHead);
assert.match(manifest.baseline.spec, /^openclaw@\d{4}\.\d+\.\d+(?:-\d+)?$/, 'baseline must be exact stable version, not latest tag');
assert.match(manifest.baseline.integrity, /^sha512-[A-Za-z0-9+/=]+$/);
for (const role of ['host', 'plugin', 'baselineHost', 'baselinePlugin']) {
  const artifact = manifest.artifacts[role];
  const file = within(artifact.path);
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), artifact.sha256, `${role} artifact digest mismatch`);
}
const host = JSON.parse(fs.readFileSync(within(manifest.hostPackageJson), 'utf8'));
const plugin = JSON.parse(fs.readFileSync(within(manifest.pluginPackageJson), 'utf8'));
assert.equal(host.name, 'openclaw'); assert.equal(plugin.name, '@openclaw/nextcloud-talk');
assert.equal(plugin.version, host.version, 'first-party matching candidate pair required');
assert.equal(plugin.openclaw?.build?.openclawVersion, host.version);
assert.equal(manifest.productionCanaryArtifacts, false);
console.log(JSON.stringify({ assertion: 'input-artifacts-only', status: 'PASS', prHead: manifest.prHead, candidateVersion: host.version, baselineSpec: manifest.baseline.spec, compatibilityMetadata: { install: plugin.openclaw.install, compat: plugin.openclaw.compat, build: plugin.openclaw.build }, limitations: ['digests require independent producer/source attestation', 'not installed/runtime proof', 'not publication or released-host compatibility authority'] }));
