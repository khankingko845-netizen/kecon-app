#!/usr/bin/env bash
# Cài/cập nhật mọi unit systemd của KểCon từ một release. @KECON_USER@/@KECON_HOME@ trong unit
# được thay bằng user chạy app = chủ sở hữu /srv/kecon (setup-server.sh đã chown). Không restart gì.
#   bash install-units.sh /srv/kecon/releases/<sha>
set -euo pipefail
REL=${1:-/srv/kecon/current}
APP_USER=${KECON_USER:-$(stat -c %U /srv/kecon)}
APP_HOME=$(getent passwd "$APP_USER" | cut -d: -f6)
[[ $APP_USER != root && -n $APP_HOME ]] || { echo "install-units: user chạy app không hợp lệ: '$APP_USER'" >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
n=0
for f in "$REL"/deploy/prized/systemd/*.{service,timer} "$REL"/deploy/prized/*.{service,timer} "$REL"/deploy/prized/backup/*.{service,timer}; do
  [[ -f $f ]] || continue
  out=$tmp/$(basename "$f")
  sed "s#@KECON_USER@#$APP_USER#g; s#@KECON_HOME@#$APP_HOME#g" "$f" > "$out"
  if grep -q '@KECON_' "$out"; then echo "install-units: còn placeholder trong $f" >&2; exit 1; fi
  sudo install -m 644 "$out" "/etc/systemd/system/$(basename "$f")"
  n=$((n + 1))
done
sudo systemctl daemon-reload
echo "UNITS_OK $n units, User=$APP_USER"
