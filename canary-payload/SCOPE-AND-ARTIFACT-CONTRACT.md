# Reviewed GitHub-only package — first run failed; retry correction not published

## Prepared source

- Installed-release source: `fc23bc864e4553c2d215e479eeec47b67a0bf943` (`2026.9.8`).
- PR reference: `fd74a2e849af5f8f65b14361b1368e7eb76c7173`. This is a release adaptation, not that exact PR tree.
- Source patch: `release-canary-source.patch`, SHA256 `b9a53ba43b03c1ca133ac2b0e0b7b96f415d976064639788bdfb99632c030dc3`.
- Core-only patch: `release-core-delete-seam.patch`, SHA256 `940b9a76ef154415c9e64ca7a3a20f3568303e5794425d8c147dfa134c6a2cba`.
- `release-canary-source-manifest.json` records all 23 changed-file hashes: 4,765 additions / 27 deletions, predominantly regression coverage. Nothing here is built or tested.
- `release-source-inventory.json` compares the draft with all 50,595 regular release archive files and separately verifies the archive's symlink. No unlisted source changes.

The production delta contains Talk attachment/native-voice parsing, authenticated same-origin metadata/WebDAV retrieval, authorization and cancellation fences, staging/cleanup, and the generic runtime deletion seam. The only core production changes are the import/runtime property/type property for the existing stock `deleteMediaBuffer` implementation. No Gateway/MCP changes, dependency upgrades, async backport, private fd74 core bundled into the plugin, state/schema migration, or moving-main integration. The release's canonical bundler retains its own existing SDK compatibility bindings; no new custom core bundling is proposed.

## Honest envelope boundary

The release's supported `resolveChannelInboundRouteEnvelope` builder is synchronous. The adapter uses existing public runtime `session.resolveStorePath` and `session.readSessionUpdatedAt`, captures the timestamp **before** revalidating authority or fetching/staging media, and passes that exact value into `buildEnvelope`; explicit `null` suppresses its default late history read. Normal formatter/options/route behavior remains the stock owner. The handler still propagates the original thrown/abort error.

The three copied preparation tests now hook that actual synchronous timestamp read, not the absent async SDK builder. Their assertions still require zero metadata retrieval, staging, context and dispatch after revocation/cancellation/read failure. Four partial Talk runtime fixtures gain the existing typed session mock. No security assertion was removed or relaxed.

This does **not** prove async worker preparation, zero caller-thread SQL, or exact-PR equivalence. The stock release retains its existing synchronous session-history API. Parent-owned exact-head isolated proofs are separate evidence. Live evidence must identify this release adaptation and those limits explicitly.

## Exact external publication needed

Suggested fork/branch reuse: `lordratner/openclaw`, existing disposable branch `ci/nextcloud-talk-135895-mcp-repair-20261006`; its currently successful workflow is the OAuth follow-up (`.github/workflows/ci.yml`, run `37518762607`, workflow commit `23e999c6f8d8320c979019dce4f71ba54b043b52`). It cannot build the canary unchanged.

Concrete proposed remote write set:

1. Replace **only that disposable branch's** `.github/workflows/ci.yml` with `workflow.yml` from this proposal.
2. Add `canary-payload/`: the two source patches, source manifest, `run-release-ci.sh`, `verify-source.py`, `inventory-core.py`, `stage-plugin.mts`, and this scope note. Do not push the adapted source tree, source PR branch, release tag, or dependency files.
3. Dispatch that workflow once at the resulting reviewed branch commit. Workflow runner permissions remain `contents: read`, `actions: read`; public GitHub-hosted Ubuntu compute only. No live host access/credentials/secrets.

Before writing, inspect the disposable branch's current remote head to avoid overwriting later unrelated work. Publish via an isolated checkout or Git Data API without moving shared PR refs. Existing authorization for the OAuth fixture job is not silently extended to this different release job; parent owns the explicit workflow/payload publication decision.

`workflow.yml` is a concrete proposed workflow, not a dispatch receipt. Pin the new resulting workflow commit in the recorded run evidence. Review all payload hashes before publication. Remote dependency restore uses the exact release's canonical setup action with frozen lockfile; it does not restore anything on this VM. Source/lock hashes are checked after the remote restore.

## Canonical remote command sequence

The proposal deliberately uses release-owned commands:

1. `pnpm build qaRuntime` for the stock release and again with **only** the deletion seam, both with `OPENCLAW_BUNDLED_PLUGIN_BUILD_IDS=nextcloud-talk`. This canonical runtime profile skips global DTS/UI work; it still builds the shared core/SDK runtime graph and postbuild assets.
2. Capture both complete compiled inventories **before** `pnpm config:channels:gen`, so the new Talk schema is never compiled into the seam-only core artifact comparison.
3. Apply the complete release-bound plugin/test patch, then `pnpm config:channels:gen`. Compare its canonical parsed projection with stock and reject any changed plugin other than Nextcloud Talk.
4. `node scripts/lib/plugin-npm-runtime-build.mjs extensions/nextcloud-talk` (positional directory, no invented `--package-dir`).
5. Canonical package/manifest projections from `scripts/lib/plugin-npm-package-manifest.mts`: `resolveAugmentedPluginNpmPackageJson({bundleDependencies:false,...})` and `resolveAugmentedPluginNpmManifest(...)`. These include generated Talk channel schema/UI hints and runtime/setup entries. No handwritten schema or npm installation/pack callback.
6. `node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-messaging.config.ts extensions/nextcloud-talk` — Talk regressions plus ordinary ingress/authz/room lookup/dispatch siblings, not OAuth/audit/UI checks.
7. `pnpm check:changed --base fc23... --head fc23... -- <all 23 explicit changed paths>` — release-owned check selection includes added files and type/lint/format/boundary checks. No source fixes are automatic if the gate fails.
8. Canonical isolated Talk entrypoint profiler with `OPENCLAW_LOCAL_CHECK=0`, `--skip-combined --concurrency 1`.

`run-release-ci.sh` retains every build/test log and source receipt. No counterpart command has been run locally.

## XML parser and dependency scope

The frozen release lock already contains `saxes@6.0.0` and its `xmlchars` dependency. Neither the root nor Talk package declares `saxes` directly. The standalone plugin bundler externalizes declared dependency/peer names and `openclaw/*`, not this parser, so a resolver-visible frozen parser is eligible to bundle into plugin-local chunks.

The proposal exposes only the already-installed locked parser through a **GitHub-runner-local** `node_modules/saxes` symlink. It does not edit manifests, lockfile, installed host packages or official runtime dependency metadata. This is a task-scoped source resolver arrangement, not a proposed upstream dependency policy. Emitted `saxes`/`xmlchars` bare imports are rejected. Actual successful bundling/export closure is a remote gate, not assumed from the build configuration.

## Download artifact contract and smallest live boundary

Artifact name: `nextcloud-talk-release-9_8-<run_id>`, retention 7 days. Download it into task-owned staging only; never directly onto installed files.

Required contents:

- `source-manifest.json`, workflow commit and release/candidate verification receipts;
- all qualification logs plus terminal `qualification.txt` only when every gate passes;
- `plugin-overlay/`: package-local `dist/*.js` and `.setup/*` closure, canonical projected `package.json` and `openclaw.plugin.json`;
- `plugin-artifact-manifest.json`: SHA256 and size for each overlay file;
- `core-stock-dist/`, `core-seam-dist/` **diagnostic build output only**, without `node_modules` links or dependencies;
- `core-artifact-boundary.json`: stock/seam inventories and every changed/added/removed compiled path.

Minimum intended live plugin operation is to clone the existing official plugin directory in task staging and overlay only the compiled plugin closure plus canonical metadata. Preserve unchanged stock assets, identity, source version/peer floor and trust path. Parent checks emitted imports resolve using the existing host. No runtime dependency install should be needed if parser bundling succeeds.

Minimum intended live core operation is only the compiled runtime deletion containing artifact **and any unavoidable reverse-import filename updates**, with all other imported closure matching stock. The exact number/names cannot be honestly determined from source alone: `tsdown.config.ts` emits core and SDK shared hashed chunks, so one source edit may change a containing chunk and its importers. Canonical builds also emit run stamps/metadata which must not automatically become live swap files.

The downloadable core directories are **not** authorization or a recommendation to replace all core. Parent must trace the changed runtime closure against the actual installed official release and reject unrelated content, broad replacement, singleton changes or unmatched stock dependencies. If the seam cannot be safely narrowed, stop before live activation and report the concrete build result. A rebuilt exact-release chunk is not automatically identical to the official installed build; matching source SHA alone is insufficient.

Only after remote qualification and an installed-stock closure comparison can parent name/hash the actual minimal production swaps, exercise exact dual rollback, and present any remaining explicit artifact approval. This preparation is reviewable, but not deployable and not live-canary proof.

## Proposed packaging-only retry after the approved first run

The reviewed nine-file package was published at `c869e405a308c6034518becd0e98b8ee5b679451` and dispatched once as run `37536769577`. Frozen dependency preparation and both canonical core builds completed. The job then failed at full plugin-patch application: six added-file sections lacked Git new-file headers, producing `error: dev/null: No such file or directory`. No plugin build, generator, Talk tests, changed checks, or profiler ran.

This retry inserts exactly six `new file mode 100644` headers and updates only the patch hash in its source manifest. The 23 candidate source hashes are unchanged; full Git apply/check and duplicate-applied candidate hash comparison pass. The runner recipe is unchanged. The workflow also adds `include-hidden-files: true` to upload-artifact: the first artifact omitted nine hidden compiled/stamp files from each diagnostic core tree, including `.setup` imports, despite their presence in the build inventory. The controlled proof directory contains build output and redacted/public CI logs, not host credentials. Proposed remote writes are only the workflow upload option, this note, the corrected patch, and the updated source manifest on the same disposable branch. A second dispatch is not covered by the earlier single-run approval. No source PR or installed-state changes.

The first core comparison reports 4,997 changed paths (2,293 added, 2,293 removed, 411 modified) including hash-filename cascades and build stamps. These remain diagnostic output, not a minimal live set. The retry does not fix or authorize that live boundary. Installed-stock closure equivalence and minimal artifact-scope assessment are still required before any activation.

## Proposed comment-only correction after run 37538320079

The second approved run at `5f70d7ac925ac75f4cf5601e800181c55ad126f2` built and staged the plugin, generated canonical Talk-only metadata, and passed all 281 tests across 30 files. Hidden compiled-file artifact preservation is now complete: both 7,032-file core inventories and the 16-file plugin overlay verify by SHA256 and size.

The changed-file assertion SAFETY ratchet failed at `extensions/nextcloud-talk/src/inbound.ts` (10 uncommented assertions versus the release baseline of 9). The new synchronous session-store access casts narrower CoreConfig to OpenClawConfig. Proposed correction adds exactly one explanatory SAFETY comment immediately above that assertion: runtime ingress supplies full OpenClawConfig, while the local CoreConfig typing is narrower. No runtime statements, assertions, test expectations, dependencies, or core source change. Only this one source-file hash and its full patch/manifest hashes change. Full duplicate Git application and all 23 resulting file hashes reconcile.

Proposed remote writes are exactly this scope note, the full source patch, and its source manifest; workflow and all other payload files remain unchanged. Publishing and one further CI dispatch require explicit approval. The remaining changed-file/type/lint gates and profiler are still unrun, and the compiled live core boundary remains unproven. No source PR or live mutations are included.

## Proposed exact generated config-baseline update after run 37539676450

Third approved run at `24c7c66a3d9981fec5102a053a6a312824c201a8` passed the source SAFETY ratchet, all 281 Talk tests, 23-file formatting, six doctor-contract tests, canonical bundled config metadata validation, and the preceding boundary guards. It failed config-doc baseline validation: channel count 3,790 versus stock budget 3,786, and channel/combined snapshot hash drift. Remaining type/lint gates and profiler are unrun.

The only added generated schema properties are `mediaAllowFrom` string arrays at channel root and named accounts. Their array containers and item paths account for four channel baseline entries. This is the already-reviewed media admission configuration, not another new option. The config owner calls for canonical `pnpm config:docs:gen`. Source AGENTS explicitly says baseline/snapshot exceptions need approval, so no budget update or generator execution has been performed.

Concrete proposed recipe correction: capture the stock tracked hash/count files; run the release-owned docs generator after candidate channel metadata generation; require stock counts `{core:2473,channel:3786,plugin:4431}`, exact candidate counts `{core:2473,channel:3790,plugin:4431}`, and unchanged core/plugin snapshot hashes. Reconcile all four generated snapshot hash values with bytes and retain the tracked count/hash files and four generated JSON snapshots for review. Feed both tracked generated paths to the unchanged canonical changed-file checker. Unexpected counts or unrelated baseline drift fail closed. No guard bypass, manual hashes, test changes, source PR changes or live artifacts.

Only two proposed remote writes: this scope note and `canary-payload/run-release-ci.sh`. Source patch/manifest, workflow, build command, dependency graph and tests stay byte-identical. Requires explicit approval for this exact generated baseline update plus publishing these two files and one new dispatch. The generated channel/combined hash values will be produced by the canonical remote owner and inspected afterward, not guessed here.

## Approval-gated Matrix test fixture compatibility correction

The fourth qualification passed 281 Talk tests, the exact approved generated config baseline, core graph/type checks and all core-test type shards; extension typechecking found only extensions/matrix/src/test-runtime.ts missing the newly required runtime.media.deleteMediaBuffer field. Proposed correction adds one typed async no-op Vitest mock (three formatted lines) to that existing test-only media object. No Matrix production code, feature, dependency, configuration or installed runtime changes. Shared deletion contract remains required; no optional-property weakening or gate bypass. All preceding 23 source file entries/candidate hashes remain unchanged. Exact source manifest now lists 24 files (+3 lines), with both existing selected Matrix test files hash-bound as unchanged contracts. GitHub runs these two existing fixture/media-failure control suites plus the same complete canonical qualification. No local full build/test or failure-triggered stock rollback. Explicit Matrix fixture permission is required under workspace project boundaries before this payload is applied or published.
