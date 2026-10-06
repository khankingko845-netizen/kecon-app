#!/usr/bin/env bash
# ExecStart của kecon-web: tiêm URL tunnel vào build rồi chạy `next start` (chỉ localhost).
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
"$DIR/start-web.sh"
set -a
source /srv/kecon/shared/app.env
source /srv/kecon/shared/runtime.env
set +a
cd /srv/kecon/current
exec /opt/node/bin/node node_modules/next/dist/bin/next start -p 3000 -H 127.0.0.1
