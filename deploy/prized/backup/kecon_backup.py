#!/usr/bin/env python3
"""KểCon → GitHub backup (private repo khankingko845-netizen/kecon-backup).

Runs on the staging server as the app user (deploy/prized/backup: systemd
kecon-backup.timer, daily 03:15 Asia/Ho_Chi_Minh). Two branches:

  main          readable stories (story.json + README.md per story) with their
                illustrations and narration audio, a story index, and —
                encrypted — every private bucket (voice recordings, family
                avatars, …) and the server config incl. the Vault root key.
  db-snapshots  encrypted full database dumps (pg_dump -Fc), rolling 7 daily +
                4 weekly + 6 monthly, force-pushed as ONE orphan commit so the
                repo does not grow by a full dump every day.

Nothing secret leaves the server in clear text: the database (accounts,
PIN hashes, provider keys), private media and config are AES-256 encrypted
with `gpg --symmetric` using BASE/passphrase. Story text, pictures and audio are
plain so they can be read straight on GitHub.

Provider API keys live in Supabase Vault (vault.secrets), encrypted with the
DB container's pgsodium root key (/etc/postgresql-custom/pgsodium_root.key,
written by the Supabase CLI when it creates the container). A dump restored on a
server with another root key keeps the rows but cannot decrypt them, so the key
in use is stored in server-config as srv/kecon/shared/pgsodium_root.key —
supabase-stack.sh passes that file to the CLI (SUPABASE_DB_ROOT_KEY).
Restoring needs the image superuser (supabase_admin): as `postgres` the Vault
rows are refused ("permission denied for table secrets"). Restore steps and
the server-migration runbook: README below / deploy/prized/README.md;
kecon_restore.py does the DB + Storage part.

Push credentials (BASE, chmod 600, never committed): `github-token` (fine-grained
token with Contents read/write on the backup repo → HTTPS) or `deploy_key` (SSH
deploy key with write access). The token is read by a git credential helper at
push time, so it never appears in a command line or in .git/config.

Usage: kecon_backup.py [--no-push] [--verify-restore]
  --verify-restore  decrypt the newest DB snapshot, pg_restore it into a scratch
                    database (as supabase_admin, with owners + privileges) and
                    compare row counts and the decrypted Vault with the live DB;
                    any pg_restore error fails the check.
Exit: 0 ok · 3 local backup ok but push failed · 4 restore check failed · 1 error.
"""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unicodedata
from pathlib import Path

BASE = Path(os.environ.get("KECON_BACKUP_BASE", "/srv/kecon/backup-github"))
REPO = BASE / "repo"
SNAP_REPO = BASE / "snap-repo"
SNAPS = BASE / "snapshots"
TMP = BASE / "tmp"
PASSPHRASE = BASE / "passphrase"
GNUPGHOME = BASE / "gnupg"
TOKEN = BASE / "github-token"
REPO_SLUG = os.environ.get("KECON_BACKUP_REPO", "khankingko845-netizen/kecon-backup")
REMOTE = os.environ.get("KECON_BACKUP_REMOTE") or (
    f"https://github.com/{REPO_SLUG}.git" if TOKEN.exists() else f"git@github.com:{REPO_SLUG}.git")
DB = os.environ.get("KECON_DB_CONTAINER", "supabase_db_kecon-staging")
STORAGE = os.environ.get("KECON_STORAGE_CONTAINER", "supabase_storage_kecon-staging")
SUPERUSER = os.environ.get("KECON_DB_SUPERUSER", "supabase_admin")  # superuser of the Supabase postgres image
ROOT_KEY_FILE = "/etc/postgresql-custom/pgsodium_root.key"  # in the DB container (Vault/pgsodium root key)
ROOT_KEY_ENTRY = "srv/kecon/shared/pgsodium_root.key"  # its place in server-config (= where supabase-stack.sh reads it)
STORAGE_ROOT = "/mnt/stub/stub"  # file backend: <root>/<bucket>/<object name>/<version>
PLAIN_BUCKETS = ("illustrations", "tts-cache")  # public story media → readable files in media/
# Every other bucket (recordings, family-avatars, any new one) → encrypted/<bucket>.tar.gpg
CONFIG_GLOBS = ["/srv/kecon/shared/*", "/etc/systemd/system/kecon*.service", "/etc/systemd/system/kecon*.timer",
                "/srv/kecon/supabase-stack/supabase/config.toml"]
KEEP_DAILY, KEEP_WEEKLY, KEEP_MONTHLY = 7, 4, 6
GIT_ENV = {
    "GIT_SSH_COMMAND": f"ssh -i {BASE / 'deploy_key'} -o IdentitiesOnly=yes -o BatchMode=yes "
                       f"-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile={BASE / 'known_hosts'}",
    "GIT_AUTHOR_NAME": "KểCon Backup", "GIT_AUTHOR_EMAIL": "backup@kecon.invalid",
    "GIT_COMMITTER_NAME": "KểCon Backup", "GIT_COMMITTER_EMAIL": "backup@kecon.invalid",
    "GIT_TERMINAL_PROMPT": "0",
}
if TOKEN.exists():  # HTTPS: helper prints the token only when git asks for it
    GIT_ENV |= {"GIT_CONFIG_COUNT": "2", "GIT_CONFIG_KEY_0": "credential.helper", "GIT_CONFIG_VALUE_0": "",
                "GIT_CONFIG_KEY_1": "credential.helper",
                "GIT_CONFIG_VALUE_1": f"!f() {{ test \"$1\" = get || exit 0; echo username=x-access-token; "
                                      f"printf 'password=%s\\n' \"$(cat '{TOKEN}')\"; }}; f"}
NOW = dt.datetime.now(dt.timezone.utc)
STAMP = NOW.strftime("%Y%m%dT%H%M%SZ")
VN = dt.timezone(dt.timedelta(hours=7))


def log(msg: str) -> None:
    print(f"[{dt.datetime.now(dt.timezone.utc):%H:%M:%S}] {msg}", flush=True)


def run(cmd: list[str], *, input: bytes | None = None, cwd: Path | None = None, env: dict | None = None,
        check: bool = True) -> subprocess.CompletedProcess:
    e = {**os.environ, **(env or {})}
    return subprocess.run(cmd, input=input, cwd=cwd, env=e, check=check, capture_output=True)


def git(repo: Path, *args: str, check: bool = True) -> str:
    return run(["git", "-C", str(repo), *args], env=GIT_ENV, check=check).stdout.decode().strip()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def psql(sql: str, db: str = "postgres", user: str = "postgres") -> str:
    out = run(["docker", "exec", "-i", DB, "psql", "-U", user, "-d", db, "-At", "-v", "ON_ERROR_STOP=1"], input=sql.encode())
    return out.stdout.decode()


def encrypt(plain: Path, out: Path) -> None:
    GNUPGHOME.mkdir(mode=0o700, exist_ok=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(out.suffix + ".part")
    run(["gpg", "--homedir", str(GNUPGHOME), "--batch", "--yes", "--quiet", "--pinentry-mode", "loopback",
         "--passphrase-file", str(PASSPHRASE), "--symmetric", "--cipher-algo", "AES256", "--s2k-digest-algo", "SHA512",
         "--compress-algo", "none", "-o", str(tmp), str(plain)])
    tmp.replace(out)


def decrypt_to(enc: Path, out: Path) -> None:
    run(["gpg", "--homedir", str(GNUPGHOME), "--batch", "--yes", "--quiet", "--pinentry-mode", "loopback",
         "--passphrase-file", str(PASSPHRASE), "-o", str(out), "-d", str(enc)])


# ---------------------------------------------------------------- stories ---

STORIES_SQL = r"""
select coalesce(jsonb_agg((to_jsonb(s) - 'embedding') || jsonb_build_object(
  'pages', coalesce((select jsonb_agg(to_jsonb(p) order by p.page_number) from public.story_pages p where p.story_id = s.id), '[]'::jsonb),
  'characters', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order nulls last, c.created_at) from public.story_characters c where c.story_id = s.id), '[]'::jsonb)
) order by s.created_at, s.id), '[]'::jsonb)
from public.stories s;
"""
OBJECTS_SQL = r"""
select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket_id, 'name', name, 'version', version,
  'size', (metadata->>'size')::bigint, 'mimetype', metadata->>'mimetype', 'updated_at', updated_at) order by bucket_id, name), '[]'::jsonb)
from storage.objects where version is not null;
"""
BUCKETS_SQL = "select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from storage.buckets;"
STORAGE_URL = re.compile(r"/storage/v1/object/(?:public|sign|authenticated)/([^/?#]+)/([^?#]+)")


def slugify(text: str, limit: int = 48) -> str:
    t = unicodedata.normalize("NFKD", (text or "").replace("đ", "d").replace("Đ", "D"))
    t = "".join(ch for ch in t if not unicodedata.combining(ch)).lower()
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")
    return (t[:limit].rstrip("-")) or "truyen"


def story_group(s: dict) -> str:
    if s.get("is_template") or s.get("source") == "template":
        return "mau"
    if s.get("household_id") or not s.get("is_platform_content"):
        return "gia-dinh"
    return "thu-vien"


GROUP_TITLE = {"gia-dinh": "Truyện gia đình đã tạo", "thu-vien": "Truyện thư viện", "mau": "Truyện mẫu"}


def story_dir(s: dict) -> str:
    day = (s.get("created_at") or "")[:10] or "0000-00-00"
    return f"stories/{story_group(s)}/{day}-{slugify(s.get('title'))}-{s['id'][:8]}"


def media_rel(url: str | None, objects: dict) -> str | None:
    if not url:
        return None
    m = STORAGE_URL.search(url)
    if not m:
        return None
    key = f"{m.group(1)}/{m.group(2)}"
    return f"media/{key}" if key in objects else None


def readable_text(content: str) -> str:
    def char(m: re.Match) -> str:
        return f"**{m.group(1).strip()}:** {m.group(2).strip()}"
    t = re.sub(r"\[character:([^\]]+)\](.*?)\[/character\]", char, content or "", flags=re.S)
    t = re.sub(r"\[narrator\](.*?)\[/narrator\]", lambda m: m.group(1).strip(), t, flags=re.S)
    t = re.sub(r"\[/?[a-z_]+(?::[^\]]*)?\]", "", t)
    return "\n\n".join(line.strip() for line in t.splitlines() if line.strip())


def story_markdown(s: dict, objects: dict, depth: int) -> str:
    up = "../" * depth
    link = lambda rel: up + rel  # noqa: E731
    L = [f"# {s.get('title') or '(chưa đặt tên)'}", ""]
    meta = [("Mã truyện", f"`{s['id']}`"), ("Nhóm", GROUP_TITLE[story_group(s)]), ("Nguồn", s.get("source")),
            ("Tạo lúc", s.get("created_at")), ("Cập nhật", s.get("updated_at")), ("Số trang", len(s.get("pages") or [])),
            ("Ngôn ngữ", s.get("locale")), ("Tuổi", f"{s.get('target_age_min')}–{s.get('target_age_max')}"),
            ("Giọng kể", s.get("narrator_voice_name") or s.get("last_voice_name")), ("Trạng thái", s.get("status")),
            ("Đã xoá", s.get("deleted_at") or "không")]
    L += ["| | |", "| --- | --- |"] + [f"| {k} | {v if v not in (None, '') else '—'} |" for k, v in meta] + [""]
    cover = media_rel(s.get("cover_image_url"), objects) or (f"media/illustrations/{s['thumbnail_path']}"
                                                            if s.get("thumbnail_path") and f"illustrations/{s['thumbnail_path']}" in objects else None)
    if cover:
        L += [f"![Bìa]({link(cover)})", ""]
    for k, label in (("description", "Giới thiệu"), ("moral_lesson", "Bài học")):
        if s.get(k):
            L += [f"**{label}:** {s[k]}", ""]
    chars = s.get("characters") or []
    if chars:
        L += ["## Nhân vật", ""] + [f"- {c.get('emoji') or ''} **{c.get('name')}** — {c.get('description') or c.get('role') or ''} "
                                    f"(giọng: {c.get('voice_name') or '—'})".replace("  ", " ") for c in chars] + [""]
    for p in s.get("pages") or []:
        L += [f"## Trang {p.get('page_number')}", ""]
        img = media_rel(p.get("illustration_url"), objects)
        if img:
            L += [f"![Trang {p.get('page_number')}]({link(img)})", ""]
        L += [readable_text(p.get("content") or ""), ""]
        audio = media_rel(p.get("audio_url"), objects)
        if audio:
            L += [f"🔊 [Nghe trang {p.get('page_number')}]({link(audio)})", ""]
    L += ["---", "", "Bản đầy đủ (mọi cột trong cơ sở dữ liệu): [story.json](story.json)", ""]
    return "\n".join(L)


def write_if_changed(path: Path, data: bytes) -> bool:
    if path.exists() and path.read_bytes() == data:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return True


def export_stories(objects: dict) -> list[dict]:
    stories = json.loads(psql(STORIES_SQL))
    keep: set[str] = set()
    for s in stories:
        d = story_dir(s)
        keep.add(d)
        write_if_changed(REPO / d / "story.json", (json.dumps(s, ensure_ascii=False, indent=1, sort_keys=True) + "\n").encode())
        write_if_changed(REPO / d / "README.md", story_markdown(s, objects, d.count("/") + 1).encode())
    root = REPO / "stories"
    if root.exists():
        for group in root.iterdir():
            if group.is_dir():
                for sd in group.iterdir():
                    if sd.is_dir() and f"stories/{group.name}/{sd.name}" not in keep:
                        shutil.rmtree(sd)
    # Index — family stories first: those are the ones that exist nowhere else.
    L = ["# Danh sách truyện", "", f"Cập nhật: {NOW.astimezone(VN):%Y-%m-%d %H:%M} (giờ Việt Nam) · {len(stories)} truyện", ""]
    for g in ("gia-dinh", "thu-vien", "mau"):
        rows = [s for s in stories if story_group(s) == g]
        if not rows:
            continue
        L += [f"## {GROUP_TITLE[g]} ({len(rows)})", "", "| Truyện | Tạo lúc | Trang | Tranh | Audio |", "| --- | --- | --- | --- | --- |"]
        for s in sorted(rows, key=lambda x: x.get("created_at") or "", reverse=True):
            pages = s.get("pages") or []
            imgs = sum(1 for p in pages if media_rel(p.get("illustration_url"), objects))
            auds = sum(1 for p in pages if media_rel(p.get("audio_url"), objects))
            d = story_dir(s).removeprefix("stories/")
            title = (s.get("title") or "(chưa đặt tên)").replace("|", "\\|") + (" *(đã xoá)*" if s.get("deleted_at") else "")
            L.append(f"| [{title}]({d}/README.md) | {(s.get('created_at') or '')[:10]} | {len(pages)} | {imgs} | {auds} |")
        L.append("")
    write_if_changed(root / "README.md", "\n".join(L).encode())
    return stories


# ------------------------------------------------------------------ media ---

def storage_tar(paths: list[str]):
    """Yield (relative key, bytes) for '<bucket>/<name>/<version>' paths in the storage volume."""
    for i in range(0, len(paths), 200):
        chunk = paths[i:i + 200]
        p = subprocess.Popen(["docker", "exec", "-i", STORAGE, "tar", "-C", STORAGE_ROOT, "-cf", "-", "-T", "-"],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert p.stdin and p.stdout
        p.stdin.write(("\n".join(chunk) + "\n").encode())
        p.stdin.close()
        with tarfile.open(fileobj=p.stdout, mode="r|") as tf:
            for m in tf:
                if m.isfile():
                    f = tf.extractfile(m)
                    yield m.name, f.read() if f else b""
        err = p.stderr.read().decode() if p.stderr else ""
        if p.wait() != 0:
            raise RuntimeError(f"storage tar failed: {err[:400]}")


def sync_media(objs: list[dict]) -> dict:
    manifest_path = REPO / "media" / "manifest.json"
    old = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    want = {f"{o['bucket']}/{o['name']}": o for o in objs if o["bucket"] in PLAIN_BUCKETS}
    todo = [k for k, o in want.items()
            if k not in old or old[k].get("version") != o["version"] or not (REPO / "media" / k).exists()]
    by_path = {f"{k}/{want[k]['version']}": k for k in todo}
    new = {k: v for k, v in old.items() if k in want and k not in todo}
    for path, data in storage_tar(list(by_path)):
        key = by_path.get(path.lstrip("./"))
        if not key:
            continue
        dest = REPO / "media" / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        o = want[key]
        new[key] = {"version": o["version"], "size": len(data), "sha256": sha256(data), "mimetype": o["mimetype"]}
    missing = sorted(set(want) - set(new))
    if missing:
        raise RuntimeError(f"{len(missing)} media objects could not be copied, e.g. {missing[:3]}")
    # Mirror: drop files whose object is gone (git history keeps them).
    media_root = REPO / "media"
    for bucket in PLAIN_BUCKETS:
        broot = media_root / bucket
        if broot.exists():
            for f in sorted(broot.rglob("*"), reverse=True):
                rel = f.relative_to(media_root).as_posix()
                if f.is_file() and rel not in new:
                    f.unlink()
                elif f.is_dir() and not any(f.iterdir()):
                    f.rmdir()
    write_if_changed(manifest_path, (json.dumps(dict(sorted(new.items())), indent=1) + "\n").encode())
    return {"files": len(new), "copied": len(todo), "bytes": sum(v["size"] for v in new.values())}


def deterministic_tar(entries: list[tuple[str, bytes, int]]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.PAX_FORMAT) as tf:
        for name, data, mode in sorted(entries):
            ti = tarfile.TarInfo(name)
            ti.size, ti.mode, ti.mtime, ti.uid, ti.gid, ti.uname, ti.gname = len(data), mode, 0, 0, 0, "", ""
            tf.addfile(ti, io.BytesIO(data))
    return buf.getvalue()


def encrypted_bundle(name: str, entries: list[tuple[str, bytes, int]], state: dict) -> dict:
    """Encrypt a deterministic tar into encrypted/<name>.tar.gpg, only when its content changed."""
    plain = deterministic_tar(entries)
    digest = sha256(plain)
    out = REPO / "encrypted" / f"{name}.tar.gpg"
    prev = state.get(name, {})
    if prev.get("plain_sha256") != digest or not out.exists():
        TMP.mkdir(mode=0o700, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=TMP, delete=True) as t:
            t.write(plain)
            t.flush()
            encrypt(Path(t.name), out)
        prev = {"plain_sha256": digest, "files": len(entries), "plain_bytes": len(plain), "updated": STAMP}
    return prev


def private_buckets(buckets: list[str], objs: list[dict]) -> list[str]:
    """Buckets that go into encrypted bundles: everything that is not plain story media (recordings always)."""
    return sorted(({*buckets, *(o["bucket"] for o in objs), "recordings"}) - set(PLAIN_BUCKETS))


def secret_entries(objs: list[dict], bucket: str) -> list[tuple[str, bytes, int]]:
    """Tar entries '<bucket>/<object name>' (newest version) for one private bucket."""
    paths = [f"{o['bucket']}/{o['name']}/{o['version']}" for o in objs if o["bucket"] == bucket]
    out = []
    for path, data in storage_tar(paths):
        out.append((path.rsplit("/", 1)[0], data, 0o600))
    if len(out) != len(paths):
        raise RuntimeError(f"{bucket}: copied {len(out)} of {len(paths)}")
    return out


def db_root_key() -> bytes:
    """The pgsodium/Vault root key the running DB container uses (64 hex chars)."""
    key = run(["docker", "exec", DB, "cat", ROOT_KEY_FILE]).stdout.strip()
    if not re.fullmatch(rb"[0-9a-f]{64}", key):
        raise RuntimeError(f"unexpected root key format in {DB}:{ROOT_KEY_FILE}")
    return key


def config_entries(root_key: bytes) -> list[tuple[str, bytes, int]]:
    """Server config files + the root key in use (overrides a pinned copy in /srv/kecon/shared)."""
    import glob
    out = [(ROOT_KEY_ENTRY, root_key + b"\n", 0o600)]
    for pattern in CONFIG_GLOBS:
        for f in sorted(glob.glob(pattern)):
            p = Path(f)
            if p.is_file() and p.as_posix().lstrip("/") != ROOT_KEY_ENTRY:
                out.append((p.as_posix().lstrip("/"), p.read_bytes(), 0o600))
    return out


def root_key_pinned(root_key: bytes) -> bool:
    """True when /srv/kecon/shared/pgsodium_root.key holds the key in use (stack recreation keeps Vault readable)."""
    p = Path("/") / ROOT_KEY_ENTRY
    try:
        return p.read_bytes().strip() == root_key
    except OSError:
        return False


# --------------------------------------------------------------- database ---

def db_snapshot() -> dict:
    SNAPS.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(mode=0o700, exist_ok=True)
    plain = TMP / f"db-{STAMP}.dump"
    try:
        with open(plain, "wb") as fh:
            subprocess.run(["docker", "exec", DB, "pg_dump", "-U", "postgres", "-Fc", "postgres"], stdout=fh, check=True)
        with open(plain, "rb") as fh:
            toc = subprocess.run(["docker", "exec", "-i", DB, "pg_restore", "-l"], stdin=fh, capture_output=True, check=True).stdout.decode()
        table_data = sum(1 for line in toc.splitlines() if " TABLE DATA " in line)
        if table_data < 50:
            raise RuntimeError(f"dump looks wrong: only {table_data} TABLE DATA entries")
        data = plain.read_bytes()
        enc = SNAPS / f"db-{STAMP}.dump.gpg"
        encrypt(plain, enc)
        meta = {"file": enc.name, "taken": STAMP, "plain_sha256": sha256(data), "plain_bytes": len(data),
                "encrypted_sha256": sha256(enc.read_bytes()), "table_data_entries": table_data}
        enc.with_name(enc.name + ".json").write_text(json.dumps(meta, indent=1) + "\n")
        return meta
    finally:
        plain.unlink(missing_ok=True)


def retained(names: list[str]) -> set[str]:
    stamps = sorted({n[3:19] for n in names}, reverse=True)  # db-YYYYMMDDTHHMMSSZ
    when = {s: dt.datetime.strptime(s, "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc).astimezone(VN) for s in stamps}
    keep, days, weeks, months = set(), [], [], []
    for s in stamps:  # newest first: first seen per bucket = latest of that day/week/month
        d = when[s]
        day, week, month = d.date(), d.isocalendar()[:2], (d.year, d.month)
        if day not in days and len(days) < KEEP_DAILY:
            days.append(day); keep.add(s)
        if week not in weeks and len(weeks) < KEEP_WEEKLY:
            weeks.append(week); keep.add(s)
        if month not in months and len(months) < KEEP_MONTHLY:
            months.append(month); keep.add(s)
    return {n for n in names if n[3:19] in keep}


def prune_snapshots() -> list[dict]:
    dumps = sorted(p.name for p in SNAPS.glob("db-*.dump.gpg"))
    keep = retained(dumps)
    for n in dumps:
        if n not in keep:
            (SNAPS / n).unlink(missing_ok=True)
            (SNAPS / (n + ".json")).unlink(missing_ok=True)
    return [json.loads((SNAPS / (n + ".json")).read_text()) for n in sorted(keep, reverse=True) if (SNAPS / (n + ".json")).exists()]


VERIFY_DB = "kecon_restore_check"
COUNT_SQL = r"""
select json_object_agg(t, n order by t) from (
  select 'auth.users' t, count(*) n from auth.users union all
  select 'public.profiles', count(*) from public.profiles union all
  select 'public.households', count(*) from public.households union all
  select 'public.stories', count(*) from public.stories union all
  select 'public.story_pages', count(*) from public.story_pages union all
  select 'public.play_sessions', count(*) from public.play_sessions union all
  select 'storage.objects', count(*) from storage.objects union all
  select 'vault.secrets', count(*) from vault.secrets) x;
"""
# Decrypted Vault: count, how many decrypt, and a digest of name:md5(secret) (compared in memory, never written out).
VAULT_SQL = r"""
select json_build_object('secrets', count(*), 'decrypted', count(decrypted_secret),
  'digest', md5(coalesce(string_agg(coalesce(name, id::text) || ':' || md5(coalesce(decrypted_secret, '')), ','
                                    order by coalesce(name, id::text)), '')))
from vault.decrypted_secrets;
"""
TABLES_SQL = "select count(*) from pg_tables where schemaname in ('public','auth','storage');"


def vault_state(db: str = "postgres") -> dict:
    try:
        return json.loads(psql(VAULT_SQL, db, SUPERUSER))
    except subprocess.CalledProcessError as e:  # e.g. wrong root key → decrypt error
        return {"error": (e.stderr or b"").decode().strip().splitlines()[-1:] or ["psql failed"]}


def restore_verdict(rows: dict, live: dict, tables: int, errors: list[str], vault: dict, live_vault: dict) -> dict:
    """Restore check result. ok only if rows match, the Vault decrypts to the same secrets and pg_restore had no error."""
    vault_ok = ("error" not in vault and "error" not in live_vault and vault.get("secrets") == live_vault.get("secrets")
                and vault.get("decrypted") == vault.get("secrets") and vault.get("digest") == live_vault.get("digest"))
    return {"ok": rows == live and tables >= 50 and not errors and vault_ok, "tables": tables, "rows": rows,
            "live_rows_at_dump": live, "pg_restore_errors": len(errors), "first_errors": errors[:3],
            "vault": {"secrets": vault.get("secrets"), "decrypted": vault.get("decrypted"), "match": vault_ok,
                      **({"error": vault.get("error") or live_vault.get("error")} if not vault_ok else {})}}


def verify_restore(meta: dict, live: dict, live_vault: dict) -> dict:
    """Decrypt a snapshot, restore it like a migration would (supabase_admin, owners + privileges, empty template0
    database) and compare row counts + the decrypted Vault with the live values taken right before the dump."""
    plain = TMP / "verify-restore.dump"
    TMP.mkdir(mode=0o700, exist_ok=True)
    try:
        decrypt_to(SNAPS / meta["file"], plain)
        if sha256(plain.read_bytes()) != meta["plain_sha256"]:
            return {"ok": False, "error": "decrypted dump does not match its sha256"}
        psql(f"drop database if exists {VERIFY_DB} with (force);", user=SUPERUSER)
        psql(f"create database {VERIFY_DB} template template0;", user=SUPERUSER)
        with open(plain, "rb") as fh:
            r = subprocess.run(["docker", "exec", "-i", DB, "pg_restore", "-U", SUPERUSER, "-d", VERIFY_DB],
                               stdin=fh, capture_output=True)
        errors = [ln for ln in r.stderr.decode().splitlines() if "error:" in ln]
        if r.returncode != 0 and not errors:
            errors = [f"pg_restore exit {r.returncode}"]
        restored = json.loads(psql(COUNT_SQL, VERIFY_DB, SUPERUSER))
        tables = int(psql(TABLES_SQL, VERIFY_DB, SUPERUSER))
        return restore_verdict(restored, live, tables, errors, vault_state(VERIFY_DB), live_vault)
    finally:
        plain.unlink(missing_ok=True)
        psql(f"drop database if exists {VERIFY_DB} with (force);", user=SUPERUSER)


# -------------------------------------------------------------------- git ---

def ensure_repo(path: Path, branch: str) -> None:
    if not (path / ".git").exists():
        path.mkdir(parents=True, exist_ok=True)
        run(["git", "init", "-q", "-b", branch, str(path)])
        git(path, "remote", "add", "origin", REMOTE)
        git(path, "config", "core.quotepath", "false")
    git(path, "remote", "set-url", "origin", REMOTE)  # token ↔ deploy key can be switched any time
    (path / ".gitattributes").write_text("*.gpg binary\n*.webp binary\n*.png binary\n*.jpg binary\n*.mp3 binary\n*.wav binary\n*.webm binary\n")


def push(path: Path, branch: str, force: bool = False) -> tuple[bool, str]:
    args = ["push", "-q", "origin", f"{branch}:{branch}"] + (["--force"] if force else [])
    r = run(["git", "-C", str(path), *args], env=GIT_ENV, check=False)
    if r.returncode != 0:
        return False, (r.stderr.decode() or r.stdout.decode()).strip()[:500]
    remote = run(["git", "-C", str(path), "ls-remote", "origin", f"refs/heads/{branch}"], env=GIT_ENV, check=False).stdout.decode().split()
    local = git(path, "rev-parse", branch)
    return (bool(remote) and remote[0] == local), local


def publish_snapshots(snaps: list[dict], do_push: bool) -> dict:
    ensure_repo(SNAP_REPO, "db-snapshots")
    names = {s["file"] for s in snaps}
    for f in SNAP_REPO.iterdir():
        if f.name.startswith("db-") and f.name.removesuffix(".json") not in names:
            f.unlink()
    for s in snaps:
        for n in (s["file"], s["file"] + ".json"):
            src, dst = SNAPS / n, SNAP_REPO / n
            if not dst.exists() or dst.stat().st_size != src.stat().st_size:
                shutil.copy2(src, dst)
    rows = "\n".join(f"| `{s['file']}` | {dt.datetime.strptime(s['taken'], '%Y%m%dT%H%M%SZ').replace(tzinfo=dt.timezone.utc).astimezone(VN):%Y-%m-%d %H:%M} "
                     f"| {s['plain_bytes'] / 1e6:.2f} MB | {s['table_data_entries']} |" for s in snaps)
    (SNAP_REPO / "README.md").write_text(
        "# Bản chụp cơ sở dữ liệu KểCon (mã hoá)\n\nNhánh này chỉ giữ một commit, ghi đè mỗi ngày: "
        f"{KEEP_DAILY} bản theo ngày, {KEEP_WEEKLY} theo tuần, {KEEP_MONTHLY} theo tháng. Cách giải mã và khôi phục: "
        "README.md ở nhánh `main`.\n\n| File | Chụp lúc (giờ VN) | Dung lượng gốc | Bảng có dữ liệu |\n| --- | --- | --- | --- |\n" + rows + "\n")
    git(SNAP_REPO, "read-tree", "--empty")
    git(SNAP_REPO, "add", "-A")
    tree = git(SNAP_REPO, "write-tree")
    head = git(SNAP_REPO, "rev-parse", "-q", "--verify", "refs/heads/db-snapshots", check=False)
    head_tree = git(SNAP_REPO, "rev-parse", f"{head}^{{tree}}", check=False) if head else ""
    if tree != head_tree:
        commit = run(["git", "-C", str(SNAP_REPO), "commit-tree", tree, "-m", f"db snapshots {STAMP}"], env=GIT_ENV).stdout.decode().strip()
        git(SNAP_REPO, "update-ref", "refs/heads/db-snapshots", commit)
    ok, info = push(SNAP_REPO, "db-snapshots", force=True) if do_push else (False, "skipped (--no-push)")
    return {"count": len(snaps), "pushed": ok, "info": info}


README = """# KểCon — bản sao lưu (repo riêng tư)

> ⚠️ Repo này phải luôn để **Private**. Trong đó có truyện, tranh và giọng đọc của các gia đình.

Máy chủ staging tự sao lưu lên đây mỗi ngày lúc 03:15 (giờ Việt Nam) bằng `tools/kecon_backup.py`
(bản gốc: `deploy/prized/backup/` trong repo app; systemd `kecon-backup.timer`). Lần chạy gần nhất: **{when}**.
Mỗi lần chạy đều giải mã bản chụp DB mới nhất và **khôi phục thử như khi chuyển máy** (user `supabase_admin`, giữ
owner + quyền, vào database trống), so số dòng và giải mã lại Vault (key nhà cung cấp AI) với DB thật; chỉ cần một
lỗi `pg_restore` là báo hỏng (`manifest.json` → `restore_check`).

| Phần | Ở đâu | Dạng |
| --- | --- | --- |
| Truyện ({stories} truyện, {family} truyện gia đình) | [`stories/`](stories/README.md) | đọc được: `README.md` + `story.json` (mọi cột) |
| Tranh + audio của truyện ({media_files} file, {media_mb} MB) | `media/<bucket>/<đường dẫn trong Storage>` | file gốc, `media/manifest.json` ghi version + sha256 |
| Bucket riêng tư (ghi âm bố mẹ, ảnh đại diện gia đình…) | {private} | **mã hoá** AES-256 |
| Cấu hình máy chủ (`/srv/kecon/shared`: .env, secrets, **khoá gốc Vault**; systemd; `config.toml`) | `encrypted/server-config.tar.gpg` | **mã hoá** AES-256 |
| Toàn bộ cơ sở dữ liệu (tài khoản, hộ, nhiệm vụ, Vault, …) | nhánh [`db-snapshots`](../../tree/db-snapshots) | **mã hoá** AES-256, 7 ngày + 4 tuần + 6 tháng |
| Công cụ | `tools/kecon_backup.py`, `tools/kecon_restore.py` | Python 3, chỉ cần Docker |

## Giải mã

Cần **mật khẩu sao lưu** (bố mẹ/chủ dự án giữ; trên máy chủ ở `/srv/kecon/backup-github/passphrase`).
Không có mật khẩu thì phần mã hoá **không thể** khôi phục — phần truyện/tranh/audio vẫn đọc được bình thường.

```bash
gpg --decrypt encrypted/server-config.tar.gpg > server-config.tar   # hỏi mật khẩu
gpg --decrypt encrypted/recordings.tar.gpg > recordings.tar           # mỗi bucket riêng tư một file
gpg --decrypt db-YYYYMMDDTHHMMSSZ.dump.gpg > kecon.dump               # file ở nhánh db-snapshots
```

## Chuyển sang máy mới (khôi phục toàn bộ)

Dump là `pg_dump -Fc` của database `postgres` trong Supabase (cả schema `auth`, `storage`, `vault`, `public`).
Khôi phục vào stack Supabase CLI **cùng phiên bản** (Postgres {pg}; image DB `{db_image}`, Storage
`{storage_image}` — `manifest.json` → `images`). Hai điều dễ sai: (1) phải khôi phục bằng **`supabase_admin`** —
bằng `postgres` thì Vault bị từ chối (`permission denied for table secrets`) và mất key AI; (2) stack mới phải dùng
**cùng khoá gốc Vault** (`srv/kecon/shared/pgsodium_root.key` trong server-config) — khoá khác thì Vault còn dòng
nhưng không giải mã được. File Storage phải nằm đúng `<bucket>/<tên>/<version>` và có content-type, nếu không
Storage trả `application/octet-stream`; `tools/kecon_restore.py` lo cả hai việc.

```bash
# 0. Lấy bản sao lưu + giải mã (mục trên): server-config.tar, <bucket>.tar, kecon.dump (bản mới nhất ở db-snapshots)
umask 077   # file giải mã chỉ user hiện tại đọc được
git clone https://github.com/khankingko845-netizen/kecon-backup.git && cd kecon-backup
git fetch origin db-snapshots && git show origin/db-snapshots:db-YYYYMMDDTHHMMSSZ.dump.gpg | gpg --decrypt > kecon.dump
# 1. Máy mới: sudo bash deploy/prized/setup-server.sh (repo app), đăng nhập lại
# 2. TRƯỚC bootstrap — cấu hình cũ: cùng jwt secret + khoá API (phiên đăng nhập giữ nguyên), key AI, khoá gốc Vault
mkdir -p /tmp/kc-config && tar -xf server-config.tar -C /tmp/kc-config
install -d -m 700 /srv/kecon/shared && install -m 600 /tmp/kc-config/srv/kecon/shared/* /srv/kecon/shared/
rm -f /srv/kecon/shared/public-url /srv/kecon/shared/release   # URL tunnel + release của máy mới tự sinh
# 3. bootstrap.sh như máy mới (deploy/prized/README.md) → stack Supabase tạo với khoá gốc cũ
# 4. Dừng app, thay DB, chép file Storage
sudo systemctl stop kecon-web kecon-backup.timer kecon-parent-notify.timer
python3 tools/kecon_restore.py db kecon.dump --yes --root-key /srv/kecon/shared/pgsodium_root.key
python3 tools/kecon_restore.py media . --private recordings.tar   # thêm --private <bucket>.tar cho mỗi bucket riêng tư
# 5. Migration mới hơn bản sao lưu (nếu có), bật lại app + timer
bash /srv/kecon/current/deploy/prized/deploy.sh /tmp/kecon-<sha>.tar.gz <sha>
```

`kecon_restore.py db` dừng các container khác của stack, `DROP DATABASE postgres WITH (FORCE)`, `pg_restore --create`
bằng `supabase_admin`, bật lại container rồi in số dòng + số secret Vault giải mã được (exit 4 nếu có lỗi). Nó từ
chối nếu DB đang có tài khoản (chống chạy nhầm trên máy đang dùng) trừ khi thêm `--replace-existing`, và dừng ngay
nếu `--root-key` khác khoá stack đang dùng. Xong thì đăng nhập bằng một tài khoản cũ và nghe thử một truyện.
Unit systemd + `config.toml` trong server-config chỉ để đối chiếu — `install-units.sh`/`supabase-stack.sh` tự tạo lại.
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-push", action="store_true")
    ap.add_argument("--verify-restore", action="store_true")
    a = ap.parse_args()
    BASE.mkdir(parents=True, exist_ok=True)
    lock = open(BASE / ".lock", "w")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if not PASSPHRASE.exists() or PASSPHRASE.stat().st_mode & 0o077:
        raise SystemExit("passphrase missing or readable by others")
    ensure_repo(REPO, "main")
    state_path = REPO / "encrypted" / "state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}

    objs = json.loads(psql(OBJECTS_SQL))
    objects = {f"{o['bucket']}/{o['name']}": o for o in objs if o["bucket"] in PLAIN_BUCKETS}
    log(f"storage objects: {len(objs)}")
    media = sync_media(objs)
    log(f"media: {media}")
    stories = export_stories(objects)
    family = sum(1 for s in stories if story_group(s) == "gia-dinh")
    log(f"stories: {len(stories)} ({family} family)")
    private = {}
    for bucket in private_buckets(json.loads(psql(BUCKETS_SQL)), objs):
        state[bucket] = encrypted_bundle(bucket, secret_entries(objs, bucket), state)
        private[bucket] = state[bucket]["files"]
    log(f"private buckets (encrypted): {private}")
    root_key = db_root_key()
    state["server-config"] = encrypted_bundle("server-config", config_entries(root_key), state)
    write_if_changed(state_path, (json.dumps(state, indent=1, sort_keys=True) + "\n").encode())
    live = json.loads(psql(COUNT_SQL, user=SUPERUSER))  # counted right before the dump (staging is quiet at 03:15)
    live_vault = vault_state()
    snap = db_snapshot()
    log(f"db snapshot: {snap['file']} {snap['plain_bytes']} bytes, {snap['table_data_entries']} tables with data")
    restore = verify_restore(snap, live, live_vault) if a.verify_restore else None
    if restore is not None:
        log(f"restore check: {json.dumps(restore, ensure_ascii=False)}")
    snaps = prune_snapshots()

    pg = psql("show server_version;").strip()
    images = {c: run(["docker", "inspect", "-f", "{{.Config.Image}}", c], check=False).stdout.decode().strip() or None
              for c in (DB, STORAGE)}
    tools = REPO / "tools"
    tools.mkdir(exist_ok=True)
    write_if_changed(tools / "kecon_backup.py", Path(__file__).read_bytes())
    restore_tool = Path(__file__).with_name("kecon_restore.py")
    if restore_tool.exists():
        write_if_changed(tools / "kecon_restore.py", restore_tool.read_bytes())
    summary = {"last_run": STAMP, "stories": len(stories), "family_stories": family, "media": media,
               "recordings": state["recordings"]["files"], "private_buckets": private,
               "db_snapshots": [s["file"] for s in snaps], "postgres": pg, "images": images,
               "db_root_key": {"in_server_config": ROOT_KEY_ENTRY, "pinned_on_server": root_key_pinned(root_key)},
               "restore_check": None if restore is None else {k: restore.get(k) for k in ("ok", "tables", "rows", "pg_restore_errors", "vault")}}
    (REPO / "README.md").write_text(README.format(when=f"{NOW.astimezone(VN):%Y-%m-%d %H:%M}", stories=len(stories), family=family,
                                                  media_files=media["files"], media_mb=f"{media['bytes'] / 1e6:.0f}",
                                                  private=", ".join(f"`encrypted/{b}.tar.gpg` ({n} file)" for b, n in private.items()),
                                                  pg=pg, db_image=images[DB] or "?", storage_image=images[STORAGE] or "?"))
    write_if_changed(REPO / "manifest.json", (json.dumps(summary, indent=1, ensure_ascii=False) + "\n").encode())
    git(REPO, "add", "-A")
    if run(["git", "-C", str(REPO), "diff", "--cached", "--quiet"], check=False).returncode != 0:
        git(REPO, "commit", "-q", "-m", f"Sao lưu {NOW.astimezone(VN):%Y-%m-%d %H:%M}: {len(stories)} truyện, {media['files']} file media")
    main_push = push(REPO, "main") if not a.no_push else (False, "skipped (--no-push)")
    snap_push = publish_snapshots(snaps, not a.no_push)
    result = {**summary, "main_pushed": main_push[0], "main_info": main_push[1], "snapshots": snap_push}
    (BASE / "last-run.json").write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n")
    log(json.dumps(result, ensure_ascii=False))
    if restore is not None and not restore["ok"]:
        return 4
    if a.no_push:
        return 0
    return 0 if main_push[0] and snap_push["pushed"] else 3


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BlockingIOError:
        log("another backup is running")
        sys.exit(1)
