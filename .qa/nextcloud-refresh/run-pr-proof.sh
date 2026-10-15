#!/usr/bin/env bash
set -euo pipefail
proof="$RUNNER_TEMP/nextcloud-pr-proof"
mkdir -p "$proof"
export OPENCLAW_BUNDLED_PLUGIN_BUILD_IDS=nextcloud-talk
export OPENCLAW_VITEST_MAX_WORKERS=2
export NODE_OPTIONS=--max-old-space-size=8192
run() {
  local label="$1"
  shift
  "$@" 2>&1 | tee "$proof/$label.log"
}
run channel-catalog pnpm channels:catalog:gen
run channel-config pnpm config:channels:gen
run config-docs pnpm config:docs:gen
python3 - <<'PY'
import json,subprocess
paths=json.load(open('.qa/nextcloud-refresh/affected-files.json'))
paths=[p for p in paths if p.endswith(('.ts','.json','.md'))]
subprocess.run(['pnpm','exec','oxfmt','--write',*paths],check=True)
PY
# Archive generator/formatter changes before execution; source hashes bind all later proof.
git diff --binary > "$proof/generated-and-format.patch"
python3 - <<'PY'
import hashlib,json,os,subprocess
from pathlib import Path
paths=set(json.load(open('.qa/nextcloud-refresh/affected-files.json')))
paths.update(subprocess.check_output(['git','diff','--name-only']).decode().splitlines())
hashes={p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in sorted(paths) if Path(p).is_file()}
p=Path(os.environ['RUNNER_TEMP'])/'nextcloud-pr-proof'
(p/'source-manifest.json').write_text(json.dumps({'workflowHead':subprocess.check_output(['git','rev-parse','HEAD']).decode().strip(),'files':hashes,'installable':False},indent=2)+'\n')
PY
run build pnpm build
run talk-tests node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-messaging.config.ts extensions/nextcloud-talk
run matrix-consumer-tests node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-matrix.config.ts --passWithNoTests=false extensions/matrix/src/test-runtime.test.ts extensions/matrix/src/matrix/monitor/handler.media-failure.test.ts
run core-types pnpm tsgo:core
run extension-types pnpm tsgo:extensions
run extension-test-types pnpm tsgo:extensions:test
run core-lint node scripts/run-oxlint.mjs --tsconfig tsconfig.core.json src/plugins/runtime/runtime-channel.ts src/plugins/runtime/types-channel.ts src/plugin-sdk/test-helpers/plugin-runtime-mock.ts
run extension-lint node scripts/run-oxlint.mjs --tsconfig extensions/tsconfig.json extensions/nextcloud-talk extensions/matrix/src/test-runtime.ts
run plugin-profile env OPENCLAW_LOCAL_CHECK=0 node --import ./scripts/tsx.mjs scripts/profile-extension-memory.mts --extension nextcloud-talk --skip-combined --concurrency 1
python3 - <<'PY'
import hashlib,json,os
from pathlib import Path
proof=Path(os.environ['RUNNER_TEMP'])/'nextcloud-pr-proof'
m=json.loads((proof/'source-manifest.json').read_text())
for p,h in m['files'].items():
 assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==h,p
(proof/'qualification.json').write_text(json.dumps({'status':'PASS','kind':'PR-shared-source-not-installable-artifact','workflowHead':m['workflowHead'],'sourceManifestSha256':hashlib.sha256((proof/'source-manifest.json').read_bytes()).hexdigest()},indent=2)+'\n')
PY
