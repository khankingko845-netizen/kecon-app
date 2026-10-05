<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agent skills

Project skills live in `.agents/skills/<skill>/SKILL.md`. Before starting a task, open `.agents/skills/ROLES.md`, pick the skills for your role (PM, BA, UX/UI, Architect, Frontend/Backend Dev, QA, Reviewer, DevOps, Tech Writer) and read their `SKILL.md`.

# Project rules

- All external API keys stay server-side; client calls only `/api/*`.
- Every API route that calls a paid AI/TTS provider must call `guardUsage()` from `src/lib/usage-guard.ts` after auth and key resolution.
- Never trust a client-supplied base URL unless the client also supplies its own API key (`resolveCustomBaseUrl(userUrl, userKey)`).
- Database changes go in a new numbered file in `supabase/migrations/`; keep RLS enabled on every table.
- Before claiming work is done: `npx tsc --noEmit`, `npm run lint`, `npm run build`.
