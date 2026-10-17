# T17 — licensed recorded-file ambience

## Scope
- Eight versioned local clips: rain, ocean waves, wind, fireplace, birds, crickets, stream and composed bell lullaby. Source pages explicitly publish CC0 1.0. The music clip is not mislabelled as a field recording.
- Files total 2,100,832 bytes, around 2.1 MB. Original downloads are not committed. Author/source/license credits remain visible in both the mixer and Lullaby. See `docs/licenses/ambient-v1.md` and the per-file manifest/checksums.
- Replaces the runtime oscillator/noise engine. Missing/corrupt files fail visibly and remain silent; no synthetic fallback, provider call or AI-credit charge.

## Playback
- User-gesture context unlock happens before asynchronous fetch/decode. Pending starts are cancellable; toggle-off, navigation and disposal cannot start delayed audio.
- Clips are excerpted/crossfaded into circular loops, high-passed at 70 Hz, level matched to -28 LUFS with a -9 dBTP normalization ceiling, encoded mono MP3 / 24 kHz / 80 kbps. Re-encoded output is measured separately (not a calibrated loudspeaker/hearing-safety certification).
- Maximum three selected/pending ambient clips. Fade-in/fade-out, clamped volume and 0.35 master ducking during story narration are retained. Scene ambience defaults off. Explicit scene metadata/specific environment cues are used, not character dialogue; unsupported scenes remain quiet.
- Lullaby defaults to 25% background gain and supports its sleep timer/screen-off controls. Removed its fake narrator-volume slider: that screen does not contain a narrator. Story narration remains in the Player.

## Offline and integrity
- Explicit “Lưu 8 âm nền để nghe offline”, two concurrent downloads, progress and verified cache count. Normal playback opportunistically saves the requested clip.
- Exact SHA-256 and byte length checks reject truncated, mismatched, partial-206 or HTML responses. Online playback can continue if browser storage is full, but the UI never claims full offline readiness in that case.
- Cache `kecon-ambient-v1` is isolated from auth/API and survives shell service-worker upgrades. Cached full files support range requests; failed network responses are not persisted. Partial failure settles/cancels peer workers; retries reuse verified files.
- Offline here means these clips in the already-open app, not a promise that Supabase stories, login or the complete app can be cold-loaded offline. Browsers may evict storage; readiness is checked when the controls mount.
- Changing a released audio file requires a new versioned directory, manifest and cache name; do not overwrite v1 in-place.

## Gates
- Unit tests: asset integrity/provenance, cancellation/decode races, error/retry, limit, ducking, fade/disposal, storage quota, cache poisoning/partial downloads and SW activation/ranges/isolation.
- Browser regression: downloads/decodes all eight real MP3s with network disabled, plays three real Web Audio buffers, rejects the fourth, stops on toggle/navigation and passes axe WCAG AA in the tested Lullaby state. Missing-file test never starts audio. Existing narrator/cache regression remains in the suite.
- Measure rendered clip loudness/peak with FFmpeg; run full unit/DB, typecheck, lint, E2E/performance/secret scan and CI before merge/deploy. No DB migration or change to real API keys/default voices.
- No usability test with children or subjective audio-quality benchmark is claimed. A-05 MFA, full T16 AudioRender and T12 consent/revocation remain separate.

## Rebuild
`python scripts/prepare-ambient-assets.py /path/to/licensed-originals` requires Python/numpy and FFmpeg. Download filenames are documented in the script and license receipt; per-source original checksums are recorded in the manifest. Never commit downloaded originals or credentials.
