# Admin UI kit — A-15

The operations console shares the UI v2 parent tokens and typography. It uses a fixed light palette independent of the kid's bedtime theme; all controls have a 44px minimum target height/width. This is not a redesign of the kid app.

## Shared components

- `AdminHeader`: page title and navigation.
- `AdminFilters` / `AdminTable`: semantic filters and an internally scrollable table.
- `AdminDrawer`: native modal detail pane with Escape, focus containment and restoration. User details contain only the fields already loaded; this is **not** A-12 household lookup.
- `AdminConfirmProvider`: one native reason-confirmation modal. Cancelling/Escape does not issue a mutation. Reasons are trimmed, 10–500 characters, and must not contain secrets or child PII.

`AdminSettings` orchestrates four provider sections through one controller: ElevenLabs, Fish Audio, story AI, and illustration. `SettingsFields` and `DefaultVoicesManager` retain the write-only Vault, key-pool, catalog language filtering, preview, toggle and rank behavior. Provider navigation does not clear unsaved fields. No credentials are persisted to localStorage.

## Confirmed actions

Role changes (including demotions), story trash/unpublish (single and batch), category/template/default-voice deletion, Vault secret deletion and provider-key deletion require confirmation and a reason. Voice/key enable toggles and unsaved form field removal retain their existing behavior and do not mean consent revocation or provider deletion.

`POST /api/admin/confirmed-action` validates the body, authenticates the caller, checks the corresponding permission, and invokes `admin_confirmed_action` with the caller's client. It never uses service-role privileges. Migration 026 adds database enforcement of reasons for destructive staff operations; RBAC/RLS and A-05 MFA/idle-session enforcement remain authoritative. Batch targets must all be accessible and unchanged; otherwise the entire transaction and row-trigger audit are rolled back. The edge IP and user agent are forwarded into that same row-trigger audit; there is no second API audit entry for one mutation.

The existing secret/key deletion RPCs now require reasons for authenticated callers. Operational SQL without `auth.uid()` remains possible and is still logged as system activity. Family operations on their own stories are unaffected. No existing provider credentials or curated voice ranks are changed by the migration.

## Verification / limits

- New DB tests cover mandatory reasons, direct mutation bypass, single audited reason, text category IDs, atomic batch rollback, RBAC and AAL/session denial.
- API tests cover authentication, validation, permission/lease denial, conflict sanitization and audit IP forwarding.
- E2E checks cancellation, disabled short reasons, one confirmed request, errors, filters/drawer keyboard behavior, mobile overflow and AA checks on the eight admin routes and selected dialogs.
- Visual captures use 1280px and 390px viewports plus the fixed-light console under a night-theme preference. These are deterministic mock-data checks, not user research or performance measurements.

A-06 publishing workflow, A-07 moderation, A-08 consent/revocation, server pagination and analytics are **not** completed by this ticket. Existing compiler-effect lint warnings are tracked separately.
