#!/usr/bin/env bash
# Lần đầu trên máy staging (idempotent). Cần đã chạy deploy/prized/setup-server.sh (sudo).
#   bash bootstrap.sh /tmp/kecon-<sha>.tar.gz <sha>
set -euo pipefail
TARBALL=$1; SHA=$2
KECON=/srv/kecon
HERE=$KECON/releases/$SHA/deploy/prized
mkdir -p "$KECON/releases/$SHA" "$KECON/shared"
tar -xzf "$TARBALL" -C "$KECON/releases/$SHA"
ln -sfn "$KECON/releases/$SHA" "$KECON/current"

sudo cp "$HERE"/systemd/*.service "$HERE"/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kecon-tunnel kecon-proxy
sudo systemctl enable kecon-supabase kecon-web kecon-urlwatch.timer
sudo systemctl start kecon-supabase   # lần đầu: kéo image Docker + chạy migrations

# Khoá Supabase sinh từ jwt_secret riêng → env cho app (phải nạp secrets, nếu không CLI dùng secret mặc định)
set -a; source "$KECON/shared/supabase.secrets"; set +a
eval "$(supabase status --workdir "$KECON/supabase-stack" -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY)=')"
umask 077
if [[ ! -f $KECON/shared/app.env ]]; then
  cat > "$KECON/shared/app.env" <<ENV
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
# Điền key nhà cung cấp AI (server-side) rồi: sudo systemctl restart kecon-web
ELEVENLABS_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
ANTHROPIC_API_KEY=
ENV
fi
bash "$HERE/deploy.sh" "$TARBALL" "$SHA"
sudo systemctl start kecon-urlwatch.timer
echo "PUBLIC_URL=$(cat $KECON/shared/public-url)"
