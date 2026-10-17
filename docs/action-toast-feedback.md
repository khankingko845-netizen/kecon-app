# Action feedback — shared toast release

The shared toast existed but many screens did not use it, and several DB helpers ignored error/zero-row results. This release connects user-triggered write outcomes rather than globally intercepting fetch (background reads, metering, prefetch and polling must not spam).

## Scope
- Admin: role changes, category/template save/delete/visibility, template→story, single/bulk story publish/trash/restore/template, system configuration/key clearing, default voices/order, feature flags, pricing and provider/key-pool checks.
- Family: profile save, voice profile rename/toggle/delete, voice creation, AI/drawing/scan/import story creation, parent controls/PIN, player/library/favorites favorite writes and offline ambience downloads.
- Editor: save/publish/illustration, characters and narrator voice. Failed save returns false and prevents publication. Non-atomic legacy multi-write operations report incomplete failure and advise checking state, not “rolled back”. Atomic revisions/jobs remain a separate plan.
- Library favorite previously displayed success without writing; now waits for actual persistence. Selected DB mutations explicitly request acknowledgement; error or zero affected rows rejects. Bulk publish verifies all selected unique IDs. Favorite read and write errors propagate.

## UX and safety
- Shared parent/admin/kid providers, fixed above overlays with mobile safe-area offset above persistent navigation, nonblocking text with an interactive close target, three-item bounded/deduplicated queue, polite status / assertive error, explicit accessible close target, hover/focus timer pause and timer cleanup. Reduced-motion-aware animation, feedback respects existing sleep/quiet settings.
- Success/info 4.5s; errors 7s; loading/persistent notices manually dismissible. Closing a toast does not cancel a job. Important inline form errors/progress remain; toasts are not a durable audit/inbox or push notification.
- Toasts use short, fixed action-specific messages, not raw provider errors, API keys, OTPs or personal names. No toast persistence/analytics, no new library/runtime package, no permission/MFA/quota bypass.
- No paid provider call is required to verify notification UI. Provider HTTP 200 with failed health result is an error, not a passed check. Cancellation/no-op has no success notification.

## Remaining work
- This covers the listed primary writes, not every optional screen, transient slider, background request or all audio-job/batch/review/download/auth flows. Remaining optional workflows need acknowledgement/partial-result contracts before claiming complete success.
- Downloads may still be partial in the legacy implementation, so do not label them “all audio ready”. Full tenant-safe offline/cache/asset manifest work belongs to T08b/T16/R06/T25/T27.
- All gates: focused unit contract tests, full unit/DB/typecheck/lint/build/E2E, exact-head CI, staged UI failures and success with isolated QA accounts, unchanged real config/key/voices/MFA and QA cleanup.
