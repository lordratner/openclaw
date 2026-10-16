# Fresh reviewed outbound-canary qualification on exact10.3

**Prepared only, not executed or dispatched.** This recipe owns secretless GitHub qualification for the revised eleven-path outbound-only canary. It is not an installer, restart, rollback or production-message script. No old64-case execution is retained: presence of `CANARY_RETAINED_PROOF_DIR`, even empty, is rejected. Every required phase must report fresh PASS.

## Publisher layout and exact inputs

The parent publisher maps this entire `review-qa/` directory to remote `qa/` and maps **review-port-manifest.json** verbatim to remote **port-manifest.json**. Do not publish the historical original port-manifest.json for this lane.

```text
.qa/nextcloud-outbound-canary-10.3/
  qa/                              # entire review-qa directory, including legal/
    recipe-manifest.json
    prior-feature/                 # frozen old source inputs, not old proof
  paths.json                       # unchanged eleven-path overlay list
  port-manifest.json               # exact review-port-manifest.json bytes
  release-manifest.json             # unchanged selected exact-release hashes
  source/extensions/nextcloud-talk/ # current eleven overlay files only
```

Publish `qa/workflow.yml` as the workflow. It checks out official commit59cb44796b0f1f0daa0e37af8b1495abb45d9bc1, then this QA input package at its immutable workflow head under `.proof-tools`. The fixed fork-profile import must stay `../../../../test/vitest/vitest.scoped-config.ts` at this remote location; the directory name review-qa exists only locally. No source test-profile list is changed.

`recipe-manifest.json` binds every QA file except itself by SHA256 and binds the three root input files by exact bytes. The runner checks these before source overlay. It validates every selected baseline hash, copies only eleven reviewed paths, runs the release formatter, and requires post-format hashes still equal the reviewed input manifest. A formatter change stops qualification for parent reconciliation; it cannot silently change reviewed source. Source receipts bind input port/recipe manifests and QA head. Immutable root/plugin manifests, dependency lock, channel schema/types and stock webhook admission files are guarded before and after work. Source scope checks reject tracked/untracked changes outside the eleven paths and proof-tools checkout.

## All-fresh gate matrix

1. Exact checkout, source/recipe guards and format/whitespace.
2. Separate pinned parser prefix: saxes6.0.0/xmlchars2.2.0, scripts disabled, version/integrity and whole legal notices verified; only a task-owned build symlink is added.
3. Exact release `pnpm build qaRuntime` prerequisites.
4. Fresh production and test type lanes.
5. Fresh canonical plugin lint.
6. Five original-stock negative controls: direct2 and automatic3 must fail specifically at missing native-upload Buffer assertions. Temporarily restore only stock runtime-api.ts/inbound.ts/message-adapter.ts; always restore reviewed bytes.
7. Nine prior-feature controls: freeze adapter/sender from qualified producer38913658320, not mutable source; direct6 (401/507/403/500 guidance4 plus captioned/captionless bot-link2) and automatic3 must fail at specific assertion/credential boundaries. Restore revised source in finally. The parser handles Vitest’s clipped `upload fail…` text without accepting generic failures.
8. **37 direct/text positives**: outbound-media31, send.handoff6, exact files/counts, no failures/skips/zero cases.
9. **46 fork positives**: behavior29, auth2, roomretry3, spool12, exact files/counts, no failures/skips. Explicitly require native automatic3, bot-link automatic3, real partial-failure receipt2 and unchanged raw/command projection10 cases. Unchanged source admission control must still ignore file Activity/Update and admit ordinary API-user Create/text.
10. Canonical release standalone plugin build, exact parser notices, dist SHA/mode manifest, no bare parser or CI-temporary imports, no artifact symlinks, immutable/source recheck and dist-only tarball.
11. Remove parser source link, install official10.3 host/plugin in isolated CI prefix/home, preserve package/manifest, assert actual stock-SDK resolution and parser unresolvability, then run real compiled lazy native media against loopback HTTP without upload-ID header (forces bundled PROPFIND parser), exact bytes/share/receipt and signed ordinary text. Child must exit naturally.

Final qualification requires this exact eleven-gate set, every status PASS with evidence=fresh, and all nonzero command exits to belong to the four explicitly checked negative-control runs. A failed command or phase is never rescued by a child receipt. Logs, codes, timing, formatted input hashes, parser/dist manifests and qualification are uploaded. Expected positives83; expected original negatives5; reviewed negatives9. The prior failed/main or old canary runs are not reused as execution proof.

## Frozen prior feature / licensing

`prior-feature/` contains only the old adapter and sender, its exact original eleven-source producer manifest, and a SHA-bound descriptor. It exists to make new regressions fail on the prior feature, not to claim retained passing tests or skip any phase. Copy origin: local preserved artifact38913658320/formatted, itself matched to the original source-manifest hashes and exact10.3 baseline; no new GitHub fetch or source mutation is required.

Saxes’s published6.0.0 npm package omits LICENSE. The whole checked-in notice is from exact npm gitHead211fa0ebec9b628affc09219199639887174bfc3, SHA0fac2374380621b22e6b50451057721a9c52935b02d16d106a9f04897f061d0e. XMLChars’s package LICENSE is SHA45d196313c2647d313cc65ca9b093d2d6974b64d35ee7346f2c60c9d518dff2c. Immutable source URLs and npm integrities remain in parser-build-inputs.json. No production dependency/manifest change or host parser install is used.

## Prerequisites / boundaries

GitHub ubuntu24.04, public npm/GitHub network, official release setup action, semantic systemd/sudo/cgroup prerequisites and no production credentials. Secrets are unnecessary. Canonical setup and full checks run only on GitHub; local preparation performed syntax parsing only. No dependencies or product tests/builds run locally.

PASS here means exact-release source/tests/build/closed artifact/stock-SDK consumer only. It is **not** installed Gateway or real Nextcloud proof, safe-restart approval, production activation, daily-use delivery or upstream readiness. Parent must run fresh disposable official10.3 Gateway proof for this revised artifact, then separately complete approved live operations and owner-visible verification. Stock file Activity remains ignored; no inbound feature, core seam or live config/manifest/dependency augmentation is included.
