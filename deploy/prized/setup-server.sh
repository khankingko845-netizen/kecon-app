#!/bin/bash
# Cài công cụ cho máy staging (Ubuntu 24.04): sudo bash setup-server.sh
set -euo pipefail
# Node 24 LTS
if ! /opt/node/bin/node -v 2>/dev/null | grep -q '^v24'; then
  V=$(curl -fsSL https://nodejs.org/dist/index.json | python3 -c 'import json,sys; print(next(r["version"] for r in json.load(sys.stdin) if r["version"].startswith("v24.")))')
  curl -fsSL "https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz" -o /tmp/node.tar.xz
  rm -rf /opt/node && mkdir -p /opt/node && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
  ln -sf /opt/node/bin/node /usr/local/bin/node; ln -sf /opt/node/bin/npm /usr/local/bin/npm; ln -sf /opt/node/bin/npx /usr/local/bin/npx
fi
node -v
# Supabase CLI
if ! command -v supabase >/dev/null; then
  URL=$(curl -fsSL https://api.github.com/repos/supabase/cli/releases/latest | python3 -c 'import json,sys; print(next(a["browser_download_url"] for a in json.load(sys.stdin)["assets"] if a["name"].endswith("_linux_amd64.deb")))')
  curl -fsSL "$URL" -o /tmp/supabase.deb && dpkg -i /tmp/supabase.deb >/dev/null
fi
supabase --version
# cloudflared
if ! command -v cloudflared >/dev/null; then
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared
fi
cloudflared --version
# caddy
if ! command -v caddy >/dev/null; then
  URL=$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest | python3 -c 'import json,sys; print(next(a["browser_download_url"] for a in json.load(sys.stdin)["assets"] if a["name"].endswith("_linux_amd64.tar.gz")))')
  curl -fsSL "$URL" -o /tmp/caddy.tgz && tar -xzf /tmp/caddy.tgz -C /usr/local/bin caddy && chmod +x /usr/local/bin/caddy
fi
caddy version
usermod -aG docker doppel
mkdir -p /srv/kecon/releases /srv/kecon/shared && chown -R doppel:doppel /srv/kecon
echo SETUP_OK
