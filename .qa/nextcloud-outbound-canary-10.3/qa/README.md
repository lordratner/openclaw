# GitHub-only exact-10.3 qualification recipes

**Legal-input repair and guarded resume prepared, not executed or dispatched.** Run `38909679105` passed the unchanged eleven-path source binding, runtime prerequisites, production/test types, lint, all **64 positive cases** and five expected original-source failures. Its canonical plugin build passed; only a QA assumption that published Saxes 6.0.0 contains `LICENSE` failed, leaving artifact closure and the stock consumer pending. Original FAIL/logs remain unchanged. This repair changes only QA legal inputs and guarded reuse; no plugin source, live files, dependencies, services, refs or test messages changed. This directory is QA tooling, not an activation script.

## Publisher layout

The parent should publish the selected input package at:

```text
.qa/nextcloud-outbound-canary-10.3/
  qa/                           # all files, including parser-build-inputs.json,
                                # legal/saxes-6.0.0-LICENSE.txt and resume.yml
  paths.json
  port-manifest.json
  release-manifest.json
  parser-build-inputs.json
  source/extensions/nextcloud-talk/...  # exactly the eleven paths in paths.json
```

Publish **`qa/resume.yml`** for the bounded continuation from `38909679105`; `qa/workflow.yml` remains the full fresh qualification alternative. Both check out **official release commit `59cb44796b0f1f0daa0e37af8b1495abb45d9bc1`**, then only these proof tools/inputs under `.proof-tools`. That layout is intentional: `fork-profile.ts` imports the first checkout's canonical helper through a fixed four-parent relative path. Do not relocate it without reviewing that import. Existing publisher explicit file lists must add the new QA metadata and license asset; merely publishing the old root `parser-build-inputs.json` is insufficient because the runner now reads the QA-owned legal-input metadata.

No production package/lock/config manifest is changed. The QA overlay changes only the eleven plugin/test paths; the source identity receipt records post-format hashes, so the parent must reconcile format-only changes and the helper repair before publishing an exact-source artifact claim.

## Guarded continuation — no blind skipping

`resume.yml` grants only `contents: read` and `actions: read` and downloads the exact named artifact from **`lordratner/openclaw` run `38909679105`**. The runner accepts retained evidence only when all of the following are true:

- Prior QA head is `dab72ab69927942aa2a1f62008031a4f23e0a760`, baseline is exact 10.3, and the prior source-manifest SHA and all eleven formatted file hashes equal the current overlay.
- The complete prior gate set matches exactly: all eight earlier gates PASS, canonical artifact gate FAIL **only** on the known missing `saxes/LICENSE` copy, stock consumer BLOCKED only by that gate, and no unknown command failure or timeout.
- Exact JSON suites prove **18+6 direct cases and 23+2+3+12 fork cases**, all passing with no skips; native automatic and command-projection case counts are checked separately. Both negative-control commands failed, exactly two/three intended assertions failed for missing native upload, and no unrelated failures occurred.
- Prior stock admission and pinned parser-version/integrity receipts match. Original producer files, including its FAIL, are copied unchanged under `retained-prior/` and SHA-bound by `retained-proof.json`.

Only types, lint, positive tests and expected negative controls receive explicitly labeled **retained** PASS evidence. Fresh checkout/setup, formatting/source guards, pinned parser/legal-input checks and **`pnpm build qaRuntime`** still run. Canonical standalone build, emitted closure/license audit, dist tarball and stock-SDK lazy consumer are fresh pending gates. Any changed source hash, unknown prior failure, wrong test/file count or failed fresh prerequisite blocks qualification; no broad fresh-test fallback hides the mismatch.

The continuation does not report 64 freshly executed tests. Its final receipt names the producer and points to retained evidence; the new run's `commands` records only commands it actually executed.

## Pinned legal input repair

Published `saxes@6.0.0` contains no license file. `qa/legal/saxes-6.0.0-LICENSE.txt` is the **whole** notice from the package's exact npm `gitHead` `211fa0ebec9b628affc09219199639887174bfc3`, not invented SPDX boilerplate or generated proof. Its immutable upstream URL and SHA-256 `0fac2374380621b22e6b50451057721a9c52935b02d16d106a9f04897f061d0e` are in `qa/parser-build-inputs.json`, and CI verifies the asset before including it in compiled `dist/legal`.

`xmlchars@2.2.0` does ship `LICENSE`; CI verifies that exact file against SHA-256 `45d196313c2647d313cc65ca9b093d2d6974b64d35ee7346f2c60c9d518dff2c`. Dependency versions/npm integrities are unchanged. Neither notice alters parser code or a production dependency manifest.

## One-job gates

`qualify.mjs` runs bounded phases and retains every executed command's log, exit code and wall time. Independent phases may continue after a failure; dependent ones are marked BLOCKED. The final qualification can be PASS **only if every gate is PASS**, with fresh/retained provenance explicit. A timeout/nonzero process exit cannot be rescued by a child-written receipt. The numbered matrix below describes a full fresh run; guarded resume retains only the named unchanged gates above.

1. Verify exact checkout and immutable release-file hashes; verify all eleven overlay input hashes; format the overlay using the release's formatter; capture formatted source and a new source manifest.
2. Install pinned parser inputs into a separate runner-temp prefix, scripts disabled, and verify **Saxes 6.0.0 / XMLChars 2.2.0** lockfile versions and npm integrities. Add only a task-owned source-build symlink for Saxes; production manifests and frozen lock remain unchanged.
3. Build the exact release's `pnpm build qaRuntime` prerequisites with the selected Talk scope.
4. Run exact release `pnpm tsgo:extensions`, `pnpm tsgo:extensions:test` and the release `run-oxlint` plugin lane.
5. Restore the three original production delivery paths temporarily and require **two manual and three automatic controls** to fail specifically on absent native upload assertions. Always restore the reviewed/formatted port bytes before proceeding.
6. Run direct/manual/custody/parser tests in the release messaging profile: **18 outbound-media cases and six send-handoff cases**. JSON results must name exactly those files, execute every assertion, and have no skips/failures.
7. Run four named Talk files through the fork-only profile: automatic behavior, authorization/mentions, room-info retry and stock durable spool regressions. Automatic behavior must execute **23 cases**: the current-main 14-case coverage plus the nine preserved release command-table cases. Require three native automatic cases and all ten raw/command projection cases explicitly. All four files must actually execute nonzero passing assertions.
8. Check the **unchanged source admission owner** ignores a real-shaped file Activity, ignores Update and admits an ordinary API-user Create identity. This is labeled source-owner control, not installed Gateway or sender-permission proof.
9. Run the canonical standalone plugin builder, include pinned parser license notices under compiled `dist/legal`, reject remaining bare parser/temporary-prefix runtime imports and artifact symlinks, bind the dist tree to source hashes, and create a **dist-only** tarball plus SHA manifest.
10. Remove the parser source link, install **official `openclaw@2026.10.3` and `@openclaw/nextcloud-talk@2026.10.3`** in an isolated CI prefix/home, verify the host's exact release commit, overlay only dist, and require both parser packages to remain unresolvable from the plugin root. Assert the plugin **actually resolves that exact stock SDK path**, not a different nested peer install, and record its hash. Import its real public channel API and invoke its actual lazy native media adapter against loopback HTTP **without an upload-ID header**, forcing bundled PROPFIND parsing. Verify bytes, authenticated requests, caption/read-only share fields, native receipt and ordinary signed bot-text control. The child must exit naturally; no forced successful exit or private installed cleanup imports are used.

### Why the QA-only fork config exists

At 10.3, `test/vitest/vitest.extension-database-workers-paths.mjs` registers Talk room-info retry, webhook spool and Doctor, **not** `inbound.behavior.test.ts`. Passing that filename to the unmodified worker profile could execute zero tests because its profile permits no tests. The Linux messaging profile uses threads, while these new native automatic cases need the main-thread SQLite broker owner.

`fork-profile.ts` reuses the exact release's `createScopedVitestConfig`, diagnostic forks selection, isolation and `test/setup.extensions.ts`, with the four explicit files and `passWithNoTests: false`. It does **not** modify the release's source profile lists. Its inherited setup drains agent database resources/global lifecycle before deleting test-owned homes; the source automatic fixture retains its existing state-database close helper. No new installed/public test-only SDK cleanup seam is assumed.

## Prerequisites and unproven inputs

- GitHub `ubuntu-24.04`, public npm/network access and the release's existing setup action must work. The action's semantic checks require systemd, noninteractive sudo and delegated cgroup-v2 memory control. No production/model/Nextcloud credential is required. Checkout credentials are not persisted.
- Canonical plugin compilation passed in `38909679105`, but emitted closure and lazy stock-SDK execution remain pending. Missing or changed pinned legal assets fail rather than being silently omitted. Saxes uses the exact upstream input described above; XMLChars uses its verified package notice.
- The two direct/three automatic negative controls passed their exact failure-location checks in `38909679105`. A changed source hash or different prior failure location cannot reuse that proof.
- The full types lanes include the release's existing workspace surface. Any unrelated failure must be attributed and reported; these recipes contain no baseline waiver or false-green fallback.
- **No full installed Gateway/real Nextcloud proof is prepared here.** The parent identified the existing upstream terminal-accounting fix [PR #173798](https://github.com/openclaw/openclaw/pull/173798), commit `dcc6e4910d3b85c8636b971d4d8ebc221efcd2b4`, for current-main integration. This recipe contains no core edit. Actual 10.3 runtime affectedness is **not established** merely by recognizing a similar branch: after artifact qualification, require a disposable official-10.3 Gateway proof before claiming any core backport is needed. A native-adapter delivery observation alone is not a settled-turn PASS.
- Stock 10.3 intentionally ignores file Activities. Do not reuse the current-main harness's requirement for a durable selective-own-file echo acknowledgement. The canary's actual Gateway proof must separately demonstrate ignored Activity/no loop, ordinary authorized API-user Create/text, native outgoing delivery, channel readiness and terminal completion.
- The dist artifact is **not a trusted plugin install**, release package, production deployment or upstream PR proof. Parent still owns source publication, exact-head review reconciliation, activation/rollback approval, detached safe restart and live end-to-end evidence. Never run this tooling against the production installation.

## Artifacts

The workflow uploads `nextcloud-outbound-canary-10.3-<run>` including formatted source, baseline controls, JSON test results, logs, parser input receipt, source/dist manifests, stock-consumer and stock-ingress receipts, and final qualification. The runnable artifact is only `nextcloud-talk-dist.tgz`; neither parser prefix nor the installed stock consumer tree belongs in a production overlay.
