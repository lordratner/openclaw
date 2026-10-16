# Scoped review-fix qualification resume

Bound source: `303b40cfe25aef9012e3c8c1d20e23a63ba70c7f`.
Retained package: `1fe7654c3d26f9d9248f94b05fdbdb7bce5d4d20`, SHA256
`20de681bac90f901406d5149f0da8fcf2520424ac9a79b7d34bb17a0c56e8a0f`.
Original producer38924024210 remains **failed**; only its individually proven
passing work is retained. Its QA head and exact actual gate outcomes are pinned.

`resume.yml` checks out the new source and fork-only tools. `proof.py` admits only
the two exact fixture replacements, all12 other identical feature files, a
whole-repository commit delta consisting solely of that test, unchanged official
core, known raw old failures and99 actually passing messaging cases. It verifies
all14 original/review negative assertions, including clipped Vitest diagnostics.
The changed test must be absent from the retained runtime tarball.

Fresh checks: affected formatting/lint, runtime prerequisites,35 automatic/auth
cases, test types, three original automatic missing-upload controls and three
reviewed-source automatic compatibility controls. No repeat package build,
production-types run, docs run or99-case messaging run.

Final PASS requires every actual fresh `steps.*.outcome` plus revalidated retained
bindings. The new artifact preserves old raw evidence under `retained-producer/`,
old package manifest separately, new13-file formatted manifest, actual fresh
outputs and both source/package commit identities. `verify.py` is also required
by `../upgrade/admit-package.py`; publish it alongside these recipes.

Prepared locally only: syntax checks and read-only validation against existing
failed-run artifacts passed. No product tests/build/install/CI/ref/review/canary
execution occurred during preparation. Parent owns publication and dispatch.
