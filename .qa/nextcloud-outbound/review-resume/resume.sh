#!/usr/bin/env bash
set -euo pipefail
proof="$RUNNER_TEMP/nextcloud-outbound-proof"
qa=".proof-tools/.qa/nextcloud-outbound"
mkdir -p "$proof"
export OPENCLAW_BUNDLED_PLUGIN_BUILD_IDS=nextcloud-talk
export OPENCLAW_VITEST_MAX_WORKERS=1
export NODE_OPTIONS=--max-old-space-size=8192
case "$1" in
prepare)
 git fetch --no-tags --depth=1 origin 1fe7654c3d26f9d9248f94b05fdbdb7bce5d4d20
 git fetch --no-tags --depth=1 origin "$BASE_SHA"
 python3 "$qa/review-resume/proof.py" prepare
 ;;
formatlint)
 pnpm exec oxfmt --check extensions/nextcloud-talk/src/inbound.behavior.test.ts 2>&1 | tee "$proof/affected-format.log"
 node scripts/run-oxlint.mjs --tsconfig extensions/tsconfig.json extensions/nextcloud-talk/src/inbound.behavior.test.ts 2>&1 | tee "$proof/affected-lint.log"
 ;;
automatic)
 node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-database-workers.config.ts extensions/nextcloud-talk/src/inbound.behavior.test.ts extensions/nextcloud-talk/src/inbound.authz.test.ts extensions/nextcloud-talk/src/inbound-media.mentions.test.ts --maxWorkers=1 --reporter=json --outputFile="$proof/automatic-and-auth-tests.json" 2>&1 | tee "$proof/automatic-and-auth-tests.log"
 ;;
types)
 pnpm tsgo:extensions:test 2>&1 | tee "$proof/test-types.log"
 ;;
negative)
 git fetch --no-tags --depth=1 origin ca18124c8a500d2507103741414a02f6f313c52b
 restore_source() {
   for name in src/inbound.ts src/message-adapter.ts src/outbound-media.ts runtime-api.ts; do
     cp "$proof/formatted/extensions/nextcloud-talk/$name" "extensions/nextcloud-talk/$name"
   done
 }
 trap restore_source EXIT
 for name in src/inbound.ts src/message-adapter.ts runtime-api.ts; do
   git show "$BASE_SHA:extensions/nextcloud-talk/$name" > "extensions/nextcloud-talk/$name"
 done
 set +e
 node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-database-workers.config.ts extensions/nextcloud-talk/src/inbound.behavior.test.ts --maxWorkers=1 --testNamePattern 'uploads an automatic' --reporter=json --outputFile="$proof/baseline-automatic.json" > "$proof/baseline-automatic.log" 2>&1
 original_code=$?
 set -e
 restore_source
 for name in src/outbound-media.ts src/message-adapter.ts; do
   git show "ca18124c8a500d2507103741414a02f6f313c52b:extensions/nextcloud-talk/$name" > "extensions/nextcloud-talk/$name"
 done
 set +e
 node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-database-workers.config.ts extensions/nextcloud-talk/src/inbound.behavior.test.ts --maxWorkers=1 --testNamePattern 'preserves a bot-only automatic' --reporter=json --outputFile="$proof/review-baseline-automatic.json" > "$proof/review-baseline-automatic.log" 2>&1
 review_code=$?
 set -e
 restore_source
 trap - EXIT
 test "$original_code" -ne 0
 test "$review_code" -ne 0
 python3 "$qa/review-resume/proof.py" controls
 ;;
finalize)
 python3 "$qa/review-resume/proof.py" finalize
 ;;
*) exit 2 ;;
esac
