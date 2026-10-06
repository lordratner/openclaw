#!/usr/bin/env bash
# PROPOSAL ONLY: runs on a disposable GitHub-hosted runner, never the live host.
set -euo pipefail
payload="$RUNNER_TEMP/canary-payload"
proof="$RUNNER_TEMP/release-canary-proof"
mkdir -p "$proof"
cp "$payload/release-canary-source-manifest.json" "$proof/source-manifest.json"
cp "$payload/workflow-commit.txt" "$proof/workflow-commit.txt"
test "$(git rev-parse HEAD)" = fc23bc864e4553c2d215e479eeec47b67a0bf943
python3 "$payload/verify-source.py" release
mkdir -p "$proof/stock-generated/src/config"
cp src/config/bundled-channel-config-metadata.generated.ts "$proof/stock-generated/src/config/"

# Canonical matching core builds, before generating the new Talk config schema.
# First build stock; then ONLY the already approved deletion seam. Do not compile
# the candidate generated channel metadata into the seam-only core comparison.
pnpm build qaRuntime 2>&1 | tee "$proof/core-stock-build.log"
python3 - <<'PY'
import os, shutil
from pathlib import Path
shutil.copytree('dist',Path(os.environ['RUNNER_TEMP'])/'release-canary-proof/core-stock-dist',ignore=shutil.ignore_patterns('node_modules'),symlinks=True)
PY
git apply --check "$payload/release-core-delete-seam.patch"
git apply "$payload/release-core-delete-seam.patch"
pnpm build qaRuntime 2>&1 | tee "$proof/core-seam-build.log"
python3 - <<'PY'
import os, shutil
from pathlib import Path
shutil.copytree('dist',Path(os.environ['RUNNER_TEMP'])/'release-canary-proof/core-seam-dist',ignore=shutil.ignore_patterns('node_modules'),symlinks=True)
PY
python3 "$payload/inventory-core.py"

# Restore ONLY the task-applied seam, then apply the hash-bound complete source
# preparation. No branch, ref, package-version or dependency-graph changes.
git apply --reverse "$payload/release-core-delete-seam.patch"
git apply --check "$payload/release-canary-source.patch"
git apply "$payload/release-canary-source.patch"
python3 "$payload/verify-source.py" candidate

# Use the already frozen transitive saxes 6.0.0 for the source-only resolver.
# It is not a source or runtime manifest dependency change. The emitted plugin
# must bundle saxes/xmlchars; a remaining bare import is a hard failure.
test -f node_modules/.pnpm/saxes@6.0.0/node_modules/saxes/package.json
test ! -e node_modules/saxes
ln -s .pnpm/saxes@6.0.0/node_modules/saxes node_modules/saxes

pnpm config:channels:gen 2>&1 | tee "$proof/channel-config-generator.log"
node scripts/lib/plugin-npm-runtime-build.mjs extensions/nextcloud-talk 2>&1 | tee "$proof/plugin-build.log"
node --import ./scripts/tsx.mjs "$payload/stage-plugin.mts"

# All Talk tests include the attachment/native-voice changes and stock ordinary
# ingress/authorization/room lookup/dispatch siblings. No OAuth/audit/UI reruns.
node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-messaging.config.ts extensions/nextcloud-talk 2>&1 | tee "$proof/talk-tests.log"

# Explicit paths include added files, not just tracked diff files. Canonical
# changed-check owns type/lint/format/boundary selection; no hand-selected bypass.
python3 - "$payload/release-canary-source-manifest.json" <<'PY' 2>&1 | tee "$proof/changed-check.log"
import json, subprocess, sys
m=json.load(open(sys.argv[1]))
subprocess.run(['pnpm','check:changed','--base',m['release_commit'],'--head',m['release_commit'],'--',*[x['path'] for x in m['files']]],check=True)
PY
OPENCLAW_LOCAL_CHECK=0 node --import ./scripts/tsx.mjs scripts/profile-extension-memory.mts --extension nextcloud-talk --skip-combined --concurrency 1 2>&1 | tee "$proof/plugin-profile.log"
python3 "$payload/verify-source.py" candidate
printf '%s\n' 'CI gates passed; live compiled seam boundary still requires review and installed-stock hash closure comparison.' > "$proof/qualification.txt"
