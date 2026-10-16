# Fork-only installed compatibility qualification (candidate recipe, NOT EXECUTED)

Scope: close the missing **paired PR core + plugin** fresh-install and latest-stable-to-paired-candidate upgrade evidence for PR135895. These files are QA-only, not PR product changes, live activation tools, or a compatibility promise for a plugin on older hosts. They do not replace the accepted transport/cancellation cleanup evidence and do not engineer another cancellation race.

**Status:** executable fixture/assertion pieces prepared; orchestration and runner qualification pending. No local build/test/dispatch occurred. There is intentionally no aggregate PASS wrapper.

## Immutable inputs supplied by parent workflow

- Exact PR head/tree + affected-source manifest; canonical built/packed host artifact from that source, with `dist/extensions/nextcloud-talk` from the same source. Source-bind plugin manifest, package metadata and built files; record both package identities and tarball SHA256s. Do not use the separate 2026.10.3 backport/seam canary or its proof as this paired PR artifact.
- Resolve npm `openclaw@latest` once on GitHub, save exact version/integrity/tarball, then use that exact baseline throughout. Verify its matching official Talk package is available. A missing matching baseline is a FAIL/blocked prerequisite, not fallback permission.
- Canonical build entrypoint `pnpm build:package`; extension build owner `node scripts/lib/plugin-npm-runtime-build.mjs extensions/nextcloud-talk`. Use canonical packager/CI source guards, not ad hoc tar creation. These commands are instructions for the GitHub producer, not commands to run on the live host.
- Candidate packaged bundled Talk should be selected through `openclaw plugins install nextcloud-talk`, preserving built-in official origin. Verify actual `plugins inspect nextcloud-talk --runtime --json` trust/source/root before declaring readiness. If this artifact does not include a selectable paired bundled package, STOP and supply canonical prepublish registry: `scripts/e2e/lib/prepublish-plugin-registry.sh` / `scripts/prepublish-plugin-registry-artifact.mjs`. A local plugin tarball/`plugins.load.paths` is not interchangeable official trust; do not modify a trust DB, bypass consent, or rewrite install records.
- Reuse repository mock model `scripts/e2e/mock-openai-server.mjs`, launched with its required `--import ./scripts/tsx.mjs` when necessary, `MOCK_PORT`, `MOCK_REQUEST_LOG`, synthetic `OPENAI_API_KEY`. Reuse `applyMockOpenAiModelConfig` in `scripts/e2e/lib/fixtures/mock-openai-config.mjs`; don't reimplement Responses/SSE.
- Isolated ephemeral state/prefix/workspace under `$RUNNER_TEMP/nextcloud-compat-*`; use canonical state isolation helpers from `scripts/lib/openclaw-e2e-instance.sh`. Unique loopback ports. Never source/export production config, mounted state, tokens, credentials or real senders. Assert effective config/state paths lie under runner temp before invoking CLI. Child shutdown applies only to these fixture PIDs/containers.

## Synthetic service

Start `fake-nextcloud.mjs` with `QA_ARTIFACT_DIR=$RUNNER_TEMP/nextcloud-compat-<run>/...`, optional fixed `QA_NEXTCLOUD_PORT`, and `QA_WEBHOOK_URL=http://127.0.0.1:<isolated-gateway>/nextcloud-talk-webhook`. It binds only loopback, writes `nextcloud-ready.json`, and supplies:

- signed outbound bot message/reaction verification + genuine response receipt (reaction acknowledgments are not counted as replies);
- authenticated OCS canonical user, direct-room metadata, bot feature preflight;
- authenticated exact-message history, WebDAV PROPFIND file identity and real PNG bytes;
- bounded request log without Authorization headers; unknown routes fail visibly;
- fixture-only history registration via loopback `/__qa/events` before signed webhook submission.

Keep service/model process running across the upgrade so endpoint settings remain unchanged. Use accounts.default with `baseUrl` from nextcloud-ready, `botSecretFile` containing `nextcloud-compat-fixture-only`, `apiUser: qa-bot`, `apiPasswordFile` containing `qa-password-fixture-only`, `dmPolicy: allowlist`, `allowFrom: [users/alice]`, `groupPolicy: allowlist`, `groupAllowFrom: [users/alice]`, the exact webhook path, `legacyWebhook: false`, and `network.dangerouslyAllowPrivateNetwork: true` **only in this isolated config**. The schema key is **`botSecretFile`**, not `secretFile`; accounts.secretSource may report the label `secretFile`, which is not a config property. Set `webhookPublicUrl` to the exact `QA_WEBHOOK_URL` if running the bot feature probe. No `mediaAllowFrom` before upgrade. Use actual baseline CLI config mutation/validation to author settings (file secrets are synthetic, not protected real credentials). Confirm exact flags via that CLI's help; do not invent unsupported flags. Fixture media is a real 1x1 PNG, not a stubbed media runtime.

## Leg A: fresh paired install

1. Install exact candidate tarball in isolated prefix through actual package installer, then select its matching official/bundled Talk using installed CLI. Configure via public installed entrypoints, validate, start foreground isolated Gateway. Save CLI health, runtime plugin inspection, version/root and source/artifact proof.
2. No media key: send unique text event; require provider receipt + outbound Talk response. Send unique image with caption; require caption delivery but **zero authenticated media downloads and zero provider image content**.
3. Use actual candidate CLI `config set` to set root `channels.nextcloud-talk.mediaAllowFrom` to `["users/alice"]`; validate/read back. Await channel generation ready before sending new image ID/caption. Assert exactly one authenticated image download and real PNG at provider + outbound reply. Preserve account sender lists exactly.

## Leg B: real stable-created data -> candidate

1. Separate isolated prefix/state/workspace. Install exact pinned published stable and matching official stable Talk through actual entrypoints; configure synthetic account **without new media key**, validate/start. Send baseline text via signed webhook and wait actual provider + outbound reply. Export public session list and find actual Talk session key/ID; do not invent rows/opaque state. Export public channel config JSON. Create a sentinel authored workspace file via normal filesystem write; save its hash.
2. Stop only isolated baseline Gateway, perform actual host/package upgrade to exact candidate using canonical installed update path. Example harness owners: `scripts/e2e/upgrade-survivor-docker.sh` inputs `OPENCLAW_UPGRADE_SURVIVOR_PUBLISHED_BASELINE=1`, `OPENCLAW_UPGRADE_SURVIVOR_BASELINE_SPEC=openclaw@<resolved>`, `OPENCLAW_CURRENT_PACKAGE_TGZ=<bound candidate>`, candidate matching prepublish registry if required. The default survivor recipe does NOT configure Talk; extend QA fixture plumbing explicitly or compose a targeted fixture runner, do not claim its default PASS closes this gate.
3. Start installed paired candidate using same state/config/workspace, verify health/Talk ready/trust + matching installed plugin bytes. Export channel config and public session list again. Run config-survived and session-survived; verify sentinel hash. **Do not compare SQLite file bytes:** actual upgrade/turns legitimately mutate canonical stores.
4. Send post-upgrade text into same room; require provider request contains unique new marker and baseline conversation marker, with same public session identity. Then perform closed-media and explicit opt-in cases from leg A. Save before/after exact sender settings and assert no broadening.

## Executable probe surface

Set `QA_NEXTCLOUD_ORIGIN` and `QA_WEBHOOK_URL` to loopback fixture/Gateway. All IDs numeric and unique per leg/phase.

```bash
node qa/compatibility/assert-evidence.mjs checkpoint "$cloudlog" "$modellog" "$phase_checkpoint"
node qa/compatibility/send-webhook.mjs text 81001 "compat-baseline-<run-id>"
node qa/compatibility/send-webhook.mjs image 81002 "compat-denied-image-<run-id>"
node qa/compatibility/send-webhook.mjs image 81003 "compat-allowed-image-<run-id>"
node qa/compatibility/assert-evidence.mjs delivery text "$phase_checkpoint" "$cloudlog" "$modellog" "$unique_caption"
node qa/compatibility/assert-evidence.mjs config-survived "$before_channel_json" "$after_channel_json"
node qa/compatibility/assert-evidence.mjs session-survived "$before_sessions_json" "$after_sessions_json" "$actual_talk_session_key"
```

Use a new checkpoint and wait for one completed current reply per phase before assertion/next phase. `send-webhook` confirms HTTP admission only, deliberately never delivery. Candidate durable admission header can be independently required by parent. Provider log assertions use canonical mock `contentFacts` PNG byte count and unique caption. They do not alone prove byte-for-byte PNG identity at provider; preserve existing accepted transport/hash proof for that claim. They do not prove cleanup, downgrade, stock-host support, or upstream full CI success.

## Required parent integration before running

- Actual archive installation/update sequencing and installer flags validated against both installed versions; no implementation guesses about baseline migration.
- Paired packaged plugin selection/trust probe, live config generation readiness and canonical Gateway startup/readiness helper.
- Bounded completion wait/readback for each phase; process cleanup/traps.
- Public session export command/shape validated; exported objects require actual `key`/`sessionKey` and `sessionId`, otherwise fail and adapt assertion to the verified public shape.
- Explicit baseline-marker retention assertion on post-upgrade provider request; sentinel hash assertion; sender-list preservation after opt-in.
- Immutable source/artifact/registry attestation before aggregate qualification.

Until these gates are implemented and run on GitHub, report **prepared, not qualified**. Current host/plugin version strings both read2026.10.3, so do not invent a future floor or relabel a paired candidate as a published release. Release-owner compatibility floor/API acceptance remains separate.

## Read-only wire-contract audit (candidate source; not execution)

- `src/monitor.test-fixtures.ts`, `src/webhook-spool.ts`: Create text requires Person/Note/Collection string identities; file Activity Note.name=message with JSON content `{message,parameters:{actor,file}}`. Script identities are `users/alice`, matching history actorType=users + actorId=alice. `object.id` is the exact numeric string used by history's lastKnownMessageId.
- `src/signature.ts`: inbound HMAC SHA256 signs `random + raw JSON body`; backend origin must equal account baseUrl.
- `src/accounts.ts`, `src/config-schema.ts`, `src/api-credentials.ts`: schema fields `botSecretFile`, `apiPasswordFile` (same in release source); synthetic files must be regular files, with bot secret symlinks rejected. Do not translate diagnostic source labels into keys.
- `src/bot-preflight.ts`: authenticated GET `/ocs/v2.php/apps/spreed/api/v1/bot/admin`, OCS data array, bot.url exact callback match, response flag2. Fixture declares webhook1 | response2 | reaction8 (=11), matching owner tests.
- `src/room-info.ts`: authenticated GET `/ocs/v2.php/apps/spreed/api/v4/room/<room>`, OCS data.type1 establishes a direct room.
- `src/inbound-media.ts`: authenticated cloud-user GET, exact chat history message/file metadata, PROPFIND returns **207** with exactly one fileid in `http://owncloud.org/ns`, then authenticated GET returns real image/png bytes. File path includes Talk/compat.png; link remains same-origin /s/<token>.
- `src/send.ts`: POST bot/<room>/message signs the JSON `message` string only; POST bot/<room>/reaction/<message-id> signs `reaction` string only. Fixture verifies those bindings, never signs the full outbound JSON.
- Canonical mock `scripts/e2e/mock-openai-server.mjs` logs `body` as a bounded string and `contentFacts` with input_image mimeType/byteLength. Assertions fail if `contentFactsTruncated` is true; outbound reaction is not sufficient delivery evidence.

Fixture implements these actual Talk HTTP owner paths only; any newly observed unknown route is an explicit failure needing source inspection, not a successful catch-all response. No real server, ambient secret, older-host shim or hidden API is used.
