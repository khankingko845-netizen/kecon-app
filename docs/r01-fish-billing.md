# R-01 — Fish UTF-8 usage and price versions

## Contract
- Fish TTS bills UTF-8 bytes of the **submitted text**, after the existing unsupported-tag stripping/trim step. Count neither JavaScript UTF-16 length, Unicode character count, JSON envelope bytes nor MP3 bytes. Do not add Unicode normalization or alter display text in this patch.
- `fishSubmittedText` is shared by payload serialization and the billing counter; usage version 2, `billing_unit=utf8_bytes`. App quota (per 1,000 text characters) and key-pool character statistics are separate existing product rules, not provider billing; unchanged.
- Meter writes before outbound HTTP, one row per attempt/retry. Fish metadata without the v2 byte contract fails closed. No text, voice ID, prompt, response, API key or error body is stored in the ledger.
- Fish rates require explicit `utf8_bytes` and price version 2. UI input is USD / **1 million UTF-8 bytes**, converted to per-byte USD (12 decimal places); zero requires an explicit compatible rate. No default rate is seeded, including free-model prices. Tiny prices beyond supported precision are rejected rather than silently becoming free.
- Existing non-Fish units/LLM token estimates continue their v1 contract. Cached-input/cache-write token pricing is a separate pending slice, not implemented here.

## History and migration 029
- Additive billing unit/version columns; legacy rows remain usage version 1 and unlabelled. No historical usage, raw estimated cost or JSON price snapshot is recalculated, rewritten or guessed from text that was intentionally not retained.
- Legacy Fish character estimates are excluded from effective aggregate cost and included in unknown coverage. `legacy_unit_attempts` explains why; raw history remains intact. New byte usage with an old/unlabelled rate also remains unknown. A compatible explicit zero is different from unknown.
- `set_ai_price_v2` enforces existing `settings.write`, MFA/admin lease and source/schema constraints at DB; existing trigger writes exactly one atomic pricing audit. The old RPC remains available for non-Fish but rejects Fish to prevent silent downgrade/ambiguous prices. Raw ledger remains service-only; direct staff price mutation is revoked.
- No household identifiers, feature rollout, pricing seeds, real key/model/voice edits, safety/consent bypass, pronunciation/model upgrade, archive/GC/export or paid benchmark in this slice.

## Release gates
- Unicode Vietnamese NFC/NFD, emoji, stripped/unknown tags and exact provider payload contract; old/missing price, explicit zero, retry and no secret/body leakage.
- Migrate legacy fixtures first then 029: preserve raw history, quarantine incompatible aggregate estimates, reject mismatched unit/version/snapshot, verify MFA/permission/direct-access/audit.
- Full unit/DB, typecheck/lint/build, full E2E and exact-head CI. Isolated Fish E2E uses the hermetic fake provider after feature flags; no live paid call.
- Fresh verified DB backup and real migration BEGIN/ROLLBACK dry-run before rollout. Deploy exact merge tree; staging uses supported Webpack build after the observed Next 16.2.6 Turbopack font-resolver failure.
- Scoped QA tests new pricing APIs and aggregates without calling real Fish/ElevenLabs. Remove QA users/rates/ledger rows, retain immutable audit, restore browser cookies. Compare real settings/pool/default voices/MFA and pre-existing history/price values.
- Application rollback leaves additive columns; old Fish requests would be legacy/unknown and old Fish pricing rejects. Do not drop audit/history or apply byte prices to old usage. Exact rollout evidence is recorded in PR/workspace after verification.

Source: https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits . Published pricing is not an account-specific bill; enter only verified rates.
