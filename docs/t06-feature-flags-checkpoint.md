# T06 — v1 boolean feature gates

Baseline `c7129cd`; eleven allowlisted switches. Deployment evidence is recorded in the PR and workspace plan after rollout; this document describes the contract, not a claim that unverified changes have shipped.

## Scope
- Additive migration 028 seeds optional features off; advanced editor/upload on **only** for staff with `stories.write`, MFA and a valid admin lease. Turning a flag on never adds a permission or changes existing RLS ownership.
- `gamification`, `story_drawing`, `book_scan`, `expert_review`, `branching_stories`, `vocabulary_quiz`, `multilingual`, `advanced_authoring`, `ai_illustrations`, `ai_ambience`, `child_push`.
- Core Vietnamese home/library/AI-story/narration/voice recording and licensed-file ambience stay available. Generated ambience is separate from playing an existing licensed file.
- Unknown/malformed/missing flags are off. Catalog errors return sanitized 503; no fail-open fallback. Public catalog contains booleans only; authenticated capabilities are recomputed using existing permission RPCs.

## Enforcement
- Client provider resets capabilities on auth identity changes, discards stale responses, refreshes on focus/every 20 seconds while visible. Off screens do not mount; a revoked open screen becomes unavailable after refresh. Network-offline clients cannot promise an immediate server switch refresh; new server work remains denied.
- Optional `/<screen>` and `/?screen=` URLs validate a known registry entry, authenticated caller and current switch on the server. Editor/upload additionally check `stories.write`. Unknown and denied routes return 404.
- Paid optional APIs check the switch after auth but **before handler/quota/meter/provider**. Explicit non-Vietnamese `language` is checked too; this is a request contract, not language classification of arbitrary text.
- Narrow exception: `voice.preview` with verified `voices.manage` may audition foreign-language admin catalog while the family multilingual flag is off. It does not bypass translation/TTS or grant all staff a paid-feature bypass.
- Gamification/push raw tables have restrictive RLS. Push subscription/send stop when off. The narrow `unsubscribe_push` RPC checks the authenticated owner and can delete only their endpoint even when SELECT is disabled.
- Advanced authoring gates tools, URLs and affordances; it does not revoke a family's existing ownership rights to core story persistence/audio metadata. Full versioned authoring/safety workflow remains T14/T15/T16/T18.
- Stored language preferences, existing stories/audio/choices, real provider keys/models/default voices and MFA are not overwritten. A non-vi story remains stored but is not played/generated while multilingual is off. Scan-to-editor cannot send a family into a staff-only tool.

## Admin changes and audit
- Dedicated switch controls use A15 confirmation and a 10–500 character reason. RPC locks the row, compares expected value and changes a boolean atomically. Stale state conflicts (409); no-op creates no duplicate audit.
- `settings.write`/MFA/lease apply to RPC and direct mutation. Flag namespace/key/category/secret/label metadata are protected. Allowlist CHECK rejects invalid/null booleans.
- Dedicated DB trigger writes one `flag.update` per actual change, including SQL maintenance; generic settings trigger skips flags. Failure to log rolls back the change. Audit is still append-only. Public capability polling performs no writes or audit spam.
- Provider settings bulk-save excludes `feature.*`; only the dedicated flag operation handles changes. Flags are not secrets. `% rollout`, household targeting and scheduled changes remain A11/T08.

## Validation and rollout
- Unit: parse/defaults, capability allowlist/fail-closed, all optional paid gates before handler/spend, BYO/multipart, locale and narrow admin preview, cross-site/auth and authoring permissions.
- DB: RBAC/AAL1/expired lease, reason/unknown/null key, metadata/namespace protections, optimistic conflict/idempotency, one audit, raw-table RLS and disabled owner-only push cleanup.
- E2E: isolated serial flag project after legacy/performance/secret-scan coverage; default-off URL/query/API/core checks, admin reason dialog, open-screen revocation, family/editor/AAL1 denial and conflict/injection checks. Legacy fixtures explicitly opt features in; this does not change production defaults.
- Before rollout: lint/typecheck/full unit+DB/build/E2E, exact-head CI, fresh DB backup with TOC verification, real staging migration BEGIN/ROLLBACK dry-run. Deploy exact verified tree; verify migration/defaults and real settings/provider/default-voice/MFA fingerprints; scoped QA users cleaned, immutable audits kept.
- Emergency off: manager switch/RPC. SQL maintenance remains audited. Code rollback must be reviewed against the additive schema and client/API behavior; do not remove audit history or feature data.

## Research / next slices (not part of T06)

- R01: Fish billing units are UTF-8 bytes of submitted text; the baseline ledger uses Unicode characters. Version usage/price-unit snapshots; no byte rates on historical character rows or guessed spend. Prompt cached-token pricing remains a separate contract.
- R02: spoken-text normalization/versioned scoped pronunciation dictionary, display text unchanged; Vietnamese human listening evaluation.
- Hybrid library: fixed curated narration + whole-sentence personalized intro/outro; SFX/ambience separate; tenant-safe immutable manifest, idempotent render jobs, private assets and export/restore drills. No claim that arbitrary name replacement in an existing MP3 is free or seamless.
- Preserve T06 → T08 and consent/safety/review gates. No paid benchmark or real provider/default-voice changes in this work.

Sources: https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits ; https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning ; https://supabase.com/docs/guides/self-hosting/restore-from-platform .
