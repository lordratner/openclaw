# Quoted replies layered onto the exact10.3 daily attachment canary

Status: source/recipe prepared only. Source identities in SOURCE-FREEZE.json; raw inputs in port-manifest.json, prior daily source in attachment-source-manifest.json. GitHub qualification is pending, and no live activation is authorized by this source preparation.

## Narrow composition

- Exact release59cb44796b0f1f0daa0e37af8b1495abb45d9bc1; quote reference PR178077 head8243d25dc84a6328869d6c36890eb5629791fcce.
- Eleven previous attachment files copied from producer38940720388 formatted artifact and independently SHA-verified against its source manifest.
- Four untouched release owners added: types, webhook-spool-state, webhook-spool, webhook-spool.test; exact release hashes verified.
- Six files differ from the daily attachment source: four production quote owners and two distinct test boundaries. Nine prior attachment paths remain byte-identical. No new module, package/lock/config schema/manifest/core/SDK edit.

##10.3-specific adaptation

Keep release resolveChannelInboundRouteEnvelope and raw command/media semantics, not newer-main async media retrieval/envelope behavior. Add only one optional signed parent parser and reviewed visibility/ReplyChain logic. Snapshot contextBinding for reuse after new asynchronous access-group expansion, revalidate ingress/current sender, check cancellation and current command authorization before context. All older non-quote behavior remains.

Reuse existing public10.3 filterChannelInboundQuoteContext, resolveInboundSupplementalSenderAllowed, resolveChannelContextVisibilityMode and expandAllowFromWithAccessGroups. Pinned full helper owners/contracts are stored under contracts/ for independent review; they are not source overlays or dependencies. New public helper calls use cfg:config without assertion casts; historical release casts remain unchanged.

## Qualification and remaining work

Expected105 positives (83 existing plus22 quote regressions),14 attachmentnegativecontrols,2 quote-specific failures plus5 passing optionalquotecontrols. Fresh CI formats and records its actual source; root inspects formatted diff and exact artifact before installedGateway proof. Complete process/approval/live steps belong to root. Do not publish or install these files directly.
