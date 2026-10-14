# Context-policy review for the selected-history carrier

**P0 policy callout:** new text items can exceed 1,000 estimated tokens (8,192 UTF-8 text bytes, approximately 2,048 native estimated text tokens). A default-detail image item also exceeds that threshold. Codex's [model-visible-context code-review rules](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/AGENTS.md#L91) require an additional manual review. **No human maintainer/owner approval is claimed.** This report records the contributor's context-contract inspection for that review, not permission to merge.

## Contract assessment

- The carrier uses existing public `thread/inject_items` and existing typed `ResponseItem::Message` user items. It does not add a native Rust fragment type, change native core, or fabricate developer/tool authority. Raw-parser acceptance, image validation and checkpoint acknowledgment are stock native operations.
- Each text item is capped at 8,192 UTF-8 bytes including quoted provenance; valid surrogate pairs are not split. The estimate is not a paid-model tokenizer measurement or automatic usable-capacity discovery.
- Each image item carries one unchanged supported image with short quoted provenance and no detail override. The pinned native default-image estimate is 7,373 bytes (about 1,844 estimated tokens), separate from encoded transport bytes. Native frame/host-image transport caps still apply. Original-detail patch accounting is not substituted.
- Every fragment explicitly describes its contents as quoted historical material, not a new request/instruction. Current input remains a separate ordinary user message; native explicit skill/app invocation sigils in historical text are neutralized by the existing projector.
- Per-turn quotes append under the existing idle warm/resume owner; no native history rewrite or routine replacement. Same-epoch bootstrap ownership remains stable. Unknown reused acknowledgments clear the matching host binding without deleting the native transcript; crash-before-inference repeated quotes remain an accepted documented tradeoff, not an exactly-once claim.
- Frame/message overhead is reserved before assembly. The new restoration correction uses one resolved allowance for both engine selection and projected restored text, labels, separators and image estimates. An over-budget expansion rejects before native effects, rather than silently clipping selected history. Intrinsic host file-extraction limits/dispositions remain host policy.

## Review provenance and boundaries

Independent coding-agent source inspections assessed UTF-8 bounds, image/default-detail semantics, incremental continuity, ordinary fallback, acknowledgment uncertainty and real-media restoration. The actual installed public CLI/Gateway proof uses official stock Codex 0.160.0 and synthetic Responses; no operator data/configuration or paid model credentials are used.

The native AGENTS text is located under **Code Review Rules / Crate API surface / Model visible context**. This integration does not modify that repository's crate surface; it uses the maintained public protocol. The >1,000-token callout is nevertheless explicitly presented for the OpenClaw maintainers' additional context review. Maintainers decide whether the chosen bound/default-image policy is acceptable before merge; contributor and automated reviews do not impersonate that decision.
