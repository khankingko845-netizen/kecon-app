# G-06 / G-07 — Thói quen tốt cùng bố mẹ, việc tốt, đọc cùng nhau, "Tuần của bé"

Builds on the missions MVP (`docs/missions-mvp.md`, flag **`missions`**, default off). Migration **036**
is additive (expand only). Research: Notion "Research Duolingo → Module Nhiệm vụ & khen thưởng cho bé" §8.

## What ships
| ID | Piece | Where |
|----|-------|-------|
| G-06 | 9 habit missions, each tied to one "Thói quen tốt của Bo và Su" story (`kc-lib:<slug>` tag). A habit appears for the parent only after the child finished its story; the parent taps "Bé đã làm hôm nay" → one star per habit per Vietnam day. | migration 036, `ParentWeek.tsx`, `Sky.tsx` |
| G-06 | Good deeds for others (2: "Chia sẻ, chờ đến lượt" tied to "Chiếc xe tải đỏ", "Giúp đỡ người khác" always shown): the parent taps "Ghi nhận" → Đóm thanks the child **in words only**. Never a star, sticker or ledger row (rule 9). | migration 036 (trigger `reward_ledger_kind_rules`) |
| G-07 | Family mission "Cả nhà đọc cùng nhau": the parent marks this week's finished stories as read together; 3 different stories (story × day) light the family constellation once per week (`reward_ledger.kind = 'constellation'`). | migration 036, `ParentWeek.tsx`, `Sky.tsx` (Chòm sao của nhà mình) |
| G-07 | "Tuần của bé" (parent area, Settings → Gia đình & bé): nights this week, habits with this week's count, good deeds, stories this week with a conversation prompt (the story's own question, else one per category), family progress, reminders. No free text, no photos, no comparison with other children. | `src/components/screens/ParentWeek.tsx`, `/api/missions/parent` |
| G-07 | Opt-in parent reminder: off by default, one hour between 06:00 and 21:00, **at most one per Vietnam day**, only to devices a parent registered behind the PIN ("Máy này là của bố mẹ"), never to an endpoint that also receives child push. | `parent_notify_*` RPCs, `scripts/parent-notify.mjs`, `kecon-parent-notify.timer` |
| — | Home chip: a placeholder while loading instead of flashing "Bầu trời của Đóm" before "Tuần này N tối"; the last value is reused when coming back to Home. | `Home.tsx` |

## Parent proof (why the child cannot confirm)
- The parent gate's PIN step calls `open_parent_gate(pin)` (same attempt counter and 15-minute lockout as `verify_parent_pin`). On the right PIN it returns a random 256-bit token; the database stores only its SHA-256 (`parent_gate_sessions`).
- The token lives in page memory only (`src/lib/parent-proof.ts`): not in localStorage, sessionStorage, cookies or URLs. Leaving the parent area, the 5-minute idle lock or a reload drops it (and closes it on the server, best effort).
- Server lifetime: 15 minutes, sliding on use, never more than 60 minutes after the PIN; at most 5 live per account; a new or reset PIN revokes all of them (trigger on `parental_pins`).
- Every write RPC (`missions_confirm`, `missions_mark_together`, `parent_notify_set`, `parent_device_register`) re-checks auth, flag and proof; a missing/forged/expired/other-account proof → SQLSTATE `28000` → HTTP 403 `{code: "parent_proof"}` → the screen asks for the PIN again. Removing a device never needs the PIN.
- No PIN yet (adult maths question only): the week is readable, but nothing can be confirmed until a PIN is set ("Đặt mã PIN").

## Rules (database)
- Templates carry their own copy (title, parent label, praise, prompt) and a CHECK rejects person praise, streak and penalty words (`giỏi|thông minh|xuất sắc|thiên tài|liền|liên tục|liên tiếp|thua|phạt`). G-08 will let admins edit them.
- Habit → `child_missions` row (once per template per day, with `parent_session_id`) + one `star`. Good deed → `child_missions` row only. Constellation → `family_reads` (unique per listening session; only counted sessions of this week) + one `constellation` per week (idempotency key per user × week).
- A past week stays as it was: sessions before this Monday cannot be marked.
- Reminders: `parent_notify_claim(now, limit)` (service role only) returns parents due this hour with their parent devices and logs `queued`; the primary key `(user_id, local_date)` makes a second claim the same day impossible. `parent_notify_finish` records `sent/failed/skipped` and deletes endpoints the push service reported gone (404/410). The message counts nights only ("Tuần này bé đã nghe truyện N tối…") — no comparison, no guilt.

## Ops
- Reminders need a VAPID key pair in `/srv/kecon/shared/app.env`: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (generate with `npx web-push generate-vapid-keys`), then `sudo systemctl restart kecon-web`. Without them the job logs `vapid_missing` and claims nothing, and the screen says the server has not enabled notifications yet (choices are still saved).
- `kecon-parent-notify.timer` runs every 15 minutes (`Persistent=false`: no catch-up after downtime); installed by `deploy/prized/deploy.sh`. Logs: `journalctl -u kecon-parent-notify` (counts only).
- Tests: `tests/db/missions-parent.test.ts` (proof, unlock, once-a-day, thanks-only, constellation, reminders, grants), `tests/unit/missions-parent.test.ts` (copy, schemas, route, proof store, sender), `tests/unit/parent-push-worker.test.ts` (service worker), `tests/e2e/parent-week.spec.ts` (PIN → confirm → thanks → read together → reminders → Sky; expired proof; no PIN; chip without flash).

## Known limits (honest)
- Still account-level until T10 child profiles: siblings share the habits and the constellation.
- The parent's tap is the evidence; the app cannot know whether the habit really happened.
- Reminder delivery depends on the browser's push service; iOS needs the app added to the Home Screen.
