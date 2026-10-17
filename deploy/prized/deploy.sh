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
  npm run build
rm -rf .next/cache && mv .next .next-template

ln -sfn "$REL" "$KECON/current"
echo "$SHA" > "$KECON/shared/release"
# Mọi unit systemd theo release này (User= = chủ /srv/kecon; không restart dịch vụ đang chạy)
bash "$REL/deploy/prized/install-units.sh" "$REL"
# Migration mới (nếu có) cho Supabase staging
rm -rf "$KECON/supabase-stack/supabase/migrations" && cp -r "$REL/supabase/migrations" "$KECON/supabase-stack/supabase/migrations"
( set -a; source "$KECON/shared/supabase.secrets"; PUBLIC_URL=$(cat "$KECON/shared/public-url" 2>/dev/null || echo http://127.0.0.1:3000); set +a
  supabase migration up --workdir "$KECON/supabase-stack" --local )
bash "$REL/deploy/prized/pin-root-key.sh"   # khoá gốc Vault → /srv/kecon/shared (sao lưu cùng server-config)
# A-05: existing CLI stacks default TOTP off. Restart preserves DB/volumes and
# the startup script sets both flags. Never reset/wipe the stack.
if ! docker exec supabase_auth_kecon-staging printenv GOTRUE_MFA_TOTP_ENROLL_ENABLED | grep -qx true || \
   ! docker exec supabase_auth_kecon-staging printenv GOTRUE_MFA_TOTP_VERIFY_ENABLED | grep -qx true; then
  sudo systemctl restart kecon-supabase
fi
docker exec supabase_auth_kecon-staging printenv GOTRUE_MFA_TOTP_ENROLL_ENABLED | grep -qx true
docker exec supabase_auth_kecon-staging printenv GOTRUE_MFA_TOTP_VERIFY_ENABLED | grep -qx true
# T07 additive measurement tables have been migrated before scheduling retention.
sudo systemctl enable --now kecon-measurement-retention.timer
sudo systemctl start kecon-measurement-retention.service
# G-07 parent reminders (migration 036). Without VAPID keys the job exits without claiming.
sudo systemctl enable --now kecon-parent-notify.timer
# Sao lưu GitHub (deploy/prized/backup, migration 040): timer 2 phút, giờ chạy / số bản giữ lại / token /
# "Sao lưu ngay" ở Admin › Sao lưu. Luôn bật: thiếu mật khẩu mã hoá hoặc quyền đẩy thì worker báo đỏ trên
# trang quản trị thay vì im lặng. restart = nạp lịch mới; lượt sao lưu đang chạy (service) không bị dừng.
sudo systemctl enable kecon-backup.timer
sudo systemctl restart kecon-backup.timer
# Giữ 3 bản gần nhất
ls -1dt "$KECON"/releases/* | tail -n +4 | xargs -r rm -rf
sudo systemctl restart kecon-web
# T12 voice deletions (migration 043): every 15 min through the new web release (POST /api/internal/voice-deletions).
sudo systemctl enable --now kecon-voice-deletion.timer
echo "DEPLOYED $SHA"
