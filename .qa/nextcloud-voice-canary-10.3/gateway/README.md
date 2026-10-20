# Exact-10.3 composed voice Gateway proof

Prepared fixture source only. No product tests, builds, npm installation, or Gateway execution have run on the host. This lane is for a disposable secretless GitHub runner; it is not a production activator.

## What it proves

The recipe checks out exact release commit `59cb44796b0f1f0daa0e37af8b1495abb45d9bc1`, installs official `openclaw@2026.10.3`, and uses that CLI to install official managed `@openclaw/nextcloud-talk@2026.10.3`. It admits the separately qualified composed plugin `dist/` and overlays only that directory. It does not rebuild a moving-main package or replace core, SDK, package metadata, plugin manifest, or dependencies.

The actual installed Gateway/message tool then exercises:

- `voiceText` through the TTS owner, requesting MP3 once and producing native voice metadata/receipt.
- Explicit WAV `asVoice` with caption and reply to the first actual native message ID.
- Ordinary MP3 remaining an attachment.
- OGG `asVoice` falling back to an ordinary attachment.
- Authenticated DAV upload and OCS share/history confirmation against an external loopback protocol fixture, with exact source/upload byte equality, captions, native chat IDs and receipt kinds.
- Existing signed quote-allowlist, excluded-parent, and ordinary text controls through actual provider input and normal settled sessions.
- Exact official core tree, shared SDK attribution, managed root/trust/install identity, non-dist package content, and authored settings remaining unchanged.
- Owned Gateway/server cleanup, with final zero-errors validation after shutdown.

The upstream real Nextcloud/Talk and headless browser proof is separate retained evidence. This lane does not claim a real Talk server/client, paid speech generation, a real LLM, recipient-side byte retrieval, audible/mobile playback, or production activation. Audio is a two-second synthetic tone and model/TTS endpoints are local synthetic fixtures. The media fixture is an external DAV/OCS contract peer, not an import of plugin internals.

## Freeze root-reviewed producer binding

`binding.json` intentionally fails admission until the root replaces the placeholders after qualification. Freeze these fields from the inspected successful producer:

- `producerRun`, `producerQaHead`, `artifactName` (the immutable successful admission producer run/head and exact artifact name).
- `sourceQaHead` identifies the original build/source-manifest head. It equals `producerQaHead` for a fresh normal producer. A validator-only artifact admission may retain a different source/build head only when qualification.json explicitly records the same `builtQaHead`; source-manifest.json must still record that exact source head. This does not reclassify retained tests as fresh or alter source/dist hashes. If `sourceQaHead` is omitted, admission defaults it to the producer head and permits no distinct source head without `builtQaHead`.
- SHA256 of raw `qualification.json`, raw `source-manifest.json`, and `nextcloud-talk-dist.tgz`.
- Exact full `requiredGates` and `gateEvidence` map.
- Nonempty `receiptAssertions` for the producer's semantic claims, such as the exact fresh/retained mode and test counts. There is no hardcoded quote-only qualification mode.
- Exact expected nonzero command labels (negative controls), and positive `testReports` mapping each report filename to suite basename/count. Every bound positive assertion must be passed, with no pending/skipped cases.

Producer artifact contract: `qualification.json`, `source-manifest.json`, `dist-manifest.json`, `nextcloud-talk-dist.tgz`, and the bound positive test JSON reports. The existing producer receipt fields `baselineCommit`, `qaHead`, `noCoreOrManifestChanges`, `parserSourceLinkRemoved`, `sourceManifestSha256`, `distArtifactSha256`, `gates`, and `commands` are used. The compiled parser must be bundled, with the existing saxes/xmlchars legal notices. Root should adapt these schema checks only to an evidenced producer format change, not weaken identity binding.

Archive admission verifies every file's safe path, type, mode, byte length and hash against the dist manifest; links/special entries are refused. The producer run is checked through GitHub API for success/completion and exact head/repository before extraction.

## Root publication and dispatch

Publish the frozen fixture files under `.qa/nextcloud-voice-canary-10.3/gateway/` on the fork's dedicated QA branch. Publish `workflow.yml` as `.github/workflows/ci.yml` on that same QA commit. The workflow checks out product source from the fixed official release, and fixture files from its own immutable workflow SHA. It has no mutable producer inputs: all producer identities are in the frozen binding.

Dispatch the QA branch with workflow_dispatch, then use bounded `gh run watch --exit-status`. On terminal completion download `nextcloud-voice-canary-10.3-gateway-<run-id>`. Inspect raw producer admission, official-install/overlay receipts, four tool responses/audio cases, actual quote provider payloads, terminal session records, and cleanup before claiming success. The workflow permits only contents/actions read and uses no real provider/channel credentials. Its version-bound ffmpeg installation exists only in disposable runner state.

## Preparation checks

`node --check` passed for gateway-proof.mjs, media-fixture.mjs and overlay-dist.mjs. Python AST parsing and binding JSON parsing passed. A YAML parser was unavailable locally, so workflow YAML was not independently parsed here. No dependencies were installed to perform these checks, and no product behavior is claimed yet.
