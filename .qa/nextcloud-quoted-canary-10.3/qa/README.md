# Bounded test-only delta after producer39416877283

The initial producer FAILED overall: lint found three missing test braces, and the new negative-proof parser counted skipped assertions as executed. Its105 positive tests, both type lanes,14 attachment negative controls, canonical build and stock-SDK consumer passed. This revision does not call that run green.

The exact prior artifact and completed-failure run metadata are downloaded by immutable run/name, then qualification/source/report/log SHA hashes are checked. Every production path must exactly match the producer formatted source. Only the three enumerated test brace edits may differ, checked by exact old-string-to-new-string transformation; no assertion changes are accepted. Direct37 test files must remain byte-identical.

Retained evidence: direct37 positives,14 attachment negative controls, production types. Fresh evidence: fork68 positives, test types, plugin lint, both quote negative assertions with five passing optional-quote controls, canonical dist and stock-SDK consumer. All other setup/parser/source checks are fresh. Exactly12 gates must pass with declared fresh/retained/mixed provenance. Final qualification has freshOnly=false, qualificationMode=bounded-test-only-delta, totalQualifiedPassingTests105=fresh68+retained37; it names producer39416877283 with conclusion failure.

Source/recipe manifests and publication layout below are unchanged in ownership. The source manifest carries actual canonical formatted bytes. Parent must inspect formatting output, all exact identities and the bounded-retention receipt before admitting the newly rebuilt dist. No previous dist is reused.

## Publisher layout

Publish source/,qa/,paths.json,port-manifest.json,release-manifest.json,attachment-source-manifest.json at `.qa/nextcloud-quoted-canary-10.3/`; publish qa/workflow.yml as workflow. qa/retained-39416877283.json binds exact parent artifacts, passing outcomes and allowed brace transformations. The recipe manifest binds every QA input and root manifest. No source test routing is edited.

## Boundaries

This is exact official2026.10.3 source plus the existing daily attachment canary and payload-only immediate quoted parent. No newer-main inbound retrieval, core/SDK/config/package/lock/schema/auth changes. Parser integrities/notices, prior attachment baseline snapshots and stock-SDK consumer remain pinned. All CI-capable work runs on GitHub; only recipe/source syntax development checks ran locally. Qualification is not a live Gateway activation, restart approval, live Nextcloud proof or an upstream readiness assertion.
