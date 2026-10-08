# T09a — Expiring/revocable public-platform text links

This is **not full T09 invitations/collaboration** and does not open private stories, cloned voices or asset URLs. T11/T12 consent and private assets remain blockers for those features.

## Contract
- New additive `story_share_links` table. No client table SELECT/CRUD, even for staff; service-only raw hashes. Actor/canonical default household + live membership are derived server-side. No client actor/tenant parameters.
- Issue only already-public platform stories (`is_platform_content`, published flag + status, not trashed). No owner exception for private content. Current public content is resolved, not a private revision snapshot.
- 32 random bytes, SHA-256 hash at rest; raw token returned once. URL fragment `/share#token` avoids navigation query/path logging; viewer submits body to bounded anon RPC, never service key/raw table lookup. No raw token in behavior/AI ledger/audit/analytics; frontend list has only owner metadata, no hash/token.
- 24h/3d/7d choices, no unlimited TTL. Issuance serialized per actor, max 10 active/story and 60 issued/rolling 24h including revoked. This is link abuse limiting, not generation quota or guaranteed DDoS mitigation. No paid provider call or generation/play quota consumed; old erroneous play-counter increment removed.
- Revoke is owner + same live household, idempotent for own link; foreign/not found generic 404. Resolution rechecks current publication/owner membership/expiry/activity and returns only title/description + page number/text. No audio/image URL, voice/cast, actor/household IDs, scene notes, or private file access. Oversize story fails closed, not truncated. Concurrent revoke stops new resolved opens; already delivered/copied content cannot be remotely erased.
- Old unlimited `story_shares` rows preserved, never reactivated. Legacy endpoint uniformly 410; broad directory SELECT stays closed. New visitor reader is text only, plain React text (not HTML), no provider generation, no autoplay, external links or family membership grant. Unpublish/trash/reclassify to private/issuer membership loss closes new resolution. Deleting issuer cascades only its new links, not the public platform story.
- Owner UI uses existing in-memory PIN/adult-question gate before actions; idle/reload/close relocks. This is **UI parent gate**, not a new server parent-proof lease/consent mechanism. API/RPC ownership still mandatory. Mutation cross-site guard; validated bodies/results; generic errors; no-store/referrer-policy/noindex on API, fragment reader metadata noindex/no-referrer. App-shell service worker excludes APIs; viewer must resolve fresh. Revalidation cannot revoke offline/copied pages, browser history or clipboard.
- Toast success only after server acknowledgement; copy only after Clipboard resolves; cancelled native share is not false success/error. Owner can list/revoke previously created links without retaining raw token.

## Gates
- Red test before migration, real PGlite migrations/roles populated public + private fixtures, anonymous/direct-table/foreign owner/forged body/expiry/revoke/membership/delete/reclassification/size/limits tests.
- Strict DTOs do not silently forward unexpected fields. No auth/service-role fallback in resolver. API, browser visitor flow, owner parent gate/private denial, full unit/DB/E2E/typecheck/lint/build and exact-head CI before merge/deploy.
- Fresh DB dump/TOC, 032 BEGIN/ROLLBACK dry-run, real two-actor/anonymous API checks, zero provider cost, owned synthetic row cleanup, real content/settings/keys/MFA/legacy-share/voice-claim fingerprints unchanged.

## Remaining
Private voice/story sharing, household invitations/roles/tenant switching, versioned consent/revoke, signed private Storage manifests/URL migration/offline revocation, immutable revisions, T13 grandma recording links, rate limiting/retention jobs beyond current DB caps, legal policy review and full portable asset backup/restore remain separate. See `docs/research/story-director-v1.md` for pacing/acting/SFX research; that research is not delivered audio functionality.
