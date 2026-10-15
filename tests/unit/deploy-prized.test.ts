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
