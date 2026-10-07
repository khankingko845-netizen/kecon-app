#!/usr/bin/env bash
# Deploy KểCon lên máy staging (prized.dev). Chạy trên máy chủ:
#   bash deploy.sh /tmp/kecon-<sha>.tar.gz <sha>
# (máy dev: `git archive --format=tar.gz -o /tmp/kecon-$SHA.tar.gz HEAD` rồi scp lên)
set -euo pipefail
TARBALL=$1; SHA=$2
KECON=/srv/kecon
REL=$KECON/releases/$SHA
PLACEHOLDER=https://kecon-public-origin.invalid
ANON_PLACEHOLDER=kecon-anon-key-placeholder
export PATH=/opt/node/bin:$PATH

mkdir -p "$REL" && tar -xzf "$TARBALL" -C "$REL"

cd "$REL"
npm ci --no-audit --no-fund --loglevel=error
NEXT_TELEMETRY_DISABLED=1 \
NEXT_PUBLIC_SUPABASE_URL=$PLACEHOLDER \
NEXT_PUBLIC_SITE_URL=$PLACEHOLDER \
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_PLACEHOLDER \
  npm run build -- --webpack
rm -rf .next/cache && mv .next .next-template

ln -sfn "$REL" "$KECON/current"
echo "$SHA" > "$KECON/shared/release"
# Migration mới (nếu có) cho Supabase staging
rm -rf "$KECON/supabase-stack/supabase/migrations" && cp -r "$REL/supabase/migrations" "$KECON/supabase-stack/supabase/migrations"
( set -a; source "$KECON/shared/supabase.secrets"; PUBLIC_URL=$(cat "$KECON/shared/public-url" 2>/dev/null || echo http://127.0.0.1:3000); set +a
  supabase migration up --workdir "$KECON/supabase-stack" --local )
# A-05: existing CLI stacks default TOTP off. Restart preserves DB/volumes and
# the startup script sets both flags. Never reset/wipe the stack.
if ! docker exec supabase_auth_kecon-staging printenv GOTRUE_MFA_TOTP_ENROLL_ENABLED | grep -qx true || \
   ! docker exec supabase_auth_kecon-staging printenv GOTRUE_MFA_TOTP_VERIFY_ENABLED | grep -qx true; then
  sudo systemctl restart kecon-supabase
fi
docker exec supabase_auth_kecon-staging printenv GOTRUE_MFA_TOTP_ENROLL_ENABLED | grep -qx true
docker exec supabase_auth_kecon-staging printenv GOTRUE_MFA_TOTP_VERIFY_ENABLED | grep -qx true
# T07 additive measurement tables have been migrated before scheduling retention.
sudo install -m 644 "$REL/deploy/prized/kecon-measurement-retention.service" /etc/systemd/system/
sudo install -m 644 "$REL/deploy/prized/kecon-measurement-retention.timer" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kecon-measurement-retention.timer
sudo systemctl start kecon-measurement-retention.service
# Giữ 3 bản gần nhất
ls -1dt "$KECON"/releases/* | tail -n +4 | xargs -r rm -rf
sudo systemctl restart kecon-web
echo "DEPLOYED $SHA"
