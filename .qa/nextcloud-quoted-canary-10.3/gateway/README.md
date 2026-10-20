# Exact-10.3 composed quoted-reply Gateway proof

This is a **GitHub-only disposable proof recipe**, not an activator or production test. It installs the official `openclaw@2026.10.3` npm package, requires build commit `59cb44796b0f1f0daa0e37af8b1495abb45d9bc1`, then uses the actual CLI to install official managed `@openclaw/nextcloud-talk@2026.10.3`. It overlays only a previously qualified composed plugin `dist/`; no source/core/SDK/package/manifest/config patch is applied. An npm install exists only inside disposable GitHub runner state, never on the production host.

## Root binding required before publication/dispatch

`binding.json` is now bound to inspected successful delta producer39419125625 (QA221d1e9af6445a3a0721a050bf8a94602b062fde). Admission fails closed on different identity or provenance:

- Exact producer run, QA commit, fixed artifact name, source manifest hash, dist archive hash, and raw `qualification.json` hash.
- The exact12-gate fresh/mixed/retained map, expected quote-control failure command labels, per-report counts and raw receipt hash.105 cases means68fresh plus37retained;14 attachment controls and productiontypes are reused under exact unchanged-source/test guards. The initial producer39416877283 explicitly failed only testlint and skipped-case accounting; it is not represented as successful.
- The initial expected artifact name is `nextcloud-quoted-canary-10.3-<run>`; align it explicitly with producer before publishing. No workflow input can override bindings.

Publish these files under `.qa/nextcloud-quoted-canary-10.3/gateway/` on the QA branch. Publish `workflow.yml` as a GitHub workflow and dispatch that immutable QA commit. Admission checks the GitHub run API for matching repository/head, terminal success, receipt hash, all gates with exact evidence provenance and individual test results. The source/compiled manifest and every regular archive member are checked before extraction; links, duplicate/traversal/unmanifested/special entries are rejected. The archive must carry the composed parser legal notices and no external runtime parser import.

## What this fresh full-Gateway proof establishes

One Gateway boot / three sequential signed synthetic Note events in the same room/session:

1. Alice is authorized through existing `message.senders` access group `operators`. Bob belongs to it. Immediate-parent unique nonce and quoted author name must reach actual `/v1/responses` input.
2. The valid current message remains authorized but an outsider's unique quoted content is absent from actual provider input.
3. An ordinary unquoted message still completes.

Ancestor content, unreferenced rich parameters, and unreferenced URL metadata are forbidden in every provider input. The Talk endpoint accepts only signed bot-message POSTs; any parent/history/media lookup or extra route fails. Replies must target the exact current message IDs 201/202/203, not quote-parent101. Each exact ID must receive one completed terminal diagnostic after its pre-trigger log checkpoint; session RPC must report the same room/session done, inactive, without last-run error. Optional 10.3 `endedAt` is checked if exposed; it is not invented if absent. Each inference/send count is exact.

The official install root/trust and install records are checked before and after overlay; the public SDK resolves to the asserted official core. Full official core+dependency-tree inventories must remain byte/mode/link identical. Plugin non-dist package/dependency bytes, modes, ownership, and manifests remain unchanged; shared dist modes are preserved. Authored fixture config is byte-identical across overlay and Gateway execution. PASS is written only after owned Gateway and fixture-server cleanup succeeds.

Artifacts contain raw synthetic webhooks, actual provider payloads, signed-send receipts, current-ID/session terminal evidence, logs, source/dist/producer admission identity, SDK attribution, and cleanup. No real Nextcloud account, network server, model credentials, production Gateway, or production config is used.

## Limits / reuse rationale

This is not a production/client/real-model/real-Nextcloud transport proof, nor proof of the upstream PR head. The actual change is quote-context composition; the unchanged outbound media transport retains prior real-server/recipient proof and fresh focused port controls. A new expensive Nextcloud container is unnecessary for this isolated changed boundary. Final live canary activation, restart and room messages still require the separately prepared concrete approval proposal.

## Preparation status

Files were authored and read back only. No local product test, build, dependency install, workflow dispatch, remote publication, or live/runtime change was performed by this lane. Syntax and execution qualification belong to the eventual GitHub run; root must review and bind first.
