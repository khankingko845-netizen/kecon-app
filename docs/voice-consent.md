# T12 — Spoken voice consent before cloning; withdrawal deletes the voice (migration 043)

A family voice (Bố mẹ › Giọng đọc › "Ghi giọng bố mẹ") is cloned at ElevenLabs only after **the contributor read a consent sentence aloud** and that recording was stored on the server. Withdrawing the consent (or deleting the voice / all data) stops the voice **at once** and deletes it at ElevenLabs, together with its recordings and the narration made with it, **within 24 hours**.

## Flow in the app

1. **Step 1/2 · Lời đồng ý** (`VoiceConsentStep`): the voice-consent text (`consent_documents` kind `voice_clone`, v1 vi: summary + full text), the speaker's name and the sentence with that name — *"Tôi là {ten}. Tôi đồng ý để KểCon dùng giọng nói của tôi tạo giọng đọc truyện cho gia đình mình. Tôi biết mình có thể rút lại đồng ý bất cứ lúc nào."* The contributor records it (3–30 s, MediaRecorder), can listen back, then a parent confirms (**PIN** when the family has one → `parent_pin`, otherwise `account_holder`). `POST /api/voice/consent` stores it.
2. **Step 2/2 · Ghi âm mẫu** (unchanged recorder, 30 s – 3 min) → `POST /api/voice/clone` with the `consentId`.
3. **Bố mẹ › Quyền riêng tư & dữ liệu › Đồng ý giọng nói** (`VoiceConsentPanel`): every consent (speaker, time, version, how the parent confirmed, the voices using it, the sentence, the recording to listen to), "Rút đồng ý & xoá giọng" (2-step, PIN when set) and the deletion status (deadline, ElevenLabs result, files, narration pages). Voices cloned before T12 are listed as "Giọng tạo trước khi có lời đồng ý" (paused; re-record with consent or delete).
4. **Giọng đọc**: the trash button now withdraws + deletes the same way (confirm text explains the 24-hour deletion); legacy voices show "Chưa có lời đồng ý · tạm dừng".

The app does **not** check *what* was said (no speech recognition): the evidence is the stored recording + text version/hash + time + parent confirmation.

## Data model

- `consent_documents.spoken_text` (only for kind `voice_clone`, must contain `{ten}`, part of `body_sha256`). Rows stay immutable (T11); a new text is a new version.
- `voice_consents` — one row per spoken consent: household, recorded_by, document/version/locale/body hash, speaker name, spoken text (with the name), `parent_method`, audio SHA-256 / bytes / MIME (sniffed from the bytes) / duration, user agent (≤ 300 chars, no IP), `audio_path` (private bucket `voice-consents`, `<household>/<consent>.<ext>`), `provider_voice_id` (bound once, unique), `withdrawn_at` + `withdraw_reason` (`withdrawn` / `voice_deleted` / `account_deleted` / `expired`), `audio_deleted_at`. Append-only guard trigger; RLS: the household reads its own rows, nobody writes from the client.
- `voice_deletion_jobs` (service role only, no FKs so a job outlives the account): provider voice, storage paths, status, attempts/backoff, `provider_result` (`deleted` / `already_gone` / `not_found`), `provider_history_removed`, `pages_cleared`, `files_removed`, `removed_cache`, `deadline_at = created_at + 24 h`.
- `story_pages.audio_voice_ids` — which provider voices rendered the saved narration. Only `save_page_audio(...)` (used by the player, mini player and editor) may set it; audio written any other way counts as *unknown*.

## Enforcement

- `voice_consent_begin` (user, before upload): current document + exact hash (`stale`), valid speaker name, T11 policy consent, parent proof when a PIN is set, ≤ 20 consents / household / day. The route uploads the bytes with the service role, then `voice_consent_attach_audio` (expected path only); any failure removes the file + discards the row.
- `/api/voice/clone`: `consentId` required (`voice_consent_missing` 403), **BYO ElevenLabs keys are refused** (`byo_clone_disabled` — a personal account is out of reach for deletion), `voice_consent_ready` before quota and provider (unused, < 24 h, current version, recording stored, same household). After the provider returned the voice: `voice_consent_bind` records the T08 claim and binds the voice atomically; if the consent was withdrawn meanwhile / is used / the claim fails, the new voice is queued for deletion right away (`clone_unbound`) and the route answers 409.
- `voice_profiles`: a provider voice needs a bound, active consent of the same household (trigger `voice_z_consent`); renames / on-off of legacy rows still work.
- `authorize_tts_voice`: a withdrawn / deleted voice never speaks again (staff included); the household's own legacy voices answer `consent_required` (→ 403 `voice_consent_required`).
- `save_page_audio` refuses voices that were withdrawn.

## Withdrawal and deletion

- `voice_consent_withdraw(consent | profile, proof)` (PIN when set): stamps the consent, queues the job (voice + consent recording), deletes every household profile speaking with that voice (the delete trigger adds their samples). Deleting a profile directly, "Xoá toàn bộ dữ liệu" and account deletion go through the same triggers (`voice_deleted` / `account_deleted`). `play_sessions` keep the listen without the voice.
- Worker (`runVoiceDeletions`, `src/lib/voice-deletion.ts`): `voice_consent_expire` → `voice_deletion_claim` → `voice_deletion_prepare` (clears saved narration rendered with the voice — and, conservatively, unknown-voice narration of the household — plus story narrator / last voice / character casts; lists the files: queued recordings, that narration, unreferenced uploads of the household's accounts older than 1 h) → ElevenLabs: history items of that voice (best effort, ≤ 1000) then `DELETE /v1/voices/:id` on the key that made it (404 = already gone) → storage removal → `voice_deletion_finish`. A job is done only when the voice is gone, every file removed and a last sweep ran ≥ 2 h after it started (narration in flight). Failures back off (1 min doubling, ≤ 1 h).
- Triggers: the withdraw route runs the household's jobs for up to 8 s; `POST /api/voice/deletions` after "Xoá toàn bộ dữ liệu"; **`kecon-voice-deletion.timer`** every 15 minutes (`scripts/voice-deletion-tick.sh` → `POST /api/internal/voice-deletions`, `Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY`). `voice_deletion_overdue()` counts jobs past 24 h (logged on every tick).
- Devices: `voice_revoked_audio()` lists narration files removed for the household (30 days); on the next app open `purgeRevokedAudio` drops them from the audio / shell caches and the "Tải về" copies.
- Unused consents expire for cloning after 24 h; their recording is deleted after 48 h.

## Limits (known)

- No speech recognition of the sentence; the parent confirms what was recorded.
- Encrypted backups may keep deleted data up to ~6 months (as in the parent policy).
- ElevenLabs history purge is best effort; the voice deletion itself is required for a job to finish.
- The first withdrawal in a household also clears its narration saved before T12 (unknown voice) — it is re-rendered on the next play.
- Voices cloned before T12 stay paused until re-recorded with a consent, or deleted.

## Tests

- `tests/db/voice-consent.test.ts` — migration 043 on PGlite: grants / RLS, consent record + attach, clone gate, bind (incl. withdrawn meanwhile → `clone_unbound`), withdraw by consent / profile, triggers on profile / account deletion, TTS authorization, `save_page_audio`, worker claim / prepare / finish / backoff / 2-hour sweep, expiry, rate limit.
- `tests/unit/voice-consent-routes.test.ts`, `voice-clone-binding-route.test.ts`, `voice-deletion.test.ts`, `voice-availability.test.ts` — the routes and the worker with mocked Supabase / ElevenLabs.
- `tests/e2e/voice-consent.spec.ts` (mock: `tests/e2e/support/mock-voice-consent.mjs`) — step 1 before any sample (math gate and PIN), what is stored, clone needs that consent and no personal key, playback is private, withdrawal from Cài đặt and from Giọng đọc, legacy voices paused.
