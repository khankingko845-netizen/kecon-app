# T10 — Hồ sơ bé (child profiles, migrations 044–045)

Replaces the single child name/age on the parent's account (`profiles.child_name`, `profiles.child_age`) with **1–5 child profiles per household**. A child is **not an account**: profiles belong to the household and only its members can read or change them.

Each profile has a **tên gọi** (display name), a **năm sinh** (birth year; the age is computed from it — no full date of birth is stored) and up to five **sở thích** (interests). The child chosen on a device ("bé đang nghe") drives the greeting, the age band of the kid UI (UI-13), suggestions and story creation.

## Data model — `public.child_profiles`

| Column | Notes |
| --- | --- |
| `id` | uuid |
| `household_id` | FK `households` (cascade). Server-derived: the caller's own household unless a household they belong to is named. |
| `display_name` | 1–40 characters after NFC + whitespace collapsing; no control characters. |
| `birth_year` | smallint, nullable (legacy rows that only had a name). New profiles always send one; must be within 0–18 years of the current year in Việt Nam (`Asia/Ho_Chi_Minh`). An unchanged old value is not re-checked. |
| `interests` | text[] ≤ 5, each ≤ 24 characters, trimmed, de-duplicated case-insensitively. |
| `created_by` | the member who created it (SET NULL when that account is deleted). |
| `created_at`, `updated_at` | server timestamps. |

**Guard trigger** `child_profiles_guard` (BEFORE INSERT/UPDATE, SECURITY DEFINER) cleans and validates the row and raises one-word codes that the app maps to Vietnamese (`childErrorMessage` in `src/lib/child-profiles.ts`):

- `household_scope` — wrong household, or an attempt to change `id` / `household_id` / `created_at` / `created_by`.
- `consent_required` — adding or changing a child needs the parent's active policy consent (T11). Deleting never does.
- `invalid_child_name`, `invalid_birth_year`, `invalid_child_interest`, `too_many_child_interests`.
- `child_profile_limit` — at most **5** per household; the household row is locked (`FOR UPDATE`) so concurrent inserts cannot exceed it.

**RLS / grants:** `authenticated` may SELECT/DELETE and INSERT (`household_id, display_name, birth_year, interests`) / UPDATE (`display_name, birth_year, interests`) only; all four policies use `is_household_member(household_id)`. There is **no staff policy** — support/admin roles do not read children's profiles. Covered by `tests/db/child-profiles.test.ts` with two households.

**Backfill:** one profile per account that had a child name or age (name-only → no birth year; age-only → name "Bé"; birth year = current VN year − age).

**Signup trigger:** `handle_new_user` no longer copies any child data into `profiles` (044).

**Contract (045):** `profiles.child_name` and `profiles.child_age` are dropped (no CASCADE — the migration fails if anything still depends on them). Their data lives on in `child_profiles` from the 044 backfill; the pre-045 database backup is the only copy of the raw old values. The app stopped reading and writing them in the same release as 044, so the two migrations can ship together; an old cached client that still sends `child_age` gets a PostgREST error on "Lưu" instead of writing a stale age.

## App

- `ChildProfilesProvider` / `useChildProfiles` (`src/lib/child-profiles-context.tsx`): loads the household's profiles (oldest first), exposes `activeChild`, `addChild`, `updateChild`, `removeChild`. State is keyed by account, so switching accounts never shows another family's children.
- **Device selection:** `kecon-active-child:<uid>` in `localStorage`. A deleted or missing child falls back to the first profile. The choice is per device on purpose (two phones in one family can follow different children).
- **Screens:** Bố mẹ › "Hồ sơ bé" (parent area, behind the parent gate): list, "Chọn bé này", add/edit form (tên gọi, năm sinh with the age next to each year, interest chips + "Sở thích khác", age-band summary), delete with confirmation ("Truyện đã tạo vẫn được giữ trong thư viện."), "Thêm bé" disabled at 5. Trang chủ: "Chào bé {tên}!"; with ≥ 2 children the greeting opens "Ai đang nghe truyện?"; with no child a card "Thêm hồ sơ bé" leads to the parent area. Hồ sơ gia đình no longer has the age grid; it links to Hồ sơ bé.
- **Age band (UI-13):** `AgeUiProvider` uses the chosen child's age (`childAge(birth_year)`); without a child or birth year the device setting `settings.childAge` is the fallback (default 3–5). The band is still mirrored to `settings.childAge` for story creation, drawing and suggestions. `settings.childName` was removed (stripped from old `localStorage`).
- **Signup:** "Tên con" + "Năm sinh của con" are kept on the device as `kecon-pending-child:<uid>` — nothing about the child is sent before the parent consents. After the consent gate opens the app, `flushPending` creates the first profile if the household has none; a draft the guard rejects (name/year/limit) is dropped, a network or consent error keeps it for the next start.
- **Story creation:** Tạo truyện lets the parent pick which child the story is for ("Bé nào là nhân vật chính?", "Truyện cho bé", or "Bé khác" with a typed name). Vẽ truyện uses the chosen child. "Đưa bé vào truyện" in the player asks "Đưa bé {tên} vào truyện?".

## API

`POST /api/story/generate`, `/api/story/personalize` and `/api/story/from-drawing` accept an optional `childProfileId` (uuid). The server reads it with the caller's own session **before quota, keys or providers** (`loadStoryChild`, `src/lib/child-profile-server.ts`) — RLS limits it to the caller's household:

- not found / another household → **404** `child_profile_not_found`; read error → **503** `child_profile_unavailable`;
- the profile's name replaces `childName`; its interests become one prompt line (`interestsPromptLine` in `src/lib/child-profiles.ts`, used by `buildStoryPrompt` in `src/lib/story-ai.ts`); personalize uses the age from the birth year, from-drawing falls back to the child's age band when the request has no `age`;
- in `generate`, the "bé là nhân vật chính" card (`characters[].isChild`) also takes the profile's name, in the prompt and in the saved cast (a stale or typed name from the client is ignored);
- `generate` records `child_profile_id` in `user_behavior.metadata`.

Without `childProfileId` the old behaviour is unchanged (`childName` optional, typed by the parent). Fixed on the way: personalize and from-drawing inserted a non-existent `stories.metadata` column.

Export ("Xuất dữ liệu") includes `child_profiles`; "Xoá toàn bộ dữ liệu" deletes them.

## Known limits

- Missions, reading streaks, favourites and the library are still per account, not per child.
- The chosen child is per device (not synced).
- Interests are free text from the parent: they are validated (length, count, control characters) and only shape the prompt; generated stories go through the existing output checks, but interests themselves are not screened by a separate safety filter yet.
- A signup draft stays on that device until the parent consents there; signing up on one device and consenting on another means adding the child by hand.

## Verification

- DB (PGlite, real migrations): `tests/db/child-profiles.test.ts` — backfill, signup trigger, RLS across two households, server-derived household/creator, limit 5, consent (add/change only), name/year/interest validation, cascade on account deletion, creator SET NULL.
- Unit: `tests/unit/child-profiles.test.ts` (helpers), `tests/unit/story-child-profile.test.ts` (API: 404/503 before spend, name/interests precedence, metadata).
- E2E (mock Supabase): `tests/e2e/child-profiles.spec.ts` (add/switch/create story/edit/delete, limit 5 and server validation, signup draft after consent), `age-bands.spec.ts` (band from birth year), `mobile-ui.spec.ts` (360×640).
