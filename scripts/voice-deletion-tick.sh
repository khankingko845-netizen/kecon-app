#!/usr/bin/env bash
# T12 · kecon-voice-deletion.timer (every 15 minutes): run the due voice deletions — withdrawn /
# deleted family voices at ElevenLabs, their recordings and the narration made with them — through
# the web app (POST /api/internal/voice-deletions, docs/voice-consent.md). Every deletion is due
# within 24 hours; a failed run is retried by the next tick. The service-role key reaches curl on
# stdin, never on a command line.
set -euo pipefail
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY missing (app.env)}"
url="${KECON_INTERNAL_URL:-http://127.0.0.1:3000}/api/internal/voice-deletions"
printf 'header = "Authorization: Bearer %s"\n' "$SUPABASE_SERVICE_ROLE_KEY" |
  curl -fsS -m 240 -K - -X POST -H 'Content-Type: application/json' --data '{}' "$url"
echo
