# GitHub-only exact-10.3 qualification recipes

**Updated recipes prepared, not rerun or dispatched.** Initial run `38904653794` passed source/format binding, pinned parser inputs and lint, then failed the runtime prerequisite on a missing plugin-private cleanup helper. Its logs and FAIL receipt remain unchanged. The local repair adds that existing helper as an eleventh path and applies only verified CI formatter bytes to the outbound test fixture; fresh parent review/qualification is pending. No live files, dependencies, services, refs or test messages changed during this repair. This directory is QA tooling, not an activation script.

## Publisher layout

The parent should publish the selected input package at:

```text
.qa/nextcloud-outbound-canary-10.3/
  qa/                           # all files in this directory
  paths.json
  port-manifest.json
  release-manifest.json
  parser-build-inputs.json
  source/extensions/nextcloud-talk/...  # exactly the eleven paths in paths.json
```

Publish `qa/workflow.yml` as the fork-only workflow. The workflow checks out **official release commit `59cb44796b0f1f0daa0e37af8b1495abb45d9bc1`**, then checks out only these proof tools/inputs under `.proof-tools`. That layout is intentional: `fork-profile.ts` imports the first checkout's canonical helper through a fixed four-parent relative path. Do not relocate it without reviewing that import.

No production package/lock/config manifest is changed. The QA overlay changes only the eleven plugin/test paths; the source identity receipt records post-format hashes, so the parent must reconcile format-only changes and the helper repair before publishing an exact-source artifact claim.

## One-job gates

`qualify.mjs` runs bounded phases and retains every executed command's log, exit code and wall time. Independent phases may continue after a failure; dependent ones are marked BLOCKED. The final qualification can be PASS **only if every gate is PASS**. A timeout/nonzero process exit cannot be rescued by a child-written receipt.

1. Verify exact checkout and immutable release-file hashes; verify all eleven overlay input hashes; format the overlay using the release's formatter; capture formatted source and a new source manifest.
2. Install pinned parser inputs into a separate runner-temp prefix, scripts disabled, and verify **Saxes 6.0.0 / XMLChars 2.2.0** lockfile versions and npm integrities. Add only a task-owned source-build symlink for Saxes; production manifests and frozen lock remain unchanged.
3. Build the exact release's `pnpm build qaRuntime` prerequisites with the selected Talk scope.
4. Run exact release `pnpm tsgo:extensions`, `pnpm tsgo:extensions:test` and the release `run-oxlint` plugin lane.
5. Restore the three original production delivery paths temporarily and require **two manual and three automatic controls** to fail specifically on absent native upload assertions. Always restore the reviewed/formatted port bytes before proceeding.
6. Run direct/manual/custody/parser tests in the release messaging profile: **18 outbound-media cases and six send-handoff cases**. JSON results must name exactly those files, execute every assertion, and have no skips/failures.
7. Run four named Talk files through the fork-only profile: automatic behavior, authorization/mentions, room-info retry and stock durable spool regressions. Automatic behavior must execute **23 cases**: the current-main 14-case coverage plus the nine preserved release command-table cases. Require three native automatic cases and all ten raw/command projection cases explicitly. All four files must actually execute nonzero passing assertions.
8. Check the **unchanged source admission owner** ignores a real-shaped file Activity, ignores Update and admits an ordinary API-user Create identity. This is labeled source-owner control, not installed Gateway or sender-permission proof.
9. Run the canonical standalone plugin builder, include pinned parser license notices under compiled `dist/legal`, reject remaining bare parser/temporary-prefix runtime imports and artifact symlinks, bind the dist tree to source hashes, and create a **dist-only** tarball plus SHA manifest.
10. Remove the parser source link, install **official `openclaw@2026.10.3` and `@openclaw/nextcloud-talk@2026.10.3`** in an isolated CI prefix/home, verify the host's exact release commit, overlay only dist, and require both parser packages to remain unresolvable from the plugin root. Import its real public channel API and invoke its actual lazy native media adapter against loopback HTTP **without an upload-ID header**, forcing bundled PROPFIND parsing. Verify bytes, authenticated requests, caption/read-only share fields, native receipt and ordinary signed bot-text control. The child must exit naturally; no forced successful exit or private installed cleanup imports are used.

### Why the QA-only fork config exists

At 10.3, `test/vitest/vitest.extension-database-workers-paths.mjs` registers Talk room-info retry, webhook spool and Doctor, **not** `inbound.behavior.test.ts`. Passing that filename to the unmodified worker profile could execute zero tests because its profile permits no tests. The Linux messaging profile uses threads, while these new native automatic cases need the main-thread SQLite broker owner.

`fork-profile.ts` reuses the exact release's `createScopedVitestConfig`, diagnostic forks selection, isolation and `test/setup.extensions.ts`, with the four explicit files and `passWithNoTests: false`. It does **not** modify the release's source profile lists. Its inherited setup drains agent database resources/global lifecycle before deleting test-owned homes; the source automatic fixture retains its existing state-database close helper. No new installed/public test-only SDK cleanup seam is assumed.

## Prerequisites and unproven inputs

- GitHub `ubuntu-24.04`, public npm/network access and the release's existing setup action must work. The action's semantic checks require systemd, noninteractive sudo and delegated cgroup-v2 memory control. No production/model/Nextcloud credential is required. Checkout credentials are not persisted.
- The canonical builder's Saxes/XMLChars bundling behavior was source-inspected, not executed here. Parser closure and lazy stock-SDK execution are mandatory gates. Both license files must exist in the installed pinned input packages; missing license/artifact inputs fail rather than being silently omitted.
- The two direct/three automatic negative controls were ported structurally from the parent's proven pattern but have not run on this exact release. A different failure location is a failed gate, not acceptable negative proof.
- The full types lanes include the release's existing workspace surface. Any unrelated failure must be attributed and reported; these recipes contain no baseline waiver or false-green fallback.
- **No full installed Gateway/real Nextcloud proof is prepared here.** The parent's current-main installed scenario has an unresolved trigger terminal-status diagnostic. Its delivery observation is not a settled-turn PASS and is not authority to copy an unknown repair. Canary activation remains blocked until that issue is understood and the actual exact-release Gateway/daily-use proof is qualified.
- Stock 10.3 intentionally ignores file Activities. Do not reuse the current-main harness's requirement for a durable selective-own-file echo acknowledgement. The canary's actual Gateway proof must separately demonstrate ignored Activity/no loop, ordinary authorized API-user Create/text, native outgoing delivery, channel readiness and terminal completion.
- The dist artifact is **not a trusted plugin install**, release package, production deployment or upstream PR proof. Parent still owns source publication, exact-head review reconciliation, activation/rollback approval, detached safe restart and live end-to-end evidence. Never run this tooling against the production installation.

## Artifacts

The workflow uploads `nextcloud-outbound-canary-10.3-<run>` including formatted source, baseline controls, JSON test results, logs, parser input receipt, source/dist manifests, stock-consumer and stock-ingress receipts, and final qualification. The runnable artifact is only `nextcloud-talk-dist.tgz`; neither parser prefix nor the installed stock consumer tree belongs in a production overlay.
