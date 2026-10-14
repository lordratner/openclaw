# Shipped budget flow and stable-produced state compatibility

Exact budget source: `cf4186f7d2154842b1686961b393d39e243799ef`.

[Installed workflow](https://github.com/lordratner/openclaw/actions/runs/38571498083) passed in 5m38s, reusing the identical canonical package from [run 38515883196](https://github.com/lordratner/openclaw/actions/runs/38515883196). Package SHA-256: `e1eeae94bc8b6635f1cfb712f7913754e90b26863498591ed7637ae03c8bce29`. The earlier run failed overall; its passing package and fresh Gateway pilot are retained component evidence, not a claim that its failed installed scenario passed.

The actual installed CLI invokes the real Gateway and stock Codex 0.160.0. Model inference is supplied by a credential-free synthetic loopback Responses endpoint; the host auth fixture uses an explicitly public dummy value. This proves host behavior, not paid/live-provider capacity. Native binary is an explicitly configured official 0.160.0 command in an isolated helper prefix, not automatic binary discovery.

## Observed boundary values

- Authored cap: **400,000**. New installed turn: assembly **347,662**, durable commit **347,662**, post-commit maintenance **347,662**.
- Accepted turn held after the idempotent plugin effect: queued **347,661**, fresh-process replay **347,661**, effect status **duplicate**.
- New post-restart turn: assembly/commit/maintenance **347,660**. Post-turn witnesses exclude bootstrap and the replayed advancement key.
- Four distinct durable plugin effects; zero remaining outbox rows.
- Published stable **2026.10.3** created a real conversation and legacy ready row without runtimeSettings. Candidate **2026.10.2** at the exact source commit reopened the same state after its existing shipped Doctor migrations. All three old decoded transcript entries and the existing session identity survived; old conversation content reached post-switch native input. Legacy recovery did not invent missing settings.
- Actual initial/post-stable/post-Doctor authored policies are strictly equal. An explicit empty inherited-default main roster is valid in both versions; no configuration comparison exceptions were introduced.
- Active Codex was checked as loaded, bundled, version2026.10.2, beneath the installed candidate directory; source hash and build identities are recorded.

## Scope boundary

The candidate has a lower declared package version but forward state/agent schemas. This is **latest-stable-produced state -> exact patched-source installed runtime compatibility**, not a normal higher-semver `openclaw update` test, rollback certification, live-operator canary, real model capacity discovery, or maintainer approval. No production installation/configuration/data/Gateway was changed.
