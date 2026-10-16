import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Staging trên prized.dev: máy mới có thể mang tên user khác (doppel → longca), máy cũ mất
// dữ liệu vì chưa có bản sao lưu ngoài máy. Các test này giữ deploy/prized chạy được với
// bất kỳ user nào và giữ job sao lưu GitHub hằng ngày.
const DIR = "deploy/prized";
const UNIT_DIRS = [`${DIR}/systemd`, DIR, `${DIR}/backup`];
const units = UNIT_DIRS.flatMap((d) =>
  readdirSync(d)
    .filter((n) => /\.(service|timer)$/.test(n))
    .map((n) => join(d, n))
);
const read = (p: string) => readFileSync(p, "utf8");

describe("deploy/prized · không hardcode user của máy", () => {
  it("mọi unit chạy bằng @KECON_USER@ / @KECON_HOME@", () => {
    expect(units.length).toBeGreaterThanOrEqual(12);
    const offenders = units.flatMap((u) =>
      read(u)
        .split("\n")
        .filter((l) => (/^User=/.test(l) && l !== "User=@KECON_USER@") || /\/home\/[a-z]/.test(l) || /doppel|longca/.test(l))
        .map((l) => `${u}: ${l}`)
    );
    expect(offenders).toEqual([]);
  });

  it("setup-server.sh dùng user đã gọi sudo (hoặc KECON_USER), không tên cố định", () => {
    const s = read(`${DIR}/setup-server.sh`);
    expect(s).toContain('APP_USER=${KECON_USER:-${SUDO_USER:-}}');
    expect(s).toMatch(/usermod -aG docker "\$APP_USER"/);
    expect(s).toMatch(/chown -R "\$APP_USER:\$APP_USER" \/srv\/kecon/);
    expect(s).not.toMatch(/usermod -aG docker [a-z]|chown -R [a-z]+:/);
  });

  it("bootstrap.sh và deploy.sh cài unit qua install-units.sh, không chép thẳng vào /etc/systemd/system", () => {
    for (const f of ["bootstrap.sh", "deploy.sh"]) {
      const s = read(`${DIR}/${f}`);
      expect(s, f).toContain("install-units.sh");
      expect(s, f).not.toMatch(/(cp|install)\b[^\n]*\/etc\/systemd\/system/);
    }
  });

  it("install-units.sh cài đủ mọi unit và thay placeholder bằng user/home thật", () => {
    const tmp = mkdtempSync(join(tmpdir(), "kecon-units-"));
    const rel = join(tmp, "release");
    const unitDir = join(tmp, "etc-systemd");
    const bin = join(tmp, "bin");
    cpSync(DIR, join(rel, DIR), { recursive: true });
    execFileSync("mkdir", ["-p", unitDir, bin]);
    // sudo giả: systemctl chỉ ghi log; install vào /etc/systemd/system → thư mục tạm.
    writeFileSync(
      join(bin, "sudo"),
      '#!/bin/bash\nif [[ $1 == systemctl ]]; then echo "$*" >> "$UNIT_DIR/.log"; exit 0; fi\n' +
        'set -- "${@/#\\/etc\\/systemd\\/system/$UNIT_DIR}"\nexec "$@"\n'
    );
    chmodSync(join(bin, "sudo"), 0o755);
    const user = userInfo().username;
    const home = execFileSync("getent", ["passwd", user], { encoding: "utf8" }).split(":")[5];
    const out = execFileSync("bash", [`${DIR}/install-units.sh`, rel], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, KECON_USER: user, UNIT_DIR: unitDir },
    });
    expect(out).toContain(`UNITS_OK ${units.length} units, User=${user}`);
    const installed = readdirSync(unitDir).filter((n) => /\.(service|timer)$/.test(n)).sort();
    expect(installed).toEqual(units.map((u) => u.split("/").pop()).sort());
    for (const name of installed) {
      const body = read(join(unitDir, name));
      expect(body, name).not.toContain("@KECON_");
      if (/^User=/m.test(body)) expect(body, name).toContain(`User=${user}\n`);
    }
    expect(read(join(unitDir, "kecon-supabase.service"))).toContain(`Environment=HOME=${home}\n`);
    expect(read(join(unitDir, ".log"))).toContain("systemctl daemon-reload");
  });
});

describe("deploy/prized/backup · sao lưu GitHub hằng ngày", () => {
  const TOOL = `${DIR}/backup/kecon_backup.py`;

  it("timer 03:15 giờ Việt Nam, chạy bù khi máy thức; service khôi phục thử mỗi lần", () => {
    const timer = read(`${DIR}/backup/kecon-backup.timer`);
    expect(timer).toContain("OnCalendar=*-*-* 03:15:00 Asia/Ho_Chi_Minh");
    expect(timer).toContain("Persistent=true");
    const svc = read(`${DIR}/backup/kecon-backup.service`);
    expect(svc).toContain(`ExecStart=/usr/bin/python3 /srv/kecon/current/${TOOL} --verify-restore`);
    expect(svc).toContain("User=@KECON_USER@");
  });

  it("deploy.sh chỉ bật timer khi đã có mật khẩu + quyền đẩy", () => {
    const s = read(`${DIR}/deploy.sh`);
    expect(s).toMatch(/if \[\[ -f \$BK\/passphrase && \( -f \$BK\/github-token \|\| -f \$BK\/deploy_key \) \]\]; then\n\s+sudo systemctl enable --now kecon-backup\.timer/);
  });

  // Chạy chính module Python (import không có tác dụng phụ; main() không chạy).
  const py = (code: string, base: string) =>
    execFileSync("python3", ["-c", `import importlib.util as u, sys\ns = u.spec_from_file_location("kb", ${JSON.stringify(TOOL)})\nkb = u.module_from_spec(s); s.loader.exec_module(kb)\n${code}`], {
      encoding: "utf8",
      env: { ...process.env, KECON_BACKUP_BASE: base, KECON_BACKUP_REMOTE: "", PYTHONDONTWRITEBYTECODE: "1" },
    });

  it("có github-token: đẩy qua HTTPS, git lấy token từ file (không nằm trong lệnh/.git/config)", () => {
    const base = mkdtempSync(join(tmpdir(), "kecon-bk-"));
    writeFileSync(join(base, "github-token"), "github_pat_TEST123", { mode: 0o600 });
    const out = py(
      `import subprocess, os\nprint(kb.REMOTE)\nr = subprocess.run(["git", "credential", "fill"], input=b"protocol=https\\nhost=github.com\\n\\n", env={**os.environ, **kb.GIT_ENV}, capture_output=True, check=True)\nprint(r.stdout.decode())\nprint("TOKEN_IN_ENV" if any("github_pat_TEST123" in v for v in kb.GIT_ENV.values()) else "TOKEN_NOT_IN_ENV")`,
      base
    );
    expect(out).toContain("https://github.com/khankingko845-netizen/kecon-backup.git");
    expect(out).toContain("username=x-access-token");
    expect(out).toContain("password=github_pat_TEST123");
    expect(out).toContain("TOKEN_NOT_IN_ENV");
  });

  it("không có token: dùng SSH deploy key như trước", () => {
    const base = mkdtempSync(join(tmpdir(), "kecon-bk-"));
    expect(py("print(kb.REMOTE)", base).trim()).toBe("git@github.com:khankingko845-netizen/kecon-backup.git");
  });

  it("giữ 7 bản ngày + 4 tuần + 6 tháng, luôn có bản mới nhất", () => {
    const base = mkdtempSync(join(tmpdir(), "kecon-bk-"));
    const out = py(
      `import datetime as dt\nt0 = dt.datetime(2026, 10, 15, 20, 15, tzinfo=dt.timezone.utc)\nnames = [f"db-{(t0 - dt.timedelta(days=i)):%Y%m%dT%H%M%SZ}.dump.gpg" for i in range(400)]\nk = kb.retained(names)\nprint(len(k), names[0] in k, all(n in k for n in names[:7]))`,
      base
    );
    const [count, newest, week] = out.trim().split(" ");
    expect(Number(count)).toBeLessThanOrEqual(17);
    expect(Number(count)).toBeGreaterThanOrEqual(13);
    expect([newest, week]).toEqual(["True", "True"]);
  });
});

// Chuyển máy: Vault (key AI) chỉ khôi phục được bằng supabase_admin + cùng khoá gốc pgsodium; file Storage
// phải về đúng <bucket>/<tên>/<version> kèm content-type. Các test dưới giữ đúng những điều đó.
describe("deploy/prized/backup · khôi phục được khi chuyển máy (Vault, khoá gốc, Storage)", () => {
  const BACKUP = `${DIR}/backup/kecon_backup.py`;
  const RESTORE = `${DIR}/backup/kecon_restore.py`;
  const KEY = "ab".repeat(32);
  const OTHER = "cd".repeat(32);
  const load = (file: string, name: string) =>
    `import importlib.util as u, sys, json\ns = u.spec_from_file_location("${name}", ${JSON.stringify(file)})\n${name} = u.module_from_spec(s); s.loader.exec_module(${name})\n`;
  // docker giả: ghi lại lệnh (+ dòng đầu stdin) vào $FAKE_LOG; trả lời vài lệnh hay dùng.
  const fakeDocker = (dir: string, users = "0", key = KEY) => {
    const bin = join(dir, "bin");
    execFileSync("mkdir", ["-p", bin]);
    writeFileSync(
      join(bin, "docker"),
      `#!/bin/bash\nIN=""; if [[ " $* " == *" -i "* ]]; then IN=$(cat); fi\necho "$* :: \${IN:0:60}" >> "$FAKE_LOG"\n` +
        `case "$*" in\n` +
        `  *"cat /etc/postgresql-custom/pgsodium_root.key"*) echo "${key}" ;;\n` +
        `  *"pg_restore -l"*) for i in $(seq 60); do echo "$i; 0 0 TABLE DATA public t$i postgres"; done ;;\n` +
        `  *psql*) if [[ $IN == *"count(*) from auth.users;"* ]]; then echo ${users}; fi ;;\n` +
        `  ps*) printf 'supabase_db_kecon-staging\\nsupabase_auth_kecon-staging\\nsupabase_rest_kecon-staging\\nother_db\\n' ;;\n` +
        `esac\n`,
      { mode: 0o755 }
    );
    return { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_LOG: join(dir, "docker.log"), PYTHONDONTWRITEBYTECODE: "1" };
  };
  const python = (code: string, env: NodeJS.ProcessEnv) => execFileSync("python3", ["-c", code], { encoding: "utf8", env });

  it("restore check: chỉ đạt khi số dòng khớp, không lỗi pg_restore và Vault giải mã ra đúng các secret", () => {
    const dir = mkdtempSync(join(tmpdir(), "kecon-rv-"));
    const out = python(
      load(BACKUP, "kb") +
        `rows = {"auth.users": 3, "vault.secrets": 3}\nv = {"secrets": 3, "decrypted": 3, "digest": "d1"}\n` +
        `cases = {"ok": kb.restore_verdict(rows, rows, 60, [], v, v),\n` +
        ` "pg_error": kb.restore_verdict(rows, rows, 60, ["pg_restore: error: permission denied for table secrets"], v, v),\n` +
        ` "rows": kb.restore_verdict({**rows, "auth.users": 2}, rows, 60, [], v, v),\n` +
        ` "not_decrypted": kb.restore_verdict(rows, rows, 60, [], {**v, "decrypted": 0}, v),\n` +
        ` "other_secrets": kb.restore_verdict(rows, rows, 60, [], {**v, "digest": "d2"}, v),\n` +
        ` "vault_error": kb.restore_verdict(rows, rows, 60, [], {"error": ["invalid ciphertext"]}, v)}\n` +
        `print(json.dumps({k: [c["ok"], c["vault"]["match"]] for k, c in cases.items()}))\n` +
        `print("DIGEST_LEAK" if "d1" in json.dumps(cases) else "NO_DIGEST")`,
      { ...process.env, KECON_BACKUP_BASE: dir, KECON_BACKUP_REMOTE: "", PYTHONDONTWRITEBYTECODE: "1" }
    );
    const [verdicts, leak] = out.trim().split("\n");
    expect(JSON.parse(verdicts)).toEqual({
      ok: [true, true],
      pg_error: [false, true],
      rows: [false, true],
      not_decrypted: [false, false],
      other_secrets: [false, false],
      vault_error: [false, false],
    });
    expect(leak).toBe("NO_DIGEST"); // digest của secret chỉ so trong bộ nhớ, không ghi ra manifest/log
  });

  it("verify_restore khôi phục như khi chuyển máy: supabase_admin, giữ owner + quyền, database trống template0", () => {
    const s = read(BACKUP);
    const fn = s.slice(s.indexOf("def verify_restore"), s.indexOf("# -------------------------------------------------------------------- git"));
    expect(fn).toContain('"pg_restore", "-U", SUPERUSER, "-d", VERIFY_DB]');
    expect(fn).toContain("template template0");
    expect(fn).not.toMatch(/--no-owner|--no-privileges|"-U", "postgres"/);
    expect(s).toContain('SUPERUSER = os.environ.get("KECON_DB_SUPERUSER", "supabase_admin")');
    expect(s).toMatch(/select 'vault\.secrets', count\(\*\) from vault\.secrets/);
  });

  it("mọi bucket không phải tranh/audio truyện đều vào bản mã hoá (ảnh đại diện, bucket mới)", () => {
    const dir = mkdtempSync(join(tmpdir(), "kecon-pb-"));
    const out = python(
      load(BACKUP, "kb") +
        `print(kb.private_buckets(["family-avatars", "illustrations", "tts-cache"], [{"bucket": "new-private"}, {"bucket": "tts-cache"}]))`,
      { ...process.env, KECON_BACKUP_BASE: dir, KECON_BACKUP_REMOTE: "", PYTHONDONTWRITEBYTECODE: "1" }
    );
    expect(out.trim()).toBe("['family-avatars', 'new-private', 'recordings']");
  });

  it("server-config mang khoá gốc Vault đang dùng (đè bản ghim cũ, không trùng mục)", () => {
    const dir = mkdtempSync(join(tmpdir(), "kecon-key-"));
    const shared = join(dir, "srv/kecon/shared");
    execFileSync("mkdir", ["-p", shared]);
    writeFileSync(join(shared, "app.env"), "A=1\n");
    writeFileSync(join(shared, "pgsodium_root.key"), `${OTHER}\n`);
    const env = fakeDocker(dir);
    const out = python(
      load(BACKUP, "kb") +
        `kb.CONFIG_GLOBS = [${JSON.stringify(shared)} + "/*"]\nkb.ROOT_KEY_ENTRY = ${JSON.stringify(join(shared, "pgsodium_root.key").replace(/^\//, ""))}\n` +
        `k = kb.db_root_key()\nents = kb.config_entries(k)\nprint(json.dumps([[n.rsplit("/", 1)[-1], d.decode().strip(), oct(m)] for n, d, m in ents]))\nprint(kb.root_key_pinned(k))`,
      { ...env, KECON_BACKUP_BASE: dir, KECON_BACKUP_REMOTE: "" }
    );
    const [entries, pinned] = out.trim().split("\n");
    expect(JSON.parse(entries)).toEqual([
      ["pgsodium_root.key", KEY, "0o600"],
      ["app.env", "A=1", "0o600"],
    ]);
    expect(pinned).toBe("False"); // root_key_pinned đọc /srv/kecon/shared thật — ở đây không có
    expect(read(BACKUP)).toContain('ROOT_KEY_ENTRY = "srv/kecon/shared/pgsodium_root.key"');
  });

  it("pin-root-key.sh: ghim khoá đang dùng (chmod 600), cảnh báo khi lệch, không ghi gì nếu không đọc được", () => {
    const dir = mkdtempSync(join(tmpdir(), "kecon-pin-"));
    const keyFile = join(dir, "pgsodium_root.key");
    const run = (key: string) =>
      execFileSync("bash", ["-c", `bash ${DIR}/pin-root-key.sh 2>&1`], {
        encoding: "utf8",
        env: { ...fakeDocker(dir, "0", key), KECON_ROOT_KEY_FILE: keyFile },
      });
    expect(run("not-a-key")).toContain("không đọc được khoá gốc");
    expect(readdirSync(dir)).not.toContain("pgsodium_root.key");
    expect(run(KEY)).toContain("đã ghim khoá gốc Vault");
    expect(read(keyFile)).toBe(`${KEY}\n`);
    expect(execFileSync("stat", ["-c", "%a", keyFile], { encoding: "utf8" }).trim()).toBe("600");
    expect(run(KEY)).toBe("");
    expect(run(OTHER)).toContain("CẢNH BÁO");
    expect(read(keyFile)).toBe(`${KEY}\n`); // không tự đè khoá đã ghim
  });

  it("supabase-stack.sh đưa khoá đã ghim cho CLI trước khi start; start + deploy đều ghim", () => {
    const s = read(`${DIR}/supabase-stack.sh`);
    const exportAt = s.indexOf("export SUPABASE_DB_ROOT_KEY");
    const startAt = s.indexOf("supabase start --workdir");
    expect(exportAt).toBeGreaterThan(0);
    expect(exportAt).toBeLessThan(startAt);
    expect(s.indexOf("pin-root-key.sh", startAt)).toBeGreaterThan(startAt);
    expect(read(`${DIR}/deploy.sh`)).toContain('bash "$REL/deploy/prized/pin-root-key.sh"');
  });

  it("kecon_restore media: đúng <bucket>/<tên>/<version>, kiểm sha256/size, đặt content-type + cache-control", () => {
    const dir = mkdtempSync(join(tmpdir(), "kecon-rm-"));
    const co = join(dir, "checkout");
    execFileSync("mkdir", ["-p", join(co, "media/tts-cache/s1"), join(co, "media/illustrations/s1")]);
    writeFileSync(join(co, "media/tts-cache/s1/p1.mp3"), "mp3-bytes");
    writeFileSync(join(co, "media/illustrations/s1/bad.webp"), "changed");
    const sha = (t: string) => execFileSync("sha256sum", { input: t, encoding: "utf8" }).split(" ")[0];
    writeFileSync(
      join(co, "media/manifest.json"),
      JSON.stringify({ "tts-cache/s1/p1.mp3": { sha256: sha("mp3-bytes") }, "illustrations/s1/bad.webp": { sha256: sha("original") } })
    );
    const root = join(dir, "storage-root");
    const out = python(
      load(RESTORE, "kr") +
        `objs = [{"bucket": "tts-cache", "name": "s1/p1.mp3", "version": "v1", "size": 9, "mimetype": "audio/mpeg", "cacheControl": "max-age=3600"},\n` +
        ` {"bucket": "illustrations", "name": "s1/bad.webp", "version": "v2", "size": 7, "mimetype": "image/webp"},\n` +
        ` {"bucket": "illustrations", "name": "s1/gone.webp", "version": "v3", "size": 1, "mimetype": "image/webp"},\n` +
        ` {"bucket": "recordings", "name": "h1/r.webm", "version": "v4", "size": 3, "mimetype": "audio/webm"}]\n` +
        `todo, missing, bad = kr.plan_media(objs, __import__("pathlib").Path(${JSON.stringify(co)}), {"recordings/h1/r.webm": b"rec"})\n` +
        `print(json.dumps({"paths": [p for p, _, _ in todo], "missing": missing, "bad": bad}))\n` +
        `import subprocess, os\n` +
        `r = subprocess.run([sys.executable, "-c", kr.EXTRACT_PY, ${JSON.stringify(root)}], input=kr.build_tar(todo), capture_output=True, check=True)\n` +
        `print(r.stdout.decode().strip())\n` +
        `f = os.path.join(${JSON.stringify(root)}, "tts-cache/s1/p1.mp3/v1")\n` +
        `print(open(f, "rb").read().decode(), os.getxattr(f, "user.supabase.content-type").decode(), os.getxattr(f, "user.supabase.cache-control").decode())\n` +
        `import tarfile, io\nb = io.BytesIO()\nwith tarfile.open(fileobj=b, mode="w") as tf:\n    ti = tarfile.TarInfo("../escape"); ti.size = 1; tf.addfile(ti, io.BytesIO(b"x"))\n` +
        `r = subprocess.run([sys.executable, "-c", kr.EXTRACT_PY, ${JSON.stringify(root)}], input=b.getvalue(), capture_output=True)\n` +
        `print(r.returncode != 0, "unsafe member" in r.stderr.decode(), os.path.exists(os.path.join(${JSON.stringify(dir)}, "escape")))`,
      { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
    );
    const [plan, written, file, unsafe] = out.trim().split("\n");
    expect(JSON.parse(plan)).toEqual({
      paths: ["tts-cache/s1/p1.mp3/v1", "illustrations/s1/bad.webp/v2", "recordings/h1/r.webm/v4"],
      missing: ["illustrations/s1/gone.webp"],
      bad: ["illustrations/s1/bad.webp"],
    });
    expect(JSON.parse(written)).toEqual({ written: 3, bytes: 19 });
    expect(file).toBe("mp3-bytes audio/mpeg max-age=3600");
    expect(unsafe).toBe("True True False");
  });

  it("kecon_restore db: từ chối khi chưa --yes, khi DB đã có tài khoản, khi khoá gốc khác; thay DB bằng supabase_admin", () => {
    const dir = mkdtempSync(join(tmpdir(), "kecon-rd-"));
    const dump = join(dir, "kecon.dump");
    writeFileSync(dump, "PGDMP-fake");
    const keyFile = join(dir, "key");
    writeFileSync(keyFile, `${OTHER}\n`);
    const restore = (args: string[], users: string) => {
      const env = fakeDocker(dir, users);
      writeFileSync(env.FAKE_LOG as string, "");
      let code = 0;
      try {
        execFileSync("python3", [RESTORE, "db", dump, ...args], { encoding: "utf8", env, stdio: "pipe" });
      } catch (e) {
        code = (e as { status: number }).status;
      }
      return { code, log: read(env.FAKE_LOG as string) };
    };
    for (const [args, users] of [[[], "0"], [["--yes"], "5"], [["--yes", "--root-key", keyFile], "0"]] as const) {
      const r = restore([...args], users);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.log, args.join(" ")).not.toMatch(/drop database|docker stop|stop /);
    }
    writeFileSync(keyFile, `${KEY}\n`);
    const ok = restore(["--yes", "--root-key", keyFile, "--replace-existing"], "5");
    const lines = ok.log.split("\n");
    const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
    expect(at(/^stop supabase_auth_kecon-staging supabase_rest_kecon-staging ::/)).toBeGreaterThan(-1);
    expect(at(/psql -U supabase_admin -d template1 .*drop database if exists postgres with \(force\)/)).toBeGreaterThan(at(/^stop /));
    expect(at(/pg_restore -U supabase_admin -d template1 --create/)).toBeGreaterThan(at(/drop database/));
    expect(at(/^start supabase_auth_kecon-staging supabase_rest_kecon-staging/)).toBeGreaterThan(at(/--create/));
    expect(ok.log).not.toContain("other_db");
  });
});
