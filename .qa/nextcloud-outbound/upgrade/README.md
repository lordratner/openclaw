# Existing-installation proof recipe (local, unbound)

This is fork-only proof tooling, not a canary/deployment recipe. No workflow was
published or dispatched while preparing it. Parent owns review, binding and use.

## Bind before use

Publish these files beneath `.qa/nextcloud-outbound/upgrade/` and bind
`EXACT_PRODUCT_SHA` and `QUALIFIED_RUN_ID` in `upgrade.yml` only after the exact
candidate's producer is terminal successful. Both jobs independently admit that
run, its PASS receipt, every actual producer gate, empty formatter delta,
source-manifest hash, package SHA256, package build commit and bundled Talk/OpenAI
runtime entries. Placeholders fail closed. One explicitly bounded retained
package is supported: source303b40 uses package1fe7654 after exactly two test-only
repairs. Admission independently checks the resume guards/raw evidence, original
failed producer38924024210, all12 unchanged source hashes, exact test delta,
package-source manifest, pinned package bytes and fresh35-case/six-control proof.
The old failed job stays failed; the new successful resume owns qualification.
No arbitrary older-package or unverified byte-equivalence claim is accepted.

`upgrade` and `native` use separate GitHub runners and disposable official
Nextcloud35/Talk25.0.6 containers. Both jobs must succeed. `native` runs the
existing `real-nextcloud.mjs`/`automatic-nextcloud.mjs` unchanged, with the
candidate checkout's canonical model helper and the same admitted package.

## What the upgrade job actually does

1. Download and install the actual published `openclaw@2026.10.4`, with pinned
   registry SHA512 (also confirmed by official release postpublish evidence).
2. Install the actual official managed `@openclaw/nextcloud-talk@2026.10.4` through
   `plugins install npm:@openclaw/nextcloud-talk@2026.10.4 --force --pin` and verify
   its official registry integrity/version and state-owned root. Official core4
   does **not** bundle Talk; it does bundle OpenAI. Then create one bot-only
   configuration, protected bot-secret file,
   authored workspace sentinels and real Talk room. No API-account fields are
   configured in the app. The harness's fixture API user is separate.
3. Send the immutable public LICENSE URL through the installed stable CLI and
   automatic Gateway; validate real bot-message observations, exact completed inbound
   turn, done/inactive session and a real signed durable webhook.
4. Stop only the owned Gateway, snapshot settings/secret/authored-workspace
   hashes, install the admitted candidate into the same prefix, and assert the
   installer did not change those files. No state reset or plugin reinstallation.
5. Record preselection metadata, then explicitly use the supported public command
   `plugins install nextcloud-talk --force` to select the candidate's paired Talk
   bundle. Record the old npm owner and new `source:path`/exact bundled install
   path. This is an explicit plugin-source selection, **not** an automatic
   core-only cutover. The new host canonically materializes the legacy
   `agents.defaults.models` restriction into `modelPolicy.allow` and adds the
   `modelPolicyAllowlist`/`utilityModelSeparation` migration markers. Assert those
   exact derived additions, unchanged explicit main/utility choices, and every
   other authored key including channels/plugins/model maps. Only the config
   writer's `meta.lastTouchedAt/lastTouchedVersion` stamps are excluded. Secret
   and authored-workspace hashes remain exact. No direct
   install-record edits, manual plugin deletion, load-path rewrite or state reset.
   With the owned Gateway stopped, back up the stable-created agent database
   through SQLite's backup API and record schema/session identities read-only.
   Run the documented candidate command
   `doctor --fix --non-interactive --no-workspace-suggestions`: schema24 migrates
   canonically to27. No manual SQL, fresh state, ID remapping or session reset.
   Require unchanged session-key/current-session-ID pairs, exact authored-config
   semantics above, secret/workspace hashes and selected plugin install owners.
   The doctor child alone uses the supported service-repair policy
   `OPENCLAW_SERVICE_REPAIR_POLICY=external`, preventing service installation,
   start or restart. Doctor is the full repair owner, not claimed DB-only; these strict
   postconditions reject unrelated state/config/source-selection changes.
   Validate existing settings and actual runtime selection; repeat CLI/Gateway
   URL delivery in the same room and stable-created session. Preserve old bot
   message IDs and session ID. Require both exact successful completions.
6. Reject local, relative, file, data and embedded-credential media references
   without any visible message. Require no false missing-answer notice, and no
   local reference/fixture credential/private configured endpoint in bot text.
7. A recording proxy observes all app-to-Nextcloud requests: bot-only phases must
   have no Basic auth, DAV/upload or share API request. Actual room shares and
   native-file messages must also remain absent. Harness setup/readback bypasses
   this proxy and cannot falsely count as plugin API use.
8. With `RUN_CONFIGURED_NATIVE_CONTROL=true` (the checked-in workflow choice),
   deliberately add synthetic API credentials only after preservation assertions.
   CLI-send a native PDF replying to the existing bot message, verify actual chat
   receipt/read-only room share and recipient byte equality. This final optional
   control is CLI-only; its signed echo is recorded but not forwarded to a stopped
   Gateway. The independent `native` job owns full automatic/echo qualification.

Legacy Talk bot sends return HTTP201/null, so their CLI receipt can legitimately
say `unknown`. URL phases preserve that receipt separately from the observed
chat ID: correlate a fresh nonce, exact message/room and bot identity obtained
from its HMAC-verified room-Join callback. Require one match; when a concrete CLI
ID is returned it must equal that observation. Native-file receipt equality is
unchanged and remains mandatory. The initial failed upgrade oracle is retained
at run38930252668; it stopped before automatic delivery or migration.

Run38931725973 then qualified stable CLI/automatic delivery and exact raw config
preservation across core installation, but its comparison wrongly rejected the
canonical host migrations above. The refined oracle constructs that exact
expected config and deeply compares all keys; it does not mask subtrees or
silently claim unchanged config bytes after a migration. Canonical owners are
`src/config/model-policy-allowlist-migration.ts`,
`src/config/utility-model-separation-migration.ts` and `src/config/io.meta.ts`.

The model mock uses separate explicit main/utility identities, stable canonical
config helper, minimal canonical Responses SSE events and no memory search.
No production server, real model, UI interaction, DNS-publicness policy or live
canary is claimed. Credential-free private HTTP(S) links remain legacy text;
this feature does not fetch their bytes when operating bot-only.

## Stable source identity nuance

- Official tag: `383c124cc32ffee3f8e56f549b88da94d269a4af`.
- Actual installed npm core build-info was independently streamed read-only:
  commit `383c124cc32ffee3f8e56f549b88da94d269a4af`, builtAt
  `2026-10-15T17:18:22.749Z`, buildId
  `2026.10.4-release-383c124cc32f-2026-10-15T17-18-22.749Z`.
- npm provenance lists publishing-workflow dependency
  `0f194ea7d8c0a037dcbe53f555e3e8a49d2b7510`, release run38824408033.
  This is **not** the built product source. The recipe requires actual installed
  build-info to match 383c and records 0f194 separately.
- Manual Talk adapter blob at the product source (also unchanged in the workflow
  source snapshot):
  `390d25d235130e24d868302fe745a1ae03a1407a`.
- Canonical model helper blob is identical at both refs and checked before import:
  `cd33a2e801c9f7ee6a559ab36f7daa1b0d8db0a5`.
- Inbound whole-file blobs differ between workflow and product source snapshots
  because route/envelope refactoring differs. The old link-delivery callback is
  unchanged, but those whole-file blobs are not treated as equivalent baselines.
  Runtime proof always executes the actual released package.

Evidence is `upgrade-qualification.json`, per-phase terminal/session snapshots,
before/after hashes, public-file digest, transport/model/webhook observations,
synthetic room history and CLI/Gateway logs. Failed evidence is retained.

## Preparation checks and limits

Only static syntax/structure checks are appropriate before parent binds the
workflow. No install, container, model, Gateway or CI execution occurred locally.
The recipe is not qualified until its actual bound GitHub run succeeds. It may
surface a real released-package/setup or migration defect; do not weaken oracles
or relabel an unexecuted/failed phase as passing.

Run38933333660 passed the exact config migrations and paired runtime selection,
but correctly stopped at candidate boot: stable agent schema24 requires offline
`doctor --fix` before schema27 can start. That failed packet remains preserved;
the recipe now performs the documented migration on its stopped disposable
fixture only. The live installation is not upgraded or migrated. Existing strict
Gateway session-ID and room-history preservation assertions remain unchanged.
