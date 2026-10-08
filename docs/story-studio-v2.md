# Story Studio v2 — rebuilt "Tạo truyện"

Status: implemented on `feat/create-story-v2`. Replaces the v1 wizard/writer for new stories; legacy stories keep their behaviour (every new column is nullable/defaulted).

## Problems reported (v1)

| Report | Root cause in v1 | v2 change |
|---|---|---|
| Sentences run together | TTS read the whole page in one breath (~0.15 s between sentences), page audio merged with no gap | `narration-pacing.ts` compiles sentence/paragraph pauses per model (ElevenLabs v2.5 `<break>`, v3 audio tags, Fish S2 `[pause]`, Fish S1 `(break)`), pace `calm` 0.7 s / 1.2 s + speed 0.92, `normal` 0.45 s / 0.85 s; segments/pages merged with real silence; pace is part of the audio cache key |
| Cast limited to suggestions | 6 fixed theme-like tiles, one choice | Up to 3 characters: 9 presets with their own portraits, fully custom characters (name, who/what, traits, voice), the child as hero, rename, choose hero |
| Character pictures = story-type pictures | Character tiles reused category icons | 10 dedicated clay portraits (`public/characters/v1`) |
| Stories too short | One fixed ~6-page target | Length Ngắn/Vừa/Dài per age band (3–5: 6/8/10 pages, 6–8: 8/10/12, 9–12: 10/12/14), word ranges per page, one quality retry when pages are short, server budget 210 s with streamed heartbeats (Cloudflare 100 s idle limit) |
| No ambience / no character voices | Ambience manual only; character lines read by narrator | Writer returns per-page `ambient` + 0–2 `sfx`; player auto-plays ambience and sound effects (`auto_ambience`); characters are auto-cast to distinct default voices (`cast_voices`) using voice type (girl/boy/woman/man/grandma/grandpa/creature) |
| No scene pictures, no page turning | Category tile only | 18 bundled scene paintings chosen per page (`scene_id`), optional AI page illustrations with a character bible for consistency, book layout with 3D page-flip and page-turn sound |

## Flow

1. Wizard (4 steps): theme → cast → narrator/age/language/pace/voiced characters → summary, length, ambience, optional AI pictures.
2. `POST /api/story/generate` validates everything before streaming, writes the story (`generator_version = 2`), pages (illustration prompt, scene, mood, ambient, sfx) and characters (role, voice type, appearance, preset, auto-cast voice).
3. Player: `StoryBook` shows the page picture (AI illustration → scene art) and karaoke text; page changes animate a page flip (reduced-motion: fade). Ambience/SFX follow the page when `auto_ambience`.
4. AI illustrations (flag `ai_illustrations` + configured provider): `/api/story/illustrate-page` draws pages on demand, current page first, 2 at a time; stops on the first failure. Provider/model/quality are admin settings (`illustration_provider|model|quality`; default `gpt-image-2` / `gemini-2.5-flash-image`). DALL·E 3 is retired.

## Data (migration 033)

`stories`: `generator_version`, `story_length`, `narration_pace`, `cast_voices`, `auto_ambience`, `illustration_style`.
`story_pages`: `illustration_prompt`, `scene_id`, `mood`.
`story_characters`: `role`, `voice_type`, `appearance`, `preset_id`.
All additive with CHECK constraints; existing RLS applies.

## Limits / not in this slice

- Without an image provider key, pages use the bundled scene art (no per-story drawing).
- Voice casting uses the admin's active default voices for the story language; with one voice, characters share the narrator.
- Quality gate is length/structure based, not a human or child-tested quality review.
- Asset provenance: `docs/licenses/story-studio-v1.md`.
