#!/usr/bin/env bash
# ExecStartPre cho kecon-web: chờ URL công khai của tunnel rồi "tiêm" vào bản build.
# Bản build dùng placeholder cho NEXT_PUBLIC_* (bị inline lúc build) → đổi URL tunnel
# hay xoay khoá anon không cần build lại: copy .next-template → .next và thay placeholder.
set -euo pipefail
KECON=/srv/kecon
APP=$KECON/current
PLACEHOLDER=kecon-public-origin.invalid   # host; build dùng https://<host> (CSP còn có wss://<host>)
ANON_PLACEHOLDER=kecon-anon-key-placeholder
ANON_KEY=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' "$KECON/shared/app.env" | cut -d= -f2-)
[[ -n $ANON_KEY ]] || { echo "Thiếu NEXT_PUBLIC_SUPABASE_ANON_KEY trong shared/app.env" >&2; exit 1; }

url=""
for _ in $(seq 1 90); do
  host=$(curl -fsS http://127.0.0.1:20241/quicktunnel 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("hostname",""))' 2>/dev/null || true)
  if [[ -n $host ]]; then url="https://$host"; break; fi
  sleep 2
done
[[ -n $url ]] || { echo "Không lấy được URL tunnel" >&2; exit 1; }
echo "$url" > "$KECON/shared/public-url"

# Biến runtime cho next start (next.config đọc lại lúc chạy)
{
  echo "NEXT_PUBLIC_SUPABASE_URL=$url"
  echo "NEXT_PUBLIC_SITE_URL=$url"
} > "$KECON/shared/runtime.env"

rm -rf "$APP/.next"
cp -a "$APP/.next-template" "$APP/.next"
grep -rlE "$PLACEHOLDER|$ANON_PLACEHOLDER" "$APP/.next" --exclude-dir=cache | xargs -r sed -i "s#$PLACEHOLDER#${url#https://}#g; s#$ANON_PLACEHOLDER#$ANON_KEY#g"
echo "kecon-web: PUBLIC_URL=$url"
