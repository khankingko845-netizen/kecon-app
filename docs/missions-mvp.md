# G-01…G-05 — Nhiệm vụ & "Bầu trời của Đóm" (MVP)

Research: Notion "Research Duolingo → Module Nhiệm vụ & khen thưởng cho bé". This MVP ships the
"demo sớm" slice behind the feature flag **`missions`** (default **off**). Habit missions with parent
confirmation, good deeds, the family constellation and "Tuần của bé" (G-06/G-07) are in
`docs/missions-parent.md` (migration 036). Per-child profiles (T10/T11), friend/league features and paid
boosts are out of scope.

## What ships
| ID | Piece | Where |
|----|-------|-------|
| G-01 | Process praise only: Đóm names what the child did ("đã nghe đến tận trang cuối"), never "giỏi/thông minh/xuất sắc", never counts days in a row ("liền/liên tục"). | `src/lib/dom-lines.ts`, `src/lib/missions.ts`, `VocabQuiz.tsx`; enforced by `tests/unit/feedback.test.ts` + `tests/unit/missions.test.ts` |
| G-02 | Home chip "Tuần này N tối" (nights with a finished story this Vietnam calendar week, Monday start). Replaces the old gamification chip "N đêm liền". No loss/expiry wording; a new week starts quietly. | `Home.tsx`, `/api/missions` |
| G-03 | Two missions a day: base "Nghe hết một truyện" + one themed mission rotating by date (cổ tích / thói quen tốt / con vật / truyện mới). One star per mission per day. | migration 034, `StoryPlayer.tsx`, `Sky.tsx` |
| G-04 | Weekly sky: 7 nights, star when a story was finished that night; goal 4 nights is a soft visual target, never a penalty. | `Sky.tsx` |
| G-05 | Album: finishing a library story (`kc-lib:*` tag) adds its character card once; milestones at 1/5/10/25/50/100 finished stories (totals, not streaks). Only earned items are shown — no locked slots. | migration 034, `Sky.tsx` |

## Reward rules (enforced in the database)
- Rewards are facts of what was done: never bought, never random, never lost or expiring. `reward_ledger` is append-only (UPDATE/DELETE/TRUNCATE blocked by trigger, even for the owner); rows leave only with the account/household (cascade).
- Clients cannot write any missions table (privileges revoked; RLS read-own only while the flag is on). Everything goes through `SECURITY DEFINER` RPCs that re-check `auth.uid()` and the flag.
- Completion needs a **server-timed listening session**: `missions_start_listen(story)` when the player opens a readable story (published library story or the family's own), `missions_complete_listen(session)` at the last page. If less than `min_seconds = clamp(ceil(chars / 35), 15, 900)` passed (narration ≈ 15.6 chars/s, so 2× speed still counts but skipping does not), nothing is recorded (`too_fast`). Sessions expire after 6 h; uncounted ones are purged after 7 days; at most 60 starts per day (`54000`).
- Idempotent: one star per template per Vietnam day, one sticker per library story, one row per milestone (`idempotency_key` unique).
- Days are `Asia/Ho_Chi_Minh` calendar days; weeks start Monday.
- Turning the flag off hides everything (RPCs → 404, rows unreadable) but keeps the ledger; turning it on shows the same rewards again.

## Child UI
- Celebration card after a story with something new: names the completed mission, "+N ⭐", sticker title, milestone; closes itself (12 s day, 6 s bedtime) or with "Đóng"; `role=status`. At bedtime (Chế độ ngủ): no sound, no voice, no motion, dimmed.
- Same story again the same night → counted as listening but no new rewards → no card, Đóm keeps the normal story-end line.
- "Bầu trời của Đóm" (`/sky`, flag-guarded server route): week sky, today's missions with "Chọn truyện" → Thư viện, album, milestones, a one-line note for parents.

## Known limits (honest)
- **Account-level** until T10 child profiles: siblings on one account share stars. `child_profile_id` stays NULL and is already part of every uniqueness key so the contract step can scope per child.
- "Listened" = the server saw enough wall-clock time between opening and the last page; it is not proof the audio actually played or that a child was listening.
- Library categories/tags decide themed missions; untagged own stories only count for the base and "truyện mới" missions.
- No child usability test yet; copy follows the G-01 rules and the existing Đóm voice guide.

## Ops
- Enable on staging: Admin → Cài đặt → "Nhiệm vụ & Bầu trời của Đóm" (reason required, audited) or `set_feature_flag('missions', true, false, reason)`.
- Tests: `tests/db/missions.test.ts` (rules above), `tests/unit/missions.test.ts` (copy + API), `tests/e2e/missions.spec.ts` (chip → sky → finish story → card → sky).
