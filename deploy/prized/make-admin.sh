#!/usr/bin/env bash
# Nâng một tài khoản đã đăng ký lên admin: bash make-admin.sh email@example.com
set -euo pipefail
EMAIL=${1:?email}
docker exec -i supabase_db_kecon-staging psql -U postgres -v ON_ERROR_STOP=1 -v email="$EMAIL" <<'SQL'
UPDATE public.profiles SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = :'email')
RETURNING id, role;
SQL
