/**
 * Admin › Sao lưu (migration 040, docs/admin-backup.md) — types + pure helpers.
 *
 * The web app never runs anything on the server: staff write settings and
 * "Sao lưu ngay" requests to the DB; the server's worker
 * (deploy/prized/backup/kecon_backup.py --tick, systemd timer every 2 minutes)
 * reads them, runs the backup and reports back. The backup repo and the
 * encryption passphrase are server-only on purpose.
 */

export type BackupRunKind = "scheduled" | "manual" | "cli";
export type BackupRunStatus = "running" | "ok" | "push_failed" | "restore_failed" | "failed";
export type PushVia = "vault_token" | "file_token" | "deploy_key" | "none";
export type TokenCheckStatus = "ok" | "no_push" | "public_repo" | "expired" | "invalid" | "not_found" | "error" | "missing" | "deploy_key";
export type TokenKind = "fine_grained" | "classic";

export interface BackupRestoreCheck {
  ok?: boolean | null;
  tables?: number | null;
  rows?: Record<string, number> | null;
  pg_restore_errors?: number | null;
  vault?: { secrets?: number | null; decrypted?: number | null; match?: boolean | null } | null;
}

export interface BackupSummary {
  stories?: number | null;
  family_stories?: number | null;
  media?: { files?: number; copied?: number; bytes?: number } | null;
  private_buckets?: Record<string, number> | null;
  db_snapshots?: number | null;
  restore_check?: BackupRestoreCheck | null;
  main_pushed?: boolean | null;
  main_commit?: string | null;
  snapshots_pushed?: boolean | null;
  snapshots_commit?: string | null;
  retention?: { daily: number; weekly: number; monthly: number } | null;
  postgres?: string | null;
  duration_s?: number | null;
}

export interface BackupRun {
  id: number;
  kind: BackupRunKind;
  status: BackupRunStatus;
  phase: string | null;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  release: string | null;
  error: string | null;
  summary: BackupSummary | null;
  reason: string | null;
  requested_by_email: string | null;
}

export interface BackupTokenCheck {
  status: TokenCheckStatus;
  source: PushVia | null;
  kind: TokenKind | "other" | null;
  last4: string | null;
  expires_at: string | null;
  push: boolean | null;
  private: boolean | null;
  message: string | null;
  checked_at: string | null;
}

export interface BackupSnapshot {
  file: string;
  taken: string | null;
  plain_bytes: number | null;
  encrypted_bytes: number | null;
}

export interface BackupSettings {
  schedule_time: string;
  keep_daily: number;
  keep_weekly: number;
  keep_monthly: number;
  version: number;
  updated_at: string | null;
  updated_by_email: string | null;
}

export interface BackupStatus {
  now: string;
  settings: BackupSettings;
  schedule: { timezone: string; slot: string; slot_done: boolean; tries: number; due: boolean; running: boolean; next_run_at: string | null };
  token: { is_set: boolean; last4: string | null; kind: TokenKind | null; set_at: string | null; set_by_email: string | null };
  worker: {
    heartbeat_at: string | null;
    release: string | null;
    repo: string | null;
    push_via: PushVia | null;
    passphrase_ok: boolean | null;
    token_check: BackupTokenCheck | null;
    snapshots: BackupSnapshot[];
  };
  runs: BackupRun[];
  last_success: { id: number; kind: BackupRunKind; started_at: string; finished_at: string | null; summary: BackupSummary | null } | null;
  request: { id: number; status: "pending" | "running"; requested_at: string; reason: string; requested_by_email: string | null } | null;
  requests_last_hour: number;
  limits: { requests_per_hour: number; keep_daily: [number, number]; keep_weekly: [number, number]; keep_monthly: [number, number] };
  can_set_token: boolean;
}

export const REASON_MIN = 10;
export const REASON_MAX = 500;
/** The worker ticks every 2 minutes; this much silence (without a run in progress) means it is not running. */
export const WORKER_SILENT_MS = 10 * 60_000;
/** A daily backup older than this is a red flag. */
export const STALE_SUCCESS_MS = 36 * 3600_000;
export const TOKEN_EXPIRY_WARN_DAYS = 14;
/** Same formats the DB accepts (admin_set_backup_token). */
export const TOKEN_FORMAT = /^(github_pat_|ghp_)[A-Za-z0-9_]{20,250}$/;
/** owner/name, as the backup_worker.repo CHECK. */
export const REPO_FORMAT = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
export const NEW_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

export const RUN_STATUS_LABELS: Record<BackupRunStatus, string> = {
  running: "Đang chạy",
  ok: "Thành công",
  push_failed: "Đẩy lên GitHub lỗi",
  restore_failed: "Khôi phục thử không đạt",
  failed: "Lỗi",
};
export const RUN_KIND_LABELS: Record<BackupRunKind, string> = {
  scheduled: "Theo lịch",
  manual: "Sao lưu ngay",
  cli: "Trên máy chủ",
};
export const PHASE_LABELS: Record<string, string> = {
  start: "Bắt đầu",
  media: "Chép tranh + audio truyện",
  stories: "Xuất truyện",
  private: "Mã hoá dữ liệu riêng tư",
  db_snapshot: "Chụp cơ sở dữ liệu (mã hoá)",
  restore_check: "Khôi phục thử",
  push: "Đẩy lên GitHub",
};
export const PUSH_VIA_LABELS: Record<PushVia, string> = {
  vault_token: "token đặt ở trang này (Vault)",
  file_token: "token trong file trên máy chủ (đặt tay)",
  deploy_key: "SSH deploy key trên máy chủ",
  none: "chưa có",
};
export const TOKEN_STATUS_LABELS: Record<TokenCheckStatus, string> = {
  ok: "Đẩy được, repo riêng tư",
  no_push: "Token chỉ đọc được — cần Contents: Read and write",
  public_repo: "Repo sao lưu đang công khai — đổi về Private ngay",
  expired: "Token đã hết hạn",
  invalid: "GitHub không nhận token (sai, hết hạn hoặc bị thu hồi)",
  not_found: "Token không truy cập được repo sao lưu",
  error: "Chưa kiểm tra được (GitHub không trả lời)",
  missing: "Máy chủ chưa có token hoặc deploy key",
  deploy_key: "Dùng SSH deploy key (không kiểm tra được hạn dùng)",
};

const VN_TZ = "Asia/Ho_Chi_Minh";
const DAY_MS = 86_400_000;

export function formatVnDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN", { timeZone: VN_TZ, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatVnDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("vi-VN", { timeZone: VN_TZ, day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)} giây`;
  const m = Math.floor(seconds / 60),
    s = Math.round(seconds % 60);
  return s ? `${m} phút ${s} giây` : `${m} phút`;
}

/** "≈ 3 phút trước" style, for heartbeats and last runs. */
export function formatAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return "chưa bao giờ";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const min = Math.round((now - t) / 60_000);
  if (min < 1) return "vừa xong";
  if (min < 60) return `${min} phút trước`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} giờ trước`;
  return `${Math.round(h / 24)} ngày trước`;
}

export function reasonProblem(reason: string): string | null {
  const n = reason.trim().length;
  return n >= REASON_MIN && n <= REASON_MAX ? null : `Lý do cần ${REASON_MIN}–${REASON_MAX} ký tự (ghi vào Nhật ký).`;
}

export function daysLeft(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.ceil((t - now) / DAY_MS);
}

export interface BackupWarning {
  level: "error" | "warning" | "info";
  code: string;
  text: string;
}

const BAD_TOKEN: readonly TokenCheckStatus[] = ["invalid", "not_found", "no_push", "public_repo", "expired", "missing"];

/** What staff must know first — red = backups are not happening or not usable. */
export function backupWarnings(s: BackupStatus, now: number = Date.parse(s.now)): BackupWarning[] {
  const out: BackupWarning[] = [];
  const w = s.worker;
  const running = s.runs.some((r) => r.status === "running");
  const seen = w.heartbeat_at ? Date.parse(w.heartbeat_at) : NaN;
  if (!w.heartbeat_at) {
    out.push({ level: "error", code: "worker_never", text: "Máy chủ sao lưu chưa báo về lần nào: kecon-backup.timer chưa chạy bản mới (deploy lại để bật)." });
  } else if (!running && now - seen > WORKER_SILENT_MS) {
    out.push({
      level: "error",
      code: "worker_silent",
      text: `Máy chủ sao lưu im lặng từ ${formatVnDateTime(w.heartbeat_at)} (bình thường 2 phút một lần): kiểm tra kecon-backup.timer trên máy chủ.`,
    });
  }
  if (w.heartbeat_at && w.passphrase_ok === false) {
    out.push({ level: "error", code: "no_passphrase", text: "Máy chủ chưa có mật khẩu mã hoá (passphrase, chmod 600) nên không sao lưu được. Mật khẩu chỉ đặt trực tiếp trên máy chủ." });
  }
  const last = s.runs.find((r) => r.status !== "running");
  if (last && last.status !== "ok") {
    out.push({
      level: "error",
      code: "last_failed",
      text: `Lần sao lưu gần nhất (${formatVnDateTime(last.started_at)}): ${RUN_STATUS_LABELS[last.status]}${last.error ? ` — ${last.error}` : ""}.`,
    });
  }
  if (!s.last_success) {
    out.push({ level: "error", code: "never_ok", text: "Chưa có bản sao lưu thành công nào được ghi nhận." });
  } else {
    const okAt = Date.parse(s.last_success.finished_at ?? s.last_success.started_at);
    if (now - okAt > STALE_SUCCESS_MS) {
      out.push({ level: "error", code: "stale_ok", text: `Bản sao lưu thành công gần nhất đã hơn 36 giờ (${formatVnDateTime(s.last_success.finished_at ?? s.last_success.started_at)}).` });
    }
  }
  const tc = w.token_check;
  if (w.heartbeat_at && (w.push_via === "none" || (tc && BAD_TOKEN.includes(tc.status)))) {
    const text = !tc || w.push_via === "none" ? TOKEN_STATUS_LABELS.missing : tc.message || TOKEN_STATUS_LABELS[tc.status];
    out.push({ level: "error", code: "token_bad", text: `Token GitHub: ${text}.` });
  } else if (tc?.status === "error") {
    out.push({ level: "warning", code: "token_unchecked", text: `Chưa kiểm tra được token GitHub${tc.message ? `: ${tc.message}` : ""}. Máy chủ thử lại trước lần sao lưu tới.` });
  }
  const left = tc?.status === "ok" ? daysLeft(tc.expires_at, now) : null;
  if (left !== null && left <= TOKEN_EXPIRY_WARN_DAYS) {
    out.push({
      level: "warning",
      code: "token_expiring",
      text: `Token GitHub hết hạn ngày ${formatVnDate(tc?.expires_at)} (còn ${Math.max(0, left)} ngày): tạo token mới và lưu ở mục Token GitHub trước ngày đó.`,
    });
  }
  if (tc?.status === "ok" && tc.kind === "classic") {
    out.push({ level: "warning", code: "token_classic", text: "Đang dùng token classic (ghp_) — mở quyền tới mọi repo của tài khoản. Nên thay bằng token fine-grained chỉ cho repo sao lưu." });
  }
  if (tc?.status === "ok" && !tc.expires_at && tc.source !== "deploy_key") {
    out.push({ level: "info", code: "token_no_expiry", text: "Token GitHub không đặt hạn dùng. Nên dùng token có hạn (ví dụ 90 ngày) và thay định kỳ." });
  }
  if (s.token.is_set && s.token.set_at && (tc?.source !== "vault_token" || !tc.checked_at || Date.parse(tc.checked_at) < Date.parse(s.token.set_at))) {
    out.push({ level: "info", code: "token_pending", text: "Token mới đã lưu — máy chủ chuyển sang dùng và kiểm tra lại ở lượt kế tiếp (≤ 2 phút)." });
  }
  return out;
}

// ── Retention (same rule as kecon_backup.retained(), Vietnam time) ─────────

const STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

function buckets(stamp: string): { day: string; week: string; month: string } | null {
  const m = STAMP.exec(stamp);
  if (!m) return null;
  const vn = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + 7 * 3600_000);
  const y = vn.getUTCFullYear(),
    mo = vn.getUTCMonth(),
    d = vn.getUTCDate();
  const thursday = new Date(Date.UTC(y, mo, d - ((vn.getUTCDay() + 6) % 7) + 3));
  const isoYear = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / DAY_MS / 7);
  return { day: `${y}-${mo + 1}-${d}`, week: `${isoYear}-W${week}`, month: `${y}-${mo + 1}` };
}

export interface Retention {
  keep_daily: number;
  keep_weekly: number;
  keep_monthly: number;
}

/** Stamps (YYYYMMDDTHHMMSSZ) kept by a retention rule: newest per day / ISO week / month, newest first. */
export function retainedStamps(stamps: readonly string[], r: Retention): Set<string> {
  const keep = new Set<string>();
  const days: string[] = [],
    weeks: string[] = [],
    months: string[] = [];
  for (const s of [...new Set(stamps)].sort().reverse()) {
    const b = buckets(s);
    if (!b) continue;
    if (!days.includes(b.day) && days.length < r.keep_daily) {
      days.push(b.day);
      keep.add(s);
    }
    if (!weeks.includes(b.week) && weeks.length < r.keep_weekly) {
      weeks.push(b.week);
      keep.add(s);
    }
    if (!months.includes(b.month) && months.length < r.keep_monthly) {
      months.push(b.month);
      keep.add(s);
    }
  }
  return keep;
}

const stampOf = (s: BackupSnapshot) => s.taken ?? s.file.slice(3, 19);

/** Snapshots the next backup would delete for good under `next` (the db-snapshots branch is overwritten). */
export function snapshotsDropped(snapshots: readonly BackupSnapshot[], next: Retention): BackupSnapshot[] {
  const keep = retainedStamps(snapshots.map(stampOf), next);
  return snapshots.filter((s) => !keep.has(stampOf(s)));
}

/** Snapshots kept once there is enough history (one backup a day), and their rough size. */
export function retentionEstimate(r: Retention, snapshots: readonly BackupSnapshot[]): { count: number; bytes: number | null } {
  const stamps: string[] = [];
  const start = Date.UTC(2030, 0, 1, 20, 15);
  for (let i = 0; i < 800; i++) {
    const d = new Date(start - i * DAY_MS);
    stamps.push(d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""));
  }
  const count = retainedStamps(stamps, r).size;
  const sizes = snapshots.map((s) => s.encrypted_bytes).filter((n): n is number => typeof n === "number" && n > 0);
  const avg = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : null;
  return { count, bytes: avg === null ? null : Math.round(avg * count) };
}

// ── Errors ────────────────────────────────────────────────────────────────

/** Supabase RPC error → message for staff (never the raw DB text). */
export function backupRpcError(error: { code?: string; message?: string } | null | undefined): string {
  const code = error?.code ?? "",
    msg = error?.message ?? "";
  if (code === "42501") return "Không có quyền với mục Sao lưu, hoặc phiên quản trị đã hết hạn. Xác thực lại rồi thử lại.";
  if (code === "40001") return "Vừa có người khác đổi cài đặt sao lưu. Đã tải lại bản mới nhất — kiểm tra rồi lưu lại.";
  if (code === "55006") return "Đang có một lần sao lưu chờ hoặc đang chạy. Đợi lần đó xong rồi thử lại.";
  if (code === "54000") return "Đã yêu cầu sao lưu 3 lần trong một giờ qua. Thử lại sau.";
  if (code === "22023" && /Lý do/.test(msg)) return `Lý do cần ${REASON_MIN}–${REASON_MAX} ký tự.`;
  if (code === "22023" && /token/i.test(msg)) return "Token phải bắt đầu bằng github_pat_ (fine-grained) hoặc ghp_ (classic).";
  if (code === "22023") return "Giá trị không hợp lệ: giờ HH:MM, giữ 3–30 bản ngày, 0–12 bản tuần, 0–24 bản tháng.";
  // The server answered with an error we do not expect: not a network problem, nothing was changed.
  if (/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(code)) return `Máy chủ báo lỗi (mã ${code}), chưa có gì thay đổi. Thử lại sau; nếu vẫn lỗi, báo đội kỹ thuật kèm mã này.`;
  return "Chưa thực hiện được. Kiểm tra mạng rồi thử lại.";
}

// ── GitHub token check (API route; same checks as the worker's check_token) ─

export type TokenProblem = "token_invalid" | "token_expired" | "repo_not_found" | "repo_public" | "token_no_push" | "github_unreachable";

export type GithubTokenCheck =
  | { ok: true; kind: TokenKind; last4: string; expiresAt: string | null; warnings: string[] }
  | { ok: false; code: TokenProblem; message: string };

export function tokenKind(token: string): TokenKind {
  return token.startsWith("github_pat_") ? "fine_grained" : "classic";
}

/** `GitHub-Authentication-Token-Expiration: 2026-11-04 11:57:04 UTC` → ISO 8601. */
export function parseTokenExpiry(value: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{4})$/.exec((value ?? "").trim());
  if (!m) return null;
  const zone = m[3] === "UTC" ? "Z" : `${m[3].slice(0, 3)}:${m[3].slice(3)}`;
  const t = Date.parse(`${m[1]}T${m[2]}${zone}`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Repo visible + private (REST API), push allowed (git receive-pack only
 * advertises refs to a credential that may push), expiry header. Nothing here
 * echoes the token or GitHub's raw answer.
 */
export async function checkGithubToken(token: string, repo: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<GithubTokenCheck> {
  const unreachable = { ok: false, code: "github_unreachable", message: "Không kiểm tra được với GitHub lúc này. Thử lại sau ít phút." } as const;
  let info: { private?: unknown };
  let expiresAt: string | null;
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "KeCon-Admin" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) return { ok: false, code: "token_invalid", message: "GitHub không nhận token này (sai, đã hết hạn hoặc bị thu hồi)." };
    if (res.status === 404) return { ok: false, code: "repo_not_found", message: `Token không truy cập được repo ${repo}. Khi tạo token, chọn đúng repo này ở “Repository access”.` };
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") return unreachable;
    if (res.status === 403) return { ok: false, code: "token_invalid", message: "GitHub từ chối token này (HTTP 403)." };
    if (res.status !== 200) return unreachable;
    info = (await res.json()) as { private?: unknown };
    expiresAt = parseTokenExpiry(res.headers.get("github-authentication-token-expiration"));
  } catch {
    return unreachable;
  }
  if (info.private !== true) return { ok: false, code: "repo_public", message: `Repo ${repo} đang công khai. Đổi repo về Private trước khi lưu token.` };
  if (expiresAt && Date.parse(expiresAt) <= now) return { ok: false, code: "token_expired", message: "Token đã hết hạn." };
  try {
    const res = await fetchImpl(`https://github.com/${repo}.git/info/refs?service=git-receive-pack`, {
      headers: { Authorization: `Basic ${btoa(`x-access-token:${token}`)}`, "User-Agent": "git/2 KeCon-Admin" },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    void res.body?.cancel().catch(() => undefined); // only status + headers matter
    const advertised = res.status === 200 && (res.headers.get("content-type") ?? "").startsWith("application/x-git-receive-pack-advertisement");
    if (!advertised) {
      if ([200, 401, 403, 404].includes(res.status))
        return { ok: false, code: "token_no_push", message: "Token chỉ đọc được repo. Cần quyền Contents: Read and write cho repo sao lưu." };
      return unreachable;
    }
  } catch {
    return unreachable;
  }
  const kind = tokenKind(token);
  const warnings: string[] = [];
  const left = daysLeft(expiresAt, now);
  if (left !== null && left <= TOKEN_EXPIRY_WARN_DAYS) warnings.push(`Token hết hạn ngày ${formatVnDate(expiresAt)} (còn ${left} ngày).`);
  if (!expiresAt) warnings.push("Token không đặt hạn dùng — nên dùng token có hạn và thay định kỳ.");
  if (kind === "classic") warnings.push("Token classic mở quyền tới mọi repo của tài khoản — nên dùng token fine-grained chỉ cho repo sao lưu.");
  return { ok: true, kind, last4: token.slice(-4), expiresAt, warnings };
}

// ── Run results ───────────────────────────────────────────────────────────

/** Snapshot stamp `20261016T102451Z` → ISO 8601 (UTC). */
export function stampToIso(stamp: string | null | undefined): string | null {
  const m = STAMP.exec(stamp ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

/** Runs that ended between two reads of the status (the page announces them). */
export function finishedSince(prev: BackupStatus, next: BackupStatus): BackupRun[] {
  const wasRunning = new Set(prev.runs.filter((r) => r.status === "running").map((r) => r.id));
  const known = new Set(prev.runs.map((r) => r.id));
  return next.runs.filter(
    (r) => r.status !== "running" && (wasRunning.has(r.id) || (!known.has(r.id) && prev.request !== null && r.kind === "manual")),
  );
}

export function runOutcome(run: BackupRun): { ok: boolean; text: string } {
  if (run.status === "ok") {
    const s = run.summary;
    const restore = s?.restore_check ? (s.restore_check.ok ? ", khôi phục thử đạt" : ", khôi phục thử KHÔNG đạt") : "";
    return { ok: true, text: `Sao lưu xong${s?.stories != null ? `: ${s.stories} truyện` : ""}${restore}, đã đẩy lên GitHub.` };
  }
  return { ok: false, text: `Sao lưu không thành công — ${RUN_STATUS_LABELS[run.status]}${run.error ? `: ${run.error}` : ""}` };
}
