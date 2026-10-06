# Reviewable GitHub-only proposal — not published or dispatched

## Prepared source

- Installed-release source: `fc23bc864e4553c2d215e479eeec47b67a0bf943` (`2026.9.8`).
- PR reference: `fd74a2e849af5f8f65b14361b1368e7eb76c7173`. This is a release adaptation, not that exact PR tree.
- Source patch: `release-canary-source.patch`, SHA256 `dc92fff5b9e85251332031da9bd8232dc42a3f9d3f08603c202892f52ef1bc42`.
- Core-only patch: `release-core-delete-seam.patch`, SHA256 `940b9a76ef154415c9e64ca7a3a20f3568303e5794425d8c147dfa134c6a2cba`.
- `release-canary-source-manifest.json` records all 23 changed-file hashes: 4,764 additions / 27 deletions, predominantly regression coverage. Nothing here is built or tested.
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
