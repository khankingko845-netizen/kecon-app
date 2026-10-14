# G-09 — Gỡ gamification cũ

Ticket (Notion research "Duolingo → Nhiệm vụ & khen thưởng cho bé", §8): **Gỡ gamification cũ — không còn
đường cấp thưởng từ client.** "Bầu trời của Đóm" (G-01…G-07, `docs/missions-mvp.md`,
`docs/missions-parent.md`) replaces it.

## What was removed
| Layer | Before | After |
|---|---|---|
| Client reward path | `award_xp(user, amount)` RPC — any signed-in client could add XP to itself | Dropped (migration 037). Rewards are written only by server RPCs (`missions_*`, `parent_*`). |
| Data | `badge_definitions` (18 seed rows), `user_badges`, `daily_challenges`, `user_challenge_progress`, `profiles.xp`, `profiles.level` | Dropped (037). Staging had 0 earned badges, 0 challenges/progress, 0 non-default XP/level. |
| Feature flag | `feature.gamification` (default off) | Row deleted with audit `flag.delete` + reason "G-09: …"; key removed from the allow-list constraint, `public_feature_flags()` and `set_feature_flag()` (→ `Unknown feature`); app `FEATURES` list and admin API (→ 400). |
| UI | `Achievements.tsx` ("Huy hiệu"), `DailyChallenges.tsx` ("Thử thách"), Settings row "Thành tích & huy hiệu", Home shortcut "Thử thách" | Deleted. `/?screen=achievements` / `daily-challenges` are unknown screens → 404. |
| Client data layer | `src/lib/db.ts` GAMIFICATION section (XP/level math, badge/challenge reads + writes) | Deleted. |

## Why it is safe
- The flag was off everywhere since T06 (no family could reach the screens; restrictive RLS kept the
  tables unreadable), so no child loses anything they saw.
- Nothing else referenced these objects: on staging only `award_xp`, `public_feature_flags` and
  `set_feature_flag` mentioned them (checked `pg_proc` sources and view dependencies before the drop).
- Dry-run on staging inside `BEGIN … ROLLBACK` before deploy; `tests/db/feature-flags.test.ts` asserts the
  end state (tables/columns/function gone, key unknown, audit row with the G-09 reason).

## Rollback
Contract step. Restore the pre-fix54 `pg_dump` taken right before the deploy (path in the PR) and redeploy
the previous release; the app no longer reads these objects, so a newer release keeps working on either schema.
