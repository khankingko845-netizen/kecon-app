#!/usr/bin/env python3
"""KểCon — khôi phục bản sao lưu GitHub (repo kecon-backup) vào stack Supabase (CLI) của một máy mới.

  kecon_restore.py db <kecon.dump> --yes [--root-key <pgsodium_root.key>] [--replace-existing]
      Thay database `postgres` của stack bằng bản dump: dừng các container khác của stack, DROP DATABASE …
      WITH (FORCE), `pg_restore --create` bằng supabase_admin (giữ owner + quyền + cấu hình DB), bật lại
      các container → kiểm tra số dòng, Vault giải mã được hết, không lỗi pg_restore. --root-key: dừng
      ngay nếu stack đang dùng khoá gốc Vault khác bản sao lưu. Từ chối nếu DB hiện tại đã có tài khoản
      (chống chạy nhầm trên máy đang dùng) trừ khi thêm --replace-existing.
  kecon_restore.py media <checkout> [--private <bucket>.tar …]
      Chép file Storage vào file backend đúng `<bucket>/<tên object>/<version>` (version lấy từ
      storage.objects đã khôi phục) và đặt lại content-type/cache-control (xattr của Storage — thiếu thì
      Storage trả `application/octet-stream`). Tranh/audio: `<checkout>/media/…` (kiểm sha256 theo
      media/manifest.json); bucket riêng tư: các file .tar đã giải mã từ encrypted/<bucket>.tar.gpg.

Container: KECON_DB_CONTAINER (mặc định supabase_db_kecon-staging), KECON_STORAGE_CONTAINER
(supabase_storage_kecon-staging). Trình tự đầy đủ khi chuyển máy: README của repo backup /
deploy/prized/README.md. Exit: 0 ok · 4 kiểm tra không đạt · 2 sai tham số/từ chối.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
from pathlib import Path

DB = os.environ.get("KECON_DB_CONTAINER", "supabase_db_kecon-staging")
STORAGE = os.environ.get("KECON_STORAGE_CONTAINER", "supabase_storage_kecon-staging")
SUPERUSER = os.environ.get("KECON_DB_SUPERUSER", "supabase_admin")
ROOT_KEY_FILE = "/etc/postgresql-custom/pgsodium_root.key"
STORAGE_ROOT = os.environ.get("KECON_STORAGE_ROOT", "/mnt/stub/stub")  # file backend: <root>/<bucket>/<name>/<version>
PLAIN_BUCKETS = ("illustrations", "tts-cache")
XATTR = {"mimetype": "user.supabase.content-type", "cacheControl": "user.supabase.cache-control",
         "contentEncoding": "user.supabase.content-encoding"}

COUNT_SQL = r"""
select json_object_agg(t, n order by t) from (
  select 'auth.users' t, count(*) n from auth.users union all
  select 'public.households', count(*) from public.households union all
  select 'public.stories', count(*) from public.stories union all
  select 'public.story_pages', count(*) from public.story_pages union all
  select 'storage.objects', count(*) from storage.objects union all
  select 'vault.secrets', count(*) from vault.secrets) x;
"""
VAULT_SQL = "select json_build_object('secrets', count(*), 'decrypted', count(decrypted_secret)) from vault.decrypted_secrets;"
OBJECTS_SQL = r"""
select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket_id, 'name', name, 'version', version,
  'size', (metadata->>'size')::bigint, 'mimetype', metadata->>'mimetype', 'cacheControl', metadata->>'cacheControl',
  'contentEncoding', metadata->>'contentEncoding') order by bucket_id, name), '[]'::jsonb)
from storage.objects;
"""

# Runs INSIDE the storage container (python3 there): read a tar on stdin, write each file under ROOT and
# set the xattrs carried in the member's pax headers (KECON.xattr.<name>). Prints a JSON summary.
EXTRACT_PY = r"""
import json, os, sys, tarfile
root = os.path.realpath(sys.argv[1]); n = 0; size = 0
with tarfile.open(fileobj=sys.stdin.buffer, mode="r|") as tf:
    for m in tf:
        parts = m.name.split("/")
        if not m.isfile() or m.name.startswith("/") or any(p in ("", ".", "..") for p in parts):
            raise SystemExit("unsafe member: " + m.name)
        dest = os.path.join(root, *parts)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        tmp = dest + ".kecon-restore"
        with open(tmp, "wb") as out:
            out.write(tf.extractfile(m).read())
        for k, v in m.pax_headers.items():
            if k.startswith("KECON.xattr."):
                os.setxattr(tmp, k[len("KECON.xattr."):], v.encode())
        os.replace(tmp, dest)
        n += 1; size += m.size
print(json.dumps({"written": n, "bytes": size}))
"""


def run(cmd: list[str], *, input: bytes | None = None, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, input=input, capture_output=True, check=check)


def psql(sql: str, db: str = "postgres") -> str:
    return run(["docker", "exec", "-i", DB, "psql", "-U", SUPERUSER, "-d", db, "-At", "-v", "ON_ERROR_STOP=1"],
               input=sql.encode()).stdout.decode()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def object_path(o: dict) -> str:
    """Path of an object in the file backend (relative to STORAGE_ROOT)."""
    return f"{o['bucket']}/{o['name']}" + (f"/{o['version']}" if o.get("version") else "")


def xattrs(o: dict) -> dict[str, str]:
    return {f"KECON.xattr.{attr}": o[key] for key, attr in XATTR.items() if o.get(key)}


def plan_media(objs: list[dict], checkout: Path | None, private: dict[str, bytes]) -> tuple[list, list, list]:
    """(files to write [(path, data, pax)], missing object keys, sha256/size mismatches) for restored objects."""
    manifest = {}
    if checkout and (checkout / "media" / "manifest.json").exists():
        manifest = json.loads((checkout / "media" / "manifest.json").read_text())
    todo, missing, bad = [], [], []
    for o in objs:
        key = f"{o['bucket']}/{o['name']}"
        if o["bucket"] in PLAIN_BUCKETS:
            src = checkout / "media" / key if checkout else None
            data = src.read_bytes() if src and src.is_file() else None
            want = manifest.get(key, {}).get("sha256")
            if data is not None and want and sha256(data) != want:
                bad.append(key)
        else:
            data = private.get(key)
        if data is None:
            missing.append(key)
            continue
        if o.get("size") is not None and len(data) != o["size"]:
            bad.append(key)
        todo.append((object_path(o), data, xattrs(o)))
    return todo, missing, bad


def build_tar(files: list[tuple[str, bytes, dict]]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.PAX_FORMAT) as tf:
        for path, data, pax in files:
            ti = tarfile.TarInfo(path)
            ti.size, ti.mode, ti.pax_headers = len(data), 0o644, dict(pax)
            tf.addfile(ti, io.BytesIO(data))
    return buf.getvalue()


def read_private(tars: list[str]) -> dict[str, bytes]:
    out = {}
    for t in tars:
        with tarfile.open(t) as tf:
            for m in tf:
                if m.isfile():
                    out[m.name.lstrip("./")] = tf.extractfile(m).read()
    return out


def project_containers() -> list[str]:
    """Running containers of DB's Supabase CLI project (supabase_<service>_<project>) except DB itself."""
    if not DB.startswith("supabase_db_"):
        return []
    project = DB[len("supabase_db_"):]
    names = run(["docker", "ps", "--format", "{{.Names}}"]).stdout.decode().split()
    return sorted(n for n in names if n.startswith("supabase_") and n.endswith("_" + project) and n != DB)


def cmd_db(a: argparse.Namespace) -> int:
    dump = Path(a.dump)
    with open(dump, "rb") as fh:
        toc = run(["docker", "exec", "-i", DB, "pg_restore", "-l"], input=fh.read()).stdout.decode()
    table_data = sum(1 for line in toc.splitlines() if " TABLE DATA " in line)
    if table_data < 50:
        print(f"dump trông không đúng: chỉ {table_data} mục TABLE DATA", file=sys.stderr)
        return 2
    if a.root_key:
        want = Path(a.root_key).read_bytes().strip()
        have = run(["docker", "exec", DB, "cat", ROOT_KEY_FILE], check=False).stdout.strip()
        if want != have:
            print(f"Khoá gốc Vault trong {DB} KHÁC {a.root_key} → khôi phục xong Vault sẽ không giải mã được. Đặt file đó vào "
                  "/srv/kecon/shared/pgsodium_root.key, tạo lại stack (sudo systemctl restart kecon-supabase) rồi chạy lại.",
                  file=sys.stderr)
            return 2
    try:
        users = int(psql("select count(*) from auth.users;").strip() or 0)
    except subprocess.CalledProcessError:  # stack chưa có schema auth
        users = 0
    if not a.yes or (users and not a.replace_existing):
        print(f"Sẽ XOÁ database `postgres` trong {DB} (đang có {users} tài khoản) rồi khôi phục từ {dump.name}. "
              "Chạy lại với --yes" + (" --replace-existing" if users else "") + ".", file=sys.stderr)
        return 2
    # Auth/Storage/PostgREST… tự chạy migration khi kết nối lại — dừng chúng trong lúc thay DB rồi bật lại.
    others = project_containers()
    if others:
        run(["docker", "stop", *others])
    try:
        psql("drop database if exists postgres with (force);", db="template1")
        with open(dump, "rb") as fh:
            r = subprocess.run(["docker", "exec", "-i", DB, "pg_restore", "-U", SUPERUSER, "-d", "template1", "--create"],
                               stdin=fh, capture_output=True)
    finally:
        if others:
            run(["docker", "start", *others], check=False)
    errors = [ln for ln in r.stderr.decode().splitlines() if "error:" in ln]
    if r.returncode != 0 and not errors:
        errors = [f"pg_restore exit {r.returncode}"]
    rows = json.loads(psql(COUNT_SQL))
    try:
        vault = json.loads(psql(VAULT_SQL))
    except subprocess.CalledProcessError as e:
        vault = {"error": (e.stderr or b"").decode().strip()[-300:]}
    ok = not errors and "error" not in vault and vault.get("decrypted") == vault.get("secrets")
    print(json.dumps({"ok": ok, "table_data_entries": table_data, "pg_restore_errors": len(errors), "first_errors": errors[:5],
                      "rows": rows, "vault": vault}, ensure_ascii=False, indent=1))
    if "error" in vault or vault.get("decrypted") != vault.get("secrets"):
        print("Vault không giải mã được: khoá gốc khác máy cũ → đặt /srv/kecon/shared/pgsodium_root.key từ server-config "
              "rồi tạo lại stack (sudo systemctl restart kecon-supabase) và khôi phục lại.", file=sys.stderr)
    return 0 if ok else 4


def cmd_media(a: argparse.Namespace) -> int:
    objs = json.loads(psql(OBJECTS_SQL))
    checkout = Path(a.checkout) if a.checkout else None
    files, missing, bad = plan_media(objs, checkout, read_private(a.private))
    written = {"written": 0, "bytes": 0}
    for i in range(0, len(files), 200):
        r = run(["docker", "exec", "-i", STORAGE, "python3", "-c", EXTRACT_PY, STORAGE_ROOT], input=build_tar(files[i:i + 200]))
        part = json.loads(r.stdout.decode().strip().splitlines()[-1])
        written = {k: written[k] + part[k] for k in written}
    by_bucket: dict[str, int] = {}
    for path, _, _ in files:
        by_bucket[path.split("/", 1)[0]] = by_bucket.get(path.split("/", 1)[0], 0) + 1
    ok = not missing and not bad
    print(json.dumps({"ok": ok, "objects": len(objs), **written, "by_bucket": by_bucket, "missing": len(missing),
                      "first_missing": missing[:5], "mismatch": len(bad), "first_mismatch": bad[:5]}, ensure_ascii=False, indent=1))
    return 0 if ok else 4


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("db", help="thay database postgres bằng bản dump (supabase_admin) + kiểm tra Vault")
    d.add_argument("dump")
    d.add_argument("--yes", action="store_true")
    d.add_argument("--replace-existing", action="store_true")
    d.add_argument("--root-key", help="srv/kecon/shared/pgsodium_root.key từ server-config: dừng nếu stack dùng khoá khác")
    m = sub.add_parser("media", help="chép file Storage vào file backend + content-type")
    m.add_argument("checkout", nargs="?", help="thư mục repo backup (nhánh main)")
    m.add_argument("--private", action="append", default=[], help="tar đã giải mã của bucket riêng tư (lặp lại được)")
    a = ap.parse_args(argv)
    return cmd_db(a) if a.cmd == "db" else cmd_media(a)


if __name__ == "__main__":
    sys.exit(main())
