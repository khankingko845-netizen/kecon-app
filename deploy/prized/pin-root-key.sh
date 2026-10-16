#!/usr/bin/env bash
# Ghim khoá gốc Vault/pgsodium của container DB vào /srv/kecon/shared/pgsodium_root.key (chmod 600).
# Key nhà cung cấp AI trong Vault được mã hoá bằng khoá này; Supabase CLI chỉ ghi nó vào container lúc
# TẠO container (mặc định = khoá của bản CLI đó). supabase-stack.sh đưa file ghim cho CLI
# (SUPABASE_DB_ROOT_KEY) → đổi bản CLI / tạo lại stack / chuyển máy (chép /srv/kecon/shared từ bản sao lưu
# TRƯỚC bootstrap) vẫn giải mã được Vault. Đã có file: chỉ cảnh báo nếu container dùng khoá khác.
set -euo pipefail
ROOT_KEY=${KECON_ROOT_KEY_FILE:-/srv/kecon/shared/pgsodium_root.key}
DB=${KECON_DB_CONTAINER:-supabase_db_kecon-staging}
IN_USE=$(docker exec "$DB" cat /etc/postgresql-custom/pgsodium_root.key 2>/dev/null || true)
if [[ ! $IN_USE =~ ^[0-9a-f]{64}$ ]]; then
  echo "pin-root-key: không đọc được khoá gốc Vault trong $DB — bỏ qua" >&2
  exit 0
fi
if [[ ! -s $ROOT_KEY ]]; then
  ( umask 077; printf '%s\n' "$IN_USE" > "$ROOT_KEY.tmp" && mv "$ROOT_KEY.tmp" "$ROOT_KEY" )
  echo "pin-root-key: đã ghim khoá gốc Vault vào $ROOT_KEY"
elif [[ $IN_USE != "$(tr -d '[:space:]' < "$ROOT_KEY")" ]]; then
  echo "CẢNH BÁO: $DB dùng khoá gốc Vault KHÁC $ROOT_KEY → key AI trong Vault có thể không giải mã được" \
       "(xem deploy/prized/README.md › Chuyển sang máy mới)" >&2
fi
