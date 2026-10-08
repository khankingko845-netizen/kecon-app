# T08a — default household identity (expand only)

## Shipped scope, only after rollout evidence
- New `households` and `household_memberships` are distinct from legacy `family_members` (people/voice list, not authentication membership).
- One default owner household per existing auth account; signup creates it before inserting the profile. Database-derived household IDs on profiles and private stories/pages/voice profiles/family people; platform story/page scope is NULL.
- Parent page identity follows story reclassification atomically; foreign supplied metadata is rejected. Owner IDs cannot be reassigned by clients. Existing records, provider voice IDs, narrator choices and story content are not rewritten; ordinary row updated timestamps may advance during additive backfill.
- The two new tables have member-only SELECT, no client membership/owner CRUD. `is_household_member` is a bounded security-definer helper; default provisioning is private/service-only. Self-context RPC/API binds verified auth user, validates minimal UUID/role schema and is private/no-store, never accepts actor/household selection from the browser.
- Existing per-user content RLS, query filters, quota and entitlements are unchanged. **This does not ship shared libraries, invitations, active tenant switching, child profiles, consent or all-table household RLS.** T08 is not complete merely because identity exists.

## Remaining T08b / related gates
- Audit all legacy policies and relation references, add tenant-scoped RLS/API/client queries and negative tests per table. Do not grant sharing before those gates pass.
- Inventory Storage: old public URLs can bypass row ACL; private manifest/object migration and signed URL/offline invalidation are separate R06/T12/T27 work, not fixed by adding household IDs.
- Decide invitation/join/multi-membership transitions (T09), child selection (T10), server consent and voice provenance/revocation (T11/T12); do not auto-move assets or consent to another household.
- Quota/accounting remains per account until T21 migration. Support cannot gain private content access from the new helper; A12 still requires masked lookup/reason/audit.
- Contract/drop old columns only after complete migration and restore/rollback rehearsal; no destructive contract step in 030.

## Validation / rollback
- Seed nonempty legacy fixtures before 030; check data/provenance preservation, new signup, table/helper/API isolation, anti-forgery, parent/page synchronization, idempotent provisioning and account-delete scope.
- Full unit/DB/typecheck/lint/build/E2E and exact-head CI. Verified DB backup and transactional real 030 dry-run; flush deferred FK checks before subsequent DDL, then restore deferred semantics. Never disable integrity/audit/security triggers.
- Deploy tested tree, inspect mapping census and service health, use isolated QA users, then clean them and preserve audit. No paid provider calls, no real key/model/default-voice/MFA edits.
- Additive schema is compatible with the prior application. Do not remove household identity/membership rows as a casual rollback: core records reference them and deletion is a data action requiring separate policy.
