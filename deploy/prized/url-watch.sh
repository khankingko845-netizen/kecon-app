#!/usr/bin/env bash
# Timer mỗi phút:
# 1) Quick tunnel bị Cloudflare huỷ (vd. máy tạm dừng rồi thức dậy): cloudflared lặp lại
#    "Tunnel not found" mãi, URL cũ không còn phân giải → restart kecon-tunnel để lấy URL mới
#    (lượt sau thấy URL đổi → restart kecon-web). Chỉ đếm log của tiến trình đang chạy để
#    không restart lặp vì log của tiến trình cũ.
# 2) Tunnel khởi động lại và đổi URL → restart kecon-web để tiêm URL mới.
set -uo pipefail
URL_FILE=${KECON_PUBLIC_URL_FILE:-/srv/kecon/shared/public-url}

pid=$(systemctl show -p MainPID --value kecon-tunnel 2>/dev/null)
if [[ ${pid:-0} =~ ^[0-9]+$ && ${pid:-0} -gt 0 ]]; then
  dead=$(journalctl -u kecon-tunnel "_PID=$pid" --since "-2min" --no-pager -q 2>/dev/null | grep -c "Tunnel not found")
  if (( ${dead:-0} >= 3 )); then
    echo "kecon-urlwatch: Cloudflare đã huỷ quick tunnel (Tunnel not found ×$dead trong 2 phút) → restart kecon-tunnel"
    systemctl restart kecon-tunnel
    exit 0
  fi
fi

host=$(curl -fsS http://127.0.0.1:20241/quicktunnel 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("hostname",""))' 2>/dev/null)
[[ -n ${host:-} ]] || exit 0
if [[ "https://$host" != "$(cat "$URL_FILE" 2>/dev/null)" ]]; then
  systemctl restart kecon-web
fi
