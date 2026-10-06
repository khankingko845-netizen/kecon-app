#!/usr/bin/env bash
# Timer mỗi phút: nếu tunnel khởi động lại và đổi URL → restart kecon-web để tiêm URL mới.
set -uo pipefail
host=$(curl -fsS http://127.0.0.1:20241/quicktunnel 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("hostname",""))' 2>/dev/null)
[[ -n ${host:-} ]] || exit 0
if [[ "https://$host" != "$(cat /srv/kecon/shared/public-url 2>/dev/null)" ]]; then
  systemctl restart kecon-web
fi
