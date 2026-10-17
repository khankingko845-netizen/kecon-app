# T11 — Server-side, versioned parent consent (migration 042)

Replaces the old `localStorage` consent banner (`ComplianceLayer`, key `kecon-consent-v1`): a family can only use KểCon after a parent accepts the **current version** of the parent privacy policy, and that acceptance is recorded **on the server**.

## Data model

- `consent_documents` — one row per (`kind`, `version`, `locale`); kind `parent_policy`, locales `vi` / `en` / `ja` (only `vi` is seeded; other locales fall back to `vi`). `body_sha256 = sha256(title + "\n\n" + summary + "\n\n" + body)` is computed by a trigger on insert. Rows are **immutable** (UPDATE/DELETE raise `immutable`, even for the owner/superuser path through the trigger) — a new text is a new version. Anyone may read published documents (`published_at <= now()`); clients cannot write.
- `consents` — append-only evidence: `user_id` (cascade with the account), `household_id` (SET NULL), `document_id`, `kind`, `version`, `body_sha256`, `method` (`parent_pin` when the family has a parent PIN and proved it, otherwise `account_holder`), `accepted_at`, `withdrawn_at`, `withdraw_method`, `user_agent` (≤ 300 chars, from the request). **No IP address is stored.** One open consent per (user, document). A guard trigger only allows: withdraw once (`withdrawn_at`/`withdraw_method`), and `household_id` → NULL. RLS: a family reads only its own rows; no client INSERT/UPDATE/DELETE.
- Seeded v1 (vi) "Chính sách quyền riêng tư cho bố mẹ": what is stored, purposes, processors (OpenAI, Anthropic, Google Gemini, OpenRouter, CometAPI, ElevenLabs, Fish Audio), Cloudflare, browser push, encrypted private GitHub backups (7 daily / 4 weekly / 6 monthly → up to ~6 months; family stories are readable inside the private backup repo, DB/recordings/avatars are encrypted), 90-day event retention, rights (export, delete everything, withdraw and its effects), no self-service account deletion yet, testing phase. Written by the team, **not legally reviewed** (T27).

## RPCs (authenticated only)

| RPC | Purpose |
| --- | --- |
| `consent_check()` → boolean | Does the caller hold an open consent to the current version? Used by API routes. |
| `consent_status(p_locale, p_full)` → jsonb | `required`, `has_pin`, current document (full text when required or `p_full`), `accepted`, `previous` (accepted an older version → "Chính sách đã cập nhật"), `withdrawn_at`, `history` (`p_full`). |
| `consent_accept(p_document, p_body_sha256, p_proof)` | Accepts only the exact current document + hash (`stale` + `current_version` otherwise). Families with a PIN need a valid parent proof of the same account (`parent_proof_required`). Idempotent (`already`). |
| `consent_withdraw(p_kind, p_proof)` | Withdraws all open consents of the kind; PIN families need the proof. Stored data is **not** deleted. |

## Enforcement

- **App (UI):** `AppShell` → `useConsentGate`. Nothing of the family app renders until the server reports a valid consent (`ConsentGate`: summary, full text, checkbox "Tôi là bố/mẹ hoặc người giám hộ…", then the parent gate — math question or PIN). A returning parent on the same device opens immediately from the hint `kecon-consent-v2` `{uid, version}` while the server check runs; if the server says `required` (new version, withdrawn elsewhere) the app closes and the gate shows. The check repeats when the tab becomes visible again after ≥ 5 min. Settings › "Quyền riêng tư & dữ liệu" › "Chính sách & đồng ý" shows version, accepted date, full text, history and "Rút đồng ý".
- **Paid processing:** `consume_usage` (every route through `guardUsage`: story generate / from-drawing / expert-review / illustrate* / personalize / scan / translate / vocabulary, voice tts / preview / clone / ambient) now returns `{allowed:false, reason:'consent_required'}` → HTTP 403 before quota, keys or providers. The 016 quota logic is unchanged, renamed `_consume_usage_quota` (not callable by clients). **Staff accounts** (admin roles) are exempt here so `/admin` voice audition and catalogue work keep working; their family use is still gated by the UI.
- **Personal data routes:** `requireConsent` (`src/lib/consent-guard.ts`) after auth + validation, before the write, in `POST /api/analytics/event`, `POST /api/push/subscribe`, `POST /api/profile/avatar`, `POST /api/share/links`. `false` → 403 `consent_required`; error / non-boolean → 503 `consent_check_failed` (fail closed).
- **Parent reminders:** `parent_notify_claim` only claims families with a valid consent.

## Publishing a new policy version

Insert new `consent_documents` rows (same `kind`, `version = current + 1`, one per locale, `published_at` = go-live time) in a reviewed migration. From `published_at`, every family is asked again (`previous` set → "Chính sách đã cập nhật"); acceptance of the old version can no longer be submitted (`stale`). Never edit or delete published rows.

## Known limits (deliberate, documented)

- Direct PostgREST reads/writes the family app makes itself (stories, favourites, play sessions, missions RPCs, parental controls, profile, `parent_device_register`) are protected by RLS and the UI gate, **not** by a server consent check. Export ("Xuất dữ liệu") and "Xoá toàn bộ dữ liệu" intentionally keep working after withdrawal.
- Withdrawal closes the app at once on the device that withdrew; other open devices close at their next check (load, or returning to the tab after ≥ 5 min) — the server blocks paid and personal-data routes immediately.
- Voice-specific consent (spoken confirmation, clone gating, provider deletion on withdrawal) is **T12**. Legal review, store declarations and retention jobs are **T27**. Only a Vietnamese text exists.
- A future migration that runs `CREATE OR REPLACE FUNCTION public.consume_usage` would replace the consent wrapper — change `_consume_usage_quota` instead.

## Verification

- DB (PGlite, real migrations): `tests/db/parent-consent.test.ts` — immutability, RLS, hash, stale/not_found, PIN proof, idempotency, withdrawal, new version, reminders, staff exemption, cascade on account deletion; other suites grant consent via `grantParentConsent`.
- Unit: `tests/unit/consent.test.ts`, `usage-guard.test.ts` (consent_required → 403, `requireConsent` fail-closed), route tests for analytics / avatar / share links.
- E2E (mock Supabase): `tests/e2e/parent-consent.spec.ts` — first visit gate + axe, policy v2 re-ask with an old local hint, PIN family (`parent_pin`), withdraw from Settings → gate + API 403 → accept again.
