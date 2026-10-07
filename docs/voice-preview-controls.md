# Voice audition and activation controls

## Behaviour
- Admin Settings: audition catalogue and manual IDs before adding; audition curated voices; per-locale enable/disable preserves the row/rank, and is saved immediately. Disabled rows remain visible to managers. Reorder includes only active voices; stale reorders fail atomically.
- Voice Profiles: audition own family clones (including disabled clones), and active curated voices for the app language. Owners can disable/re-enable family clones without deleting them. Automatic selection excludes inactive voices; family clones still precede ranked locale defaults.
- Create Story, Player and Story Editor: audition buttons are separate from selection buttons. Audition never changes the chosen narrator. Locale-specific fixed samples: Vietnamese, English, Japanese.
- Narration switch: device-local `kecon-settings.narrationEnabled`, defaults on. Available in Voice Profiles, Create Story, Settings and Player. Off stops current story narration / MiniPlayer and prevents new playback, page auto-advance, prefetch/merge and late asynchronous responses from starting audio. Re-enabling does not automatically start playback. Story text remains readable. Explicit audition, ambient sound and Đóm feedback are separate controls.
- Selecting an alternative narrator does not reuse/save audio cached under the original narrator. Existing legacy caches without narrator metadata remain a limitation; full revision/voice keyed audio caching is still Story v2 work.

## Boundary and cost
- POST `/api/voice/preview` accepts only bounded `voiceId` and locale vi/en/ja; no arbitrary text, URL, key or model. Authentication required; reject cross-site. Ordinary users: only owned family voices or active curated voices for that locale. Managers with `voices.manage`: catalogue/manual/inactive auditions.
- Shared server synthesis reuses the configured ElevenLabs/Fish pool, model resolution, rate/plan quota and secret scrubbing. Each uncached generated sample is <1000 chars and consumes 1 TTS usage unit; provider failure is not refunded by the existing quota mechanism. Cancelling a client request cannot guarantee cancellation/refund of a provider request already in progress.
- One sample plays at a time per mounted picker, with abort/sequence guards, end/error handling, an eight-item session object-URL cache and cleanup on leaving. Replay in that session avoids another synthesis call. Samples are private/no-store, not persisted in Supabase.
- Admin auditions and inactive-list reads have audit entries. Activation changes use existing default_voices DB/RLS + immutable audit trigger. Family activation uses existing owner-only RLS. No new migration.
- Disabled voices are omitted from public curated lists and from automatic/explicit narrator resolution. TTS rejects inactive registered choices for ordinary users (family/default voice in that locale) before paid calls. Admin may audition inactive voices. This is NOT remote revocation of already downloaded/cached audio and does not terminate audio already playing on another user's device.
- Provider restrictions (missing voice/account access, clone owner, billing/free-tier limits) can still prevent a sample; show an actionable error instead of silently failing. Library voices unavailable to the selected key may require being added in the provider account.

## Verification
- Unit: auth/ownership/locale/input/cross-site boundaries; fixed sample, errors/quota propagation; preview cancellation/race/cache/cleanup; activation availability and automatic selection.
- DB: owner-only family activation; voices.manage default activation; preserved rows/ranks, stale reorder, audit.
- Browser: admin audition/stop/error/activation/reload; family/default audition and toggle; device setting reload, silent Player; turn off during delayed TTS cannot start late audio. Hermetic provider/audio mocks, not a voice-quality benchmark.
