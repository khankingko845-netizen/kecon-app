#!/usr/bin/env bash
# Tạo/cập nhật stack Supabase tự host (Supabase CLI + Docker) cho staging.
# - jwt_secret + publishable/secret key ngẫu nhiên (KHÔNG dùng khoá mặc định công khai của CLI)
# - migrations lấy từ release hiện tại (supabase/migrations)
# - chỉ bind localhost; Caddy mở ra ngoài đúng các đường dẫn API.
set -euo pipefail
KECON=/srv/kecon
STACK=$KECON/supabase-stack
SECRETS=$KECON/shared/supabase.secrets   # chmod 600, không commit
mkdir -p "$STACK/supabase"

if [[ ! -f $SECRETS ]]; then
  umask 077
  {
    echo "SUPABASE_JWT_SECRET=$(openssl rand -hex 32)"
    echo "SUPABASE_PUBLISHABLE_KEY=sb_publishable_$(openssl rand -hex 16)"
    echo "SUPABASE_SECRET_KEY=sb_secret_$(openssl rand -hex 16)"
  } > "$SECRETS"
fi
set -a; source "$SECRETS"; set +a

cd "$STACK"
[[ -f supabase/config.toml ]] || supabase init --yes >/dev/null 2>&1 || supabase init </dev/null >/dev/null

python3 - "$STACK/supabase/config.toml" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
def section_set(s, section, key, value):
    pat = re.compile(r"(^\[" + re.escape(section) + r"\]\n)(.*?)(?=^\[|\Z)", re.S | re.M)
    m = pat.search(s)
    body = m.group(2)
    line = f"{key} = {value}\n"
    kp = re.compile(r"^#?\s*" + re.escape(key) + r"\s*=.*\n", re.M)
    body = kp.sub(line, body, count=1) if kp.search(body) else line + body
    return s[: m.start(2)] + body + s[m.end(2):]
s = re.sub(r'^project_id = ".*"', 'project_id = "kecon-staging"', s, flags=re.M)
s = section_set(s, "auth", "jwt_secret", '"env(SUPABASE_JWT_SECRET)"')
s = section_set(s, "auth", "publishable_key", '"env(SUPABASE_PUBLISHABLE_KEY)"')
s = section_set(s, "auth", "secret_key", '"env(SUPABASE_SECRET_KEY)"')
s = section_set(s, "auth", "site_url", '"env(PUBLIC_URL)"')
s = section_set(s, "auth", "additional_redirect_urls", '["https://*.trycloudflare.com/**", "http://127.0.0.1:3000/**"]')
s = section_set(s, "auth.mfa.totp", "enroll_enabled", "true")
s = section_set(s, "auth.mfa.totp", "verify_enabled", "true")
s = section_set(s, "studio", "enabled", "false")
s = section_set(s, "analytics", "enabled", "false")
s = section_set(s, "edge_runtime", "enabled", "false")
open(p, "w").write(s)
PY

rsync_migrations() {
  rm -rf "$STACK/supabase/migrations" && cp -r "$KECON/current/supabase/migrations" "$STACK/supabase/migrations"
}
rsync_migrations
export PUBLIC_URL=${PUBLIC_URL:-$(cat "$KECON/shared/public-url" 2>/dev/null || echo http://127.0.0.1:3000)}
supabase start --workdir "$STACK" -x studio,logflare,vector,edge-runtime,supavisor "$@"
