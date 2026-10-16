"use client";
/**
 * Admin › Sao lưu (migration 040, docs/admin-backup.md). Status of the GitHub
 * backup, "Sao lưu ngay", daily time + snapshots kept, the push token.
 * The page only writes rows (reason + audit log for each change); the server's
 * worker picks them up within 2 minutes. The backup repo and the encryption
 * passphrase are deliberately not editable here. Mobile first: cards, 44px targets.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { useAdminConfirm } from "@/components/admin/AdminConfirm";
import { AdminHeader, AdminTable } from "@/components/admin/AdminUi";
import { AlertTriangle, CheckCircle, ExternalLink, Info, Loader2, RefreshCw, XCircle } from "@/components/ui/icons";
import {
  NEW_TOKEN_URL,
  PHASE_LABELS,
  PUSH_VIA_LABELS,
  REASON_MAX,
  RUN_KIND_LABELS,
  RUN_STATUS_LABELS,
  TOKEN_FORMAT,
  TOKEN_STATUS_LABELS,
  backupRpcError,
  backupWarnings,
  daysLeft,
  finishedSince,
  formatAgo,
  formatBytes,
  formatDuration,
  formatVnDate,
  formatVnDateTime,
  reasonProblem,
  retentionEstimate,
  runOutcome,
  snapshotsDropped,
  stampToIso,
  type BackupRun,
  type BackupStatus,
  type BackupSummary,
  type BackupWarning,
  type Retention,
} from "@/lib/admin-backup";

const fetchStatus = async (): Promise<{ data?: BackupStatus; error?: string }> => {
  const { data, error } = await createClient().rpc("admin_backup_status");
  return error || !data ? { error: backupRpcError(error) } : { data: data as BackupStatus };
};

const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 60_000;

function Card({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
      <h2 id={id} className="text-base font-bold">
        {title}
      </h2>
      <div className="mt-2 space-y-1.5 text-sm">{children}</div>
    </section>
  );
}

const CHIP: Record<string, string> = {
  ok: "bg-green-100 text-green-900",
  running: "bg-blue-100 text-blue-900",
  bad: "bg-red-100 text-red-900",
};

function StatusChip({ run }: { run: Pick<BackupRun, "status"> }) {
  const tone = run.status === "ok" ? CHIP.ok : run.status === "running" ? CHIP.running : CHIP.bad;
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>{RUN_STATUS_LABELS[run.status]}</span>;
}

function restoreText(summary: BackupSummary | null | undefined): string {
  const rc = summary?.restore_check;
  if (!rc) return "Khôi phục thử: không chạy";
  const vault = rc.vault ? ` · Vault ${rc.vault.decrypted ?? 0}/${rc.vault.secrets ?? 0}${rc.vault.match ? " khớp" : " không khớp"}` : "";
  return `Khôi phục thử: ${rc.ok ? "đạt" : "KHÔNG đạt"} (${rc.tables ?? "?"} bảng, ${rc.pg_restore_errors ?? 0} lỗi${vault})`;
}

function contentText(summary: BackupSummary | null | undefined): string {
  if (!summary) return "—";
  const parts = [
    summary.stories != null ? `${summary.stories} truyện` : null,
    summary.media?.files != null ? `${summary.media.files} file media (${formatBytes(summary.media.bytes)})` : null,
    summary.db_snapshots != null ? `${summary.db_snapshots} bản chụp DB` : null,
  ];
  return parts.filter(Boolean).join(" · ") || "—";
}

function pushText(summary: BackupSummary | null | undefined): string {
  if (!summary) return "—";
  if (summary.main_pushed && summary.snapshots_pushed) {
    return `Đã đẩy lên GitHub (main ${summary.main_commit?.slice(0, 7) ?? "?"} · db-snapshots ${summary.snapshots_commit?.slice(0, 7) ?? "?"})`;
  }
  return "Chưa đẩy được lên GitHub";
}

function runDuration(r: BackupRun): string {
  if (r.summary?.duration_s != null) return formatDuration(r.summary.duration_s);
  if (!r.finished_at) return "—";
  return formatDuration((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000);
}

function WarningList({ warnings }: { warnings: BackupWarning[] }) {
  const style = {
    error: { box: "border-red-200 bg-red-50 text-red-900", label: "Cần xử lý", Icon: XCircle },
    warning: { box: "border-amber-200 bg-amber-50 text-amber-950", label: "Lưu ý", Icon: AlertTriangle },
    info: { box: "border-blue-200 bg-blue-50 text-blue-950", label: "Thông tin", Icon: Info },
  } as const;
  return (
    <ul className="space-y-2" aria-label="Cảnh báo sao lưu">
      {warnings.map((w) => {
        const { box, label, Icon } = style[w.level];
        return (
          <li key={w.code} data-level={w.level} className={`flex gap-2.5 rounded-xl border p-3 text-sm ${box}`}>
            <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
            <p>
              <strong>{label}:</strong> {w.text}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export default function AdminBackup({ onBack, canSetToken }: { onBack: () => void; canSetToken: boolean }) {
  const { toast } = useToast();
  const confirm = useAdminConfirm();
  const ids = useId();
  const [state, setState] = useState<{ data?: BackupStatus; error?: string } | null>(null);
  const [busy, setBusy] = useState<"request" | "settings" | "token" | null>(null);
  const last = useRef<BackupStatus | null>(null);

  const reload = useCallback(async () => {
    const r = await fetchStatus();
    if (r.data && last.current) {
      for (const run of finishedSince(last.current, r.data)) {
        const o = runOutcome(run);
        toast(o.ok ? "success" : "error", o.text, o.ok ? 6000 : 12000);
      }
    }
    if (r.data) last.current = r.data;
    // A failed refresh keeps showing the last good status (with the error on top).
    setState((prev) => (r.data ? r : { data: prev?.data, error: r.error }));
    return r.data ?? null;
  }, [toast]);

  useEffect(() => {
    let alive = true;
    fetchStatus().then((r) => {
      if (!alive) return;
      if (r.data) last.current = r.data;
      setState(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  const data = state?.data ?? null;
  const active = Boolean(data && (data.request || data.runs.some((r) => r.status === "running")));
  useEffect(() => {
    if (!data) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(t);
  }, [active, data, reload]);

  const now = data ? Date.parse(data.now) : 0;
  const running = data?.runs.find((r) => r.status === "running") ?? null;
  const warnings = data ? backupWarnings(data, now) : [];
  const requestBlocked = !data
    ? "Đang tải…"
    : data.request || running
      ? "Đang có một lần sao lưu chờ hoặc đang chạy."
      : data.requests_last_hour >= data.limits.requests_per_hour
        ? `Đã yêu cầu ${data.limits.requests_per_hour} lần trong một giờ qua.`
        : data.worker.heartbeat_at && data.worker.passphrase_ok === false
          ? "Máy chủ chưa có mật khẩu mã hoá."
          : null;

  async function requestBackup() {
    if (requestBlocked) return;
    const reason = await confirm({
      title: "Sao lưu ngay?",
      description:
        "Máy chủ nhận yêu cầu trong vòng 2 phút rồi chạy đủ các bước như bản hằng ngày: truyện, tranh + audio, dữ liệu riêng tư và cơ sở dữ liệu (mã hoá), khôi phục thử, đẩy lên GitHub. Thường mất vài phút. Tối đa 3 lần mỗi giờ.",
      confirmLabel: "Sao lưu ngay",
    });
    if (!reason) return;
    setBusy("request");
    const { error } = await createClient().rpc("admin_request_backup", { p_reason: reason });
    setBusy(null);
    if (error) {
      toast("error", backupRpcError(error));
      await reload();
      return;
    }
    toast("success", "Đã gửi yêu cầu. Máy chủ nhận trong vòng 2 phút — trang tự cập nhật tiến độ.");
    await reload();
  }

  return (
    <div className="min-h-full pb-12">
      <AdminHeader
        title="Sao lưu"
        onBack={onBack}
        rightElement={
          <div className="flex flex-wrap items-center gap-2">
            <button className="admin-button" onClick={() => void reload()} aria-label="Tải lại trạng thái sao lưu">
              <RefreshCw size={18} />
            </button>
            <button
              className="min-h-11 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              onClick={() => void requestBackup()}
              disabled={Boolean(requestBlocked) || busy === "request"}
              aria-describedby={requestBlocked && data ? `${ids}-blocked` : undefined}
            >
              {busy === "request" ? "Đang gửi…" : "Sao lưu ngay"}
            </button>
          </div>
        }
      />
      <div className="space-y-6 p-5">
        <p className="max-w-3xl text-sm leading-relaxed text-ink-2">
          Máy chủ tự sao lưu lên một repo GitHub riêng tư mỗi ngày: truyện, tranh và audio (đọc được ngay trên GitHub), dữ liệu riêng tư của các gia
          đình và toàn bộ cơ sở dữ liệu (mã hoá AES-256). Lần nào cũng khôi phục thử để chắc bản sao lưu dùng được. Ở đây chỉ đặt giờ chạy, số bản
          giữ lại, token và yêu cầu chạy; repo đích và mật khẩu mã hoá chỉ nằm trên máy chủ. Mỗi thay đổi cần lý do và được ghi vào Nhật ký.
        </p>
        {requestBlocked && data && (
          <p id={`${ids}-blocked`} className="text-sm text-ink-2">
            “Sao lưu ngay” đang tắt: {requestBlocked}
          </p>
        )}
        {state?.error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {state.error}
            <button className="admin-button" onClick={() => void reload()}>
              Thử lại
            </button>
          </div>
        )}
        {!state && (
          <p role="status" className="flex items-center gap-2">
            <Loader2 size={20} className="animate-spin" /> Đang tải trạng thái sao lưu…
          </p>
        )}

        {data && (
          <>
            <section aria-labelledby={`${ids}-health`} className="space-y-2">
              <h2 id={`${ids}-health`} className="sr-only">
                Tình trạng
              </h2>
              {warnings.length > 0 ? (
                <WarningList warnings={warnings} />
              ) : (
                <p className="flex gap-2.5 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                  <CheckCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
                  <span>
                    <strong>Ổn:</strong> lần sao lưu gần nhất thành công {formatAgo(data.last_success?.finished_at, now)}, máy chủ báo về{" "}
                    {formatAgo(data.worker.heartbeat_at, now)}.
                  </span>
                </p>
              )}
            </section>

            <div aria-live="polite">
              {(data.request || running) && (
                <p className="flex items-center gap-2.5 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950" data-testid="backup-progress">
                  <Loader2 size={18} className="shrink-0 animate-spin" aria-hidden />
                  {running
                    ? `Đang sao lưu (${RUN_KIND_LABELS[running.kind].toLowerCase()}) — bước: ${PHASE_LABELS[running.phase ?? ""] ?? running.phase ?? "đang chạy"} · bắt đầu ${formatVnDateTime(running.started_at)}`
                    : `Đang chờ máy chủ nhận yêu cầu (gửi ${formatAgo(data.request?.requested_at, now)}${data.request?.requested_by_email ? ` bởi ${data.request.requested_by_email}` : ""}) — thường dưới 2 phút.`}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Card title="Lần thành công gần nhất" id={`${ids}-ok`}>
                {data.last_success ? (
                  <>
                    <p className="font-semibold">
                      {formatVnDateTime(data.last_success.finished_at ?? data.last_success.started_at)} · {RUN_KIND_LABELS[data.last_success.kind]}
                    </p>
                    <p>{contentText(data.last_success.summary)}</p>
                    <p>{restoreText(data.last_success.summary)}</p>
                    <p className="text-ink-2">{pushText(data.last_success.summary)}</p>
                  </>
                ) : (
                  <p>Chưa có.</p>
                )}
              </Card>
              <Card title="Lần chạy tới" id={`${ids}-next`}>
                <p className="font-semibold">
                  {running
                    ? "Đang chạy"
                    : data.schedule.due
                      ? "Đến giờ — máy chủ chạy trong vòng 2 phút"
                      : data.schedule.next_run_at
                        ? formatVnDateTime(data.schedule.next_run_at)
                        : "—"}
                </p>
                <p>Mỗi ngày lúc {data.settings.schedule_time} (giờ Việt Nam).</p>
                <p className="text-ink-2">
                  Lỗi thì tự thử lại sau 30 phút, tối đa 3 lần mỗi ngày.
                  {data.schedule.tries > 0 && !data.schedule.slot_done ? ` Hôm nay đã thử ${data.schedule.tries} lần.` : ""}
                </p>
              </Card>
              <Card title="Máy chủ sao lưu" id={`${ids}-worker`}>
                <p>
                  Báo về: <strong>{formatAgo(data.worker.heartbeat_at, now)}</strong>
                  {data.worker.release ? ` · bản ${data.worker.release.slice(0, 7)}` : ""}
                </p>
                <p className="break-words">
                  Repo:{" "}
                  {data.worker.repo ? (
                    <a className="font-semibold text-brand-ink underline" href={`https://github.com/${data.worker.repo}`} target="_blank" rel="noreferrer">
                      {data.worker.repo}
                      <ExternalLink size={14} className="ml-1 inline" aria-label="(mở tab mới)" />
                    </a>
                  ) : (
                    "—"
                  )}
                </p>
                <p>Đẩy bằng: {data.worker.push_via ? PUSH_VIA_LABELS[data.worker.push_via] : "—"}</p>
                <p>Mật khẩu mã hoá: {data.worker.passphrase_ok == null ? "—" : data.worker.passphrase_ok ? "có (chỉ trên máy chủ)" : "CHƯA CÓ"}</p>
              </Card>
            </div>

            <SettingsForm data={data} busy={busy === "settings"} setBusy={(b) => setBusy(b ? "settings" : null)} reload={reload} />
            <TokenSection data={data} canSetToken={canSetToken && data.can_set_token} busy={busy === "token"} setBusy={(b) => setBusy(b ? "token" : null)} reload={reload} />
            <SnapshotList data={data} />
            <RunHistory data={data} />
          </>
        )}
      </div>
    </div>
  );
}

type SectionProps = { data: BackupStatus; busy: boolean; setBusy: (b: boolean) => void; reload: () => Promise<BackupStatus | null> };

const draftOf = (s: BackupStatus["settings"]) => ({
  time: s.schedule_time,
  daily: String(s.keep_daily),
  weekly: String(s.keep_weekly),
  monthly: String(s.keep_monthly),
});
type Draft = ReturnType<typeof draftOf>;

function SettingsForm({ data, busy, setBusy, reload }: SectionProps) {
  const { toast } = useToast();
  const ids = useId();
  const [edited, setEdited] = useState<Draft | null>(null);
  const [base, setBase] = useState(data.settings.version);
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState("");

  // An untouched form follows the server row (another admin may save meanwhile). The version is
  // pinned when staff starts editing, so a concurrent save is reported (40001) instead of overwritten.
  const s = data.settings;
  const draft = edited ?? draftOf(s);
  const edit = (patch: Partial<Draft>) => {
    if (!edited) setBase(s.version);
    setEdited({ ...draft, ...patch });
  };
  const dirty =
    edited !== null &&
    (draft.time !== s.schedule_time || draft.daily !== String(s.keep_daily) || draft.weekly !== String(s.keep_weekly) || draft.monthly !== String(s.keep_monthly));

  const L = data.limits;
  const num = (v: string, [lo, hi]: [number, number]) => (/^\d{1,2}$/.test(v) && +v >= lo && +v <= hi ? +v : null);
  const next: Partial<Retention> = { keep_daily: num(draft.daily, L.keep_daily) ?? undefined, keep_weekly: num(draft.weekly, L.keep_weekly) ?? undefined, keep_monthly: num(draft.monthly, L.keep_monthly) ?? undefined };
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time) && next.keep_daily !== undefined && next.keep_weekly !== undefined && next.keep_monthly !== undefined;
  const retention = valid ? (next as Retention) : null;
  const dropped = retention ? snapshotsDropped(data.worker.snapshots, retention) : [];
  const estimate = retention ? retentionEstimate(retention, data.worker.snapshots) : null;
  const reasonErr = reasonProblem(reason);

  const field = (key: "daily" | "weekly" | "monthly", label: string, range: [number, number]) => {
    const id = `${ids}-${key}`;
    const bad = tried && num(draft[key], range) === null;
    return (
      <div>
        <label htmlFor={id} className="mb-1.5 block text-sm font-bold">
          {label}
        </label>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={range[0]}
          max={range[1]}
          value={draft[key]}
          onChange={(e) => edit({ [key]: e.target.value })}
          aria-invalid={bad}
          aria-describedby={`${id}-hint`}
          className="admin-input w-28"
        />
        <p id={`${id}-hint`} className={`mt-1 text-xs ${bad ? "text-red-800" : "text-ink-2"}`}>
          {range[0]}–{range[1]}
        </p>
      </div>
    );
  };

  async function save() {
    setTried(true);
    setError("");
    if (!dirty) return;
    if (!valid || reasonErr || (dropped.length > 0 && !ack)) return;
    setBusy(true);
    const { data: r, error: e } = await createClient().rpc("admin_update_backup_settings", {
      p_expected_version: base,
      p_schedule_time: draft.time,
      p_keep_daily: retention!.keep_daily,
      p_keep_weekly: retention!.keep_weekly,
      p_keep_monthly: retention!.keep_monthly,
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (e || !r) {
      const msg = backupRpcError(e);
      setError(msg);
      toast("error", msg);
      if (e?.code === "40001") {
        const fresh = await reload();
        if (fresh) setBase(fresh.settings.version);
      }
      return;
    }
    toast("success", `Đã lưu: chạy lúc ${draft.time} hằng ngày, giữ ${retention!.keep_daily} ngày + ${retention!.keep_weekly} tuần + ${retention!.keep_monthly} tháng.`);
    setReason("");
    setAck(false);
    setTried(false);
    await reload();
    setEdited(null);
  }

  return (
    <section aria-labelledby={`${ids}-h`} className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 id={`${ids}-h`} className="text-lg font-bold">
        Lịch &amp; số bản giữ lại
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">
        Bản chụp cơ sở dữ liệu giữ theo ngày, tuần và tháng (bản mới nhất luôn được giữ). Truyện, tranh và audio trên nhánh main giữ đủ lịch sử
        trong git. Đổi giờ có hiệu lực từ lần chạy kế tiếp; giờ mới đã qua hôm nay thì chạy từ ngày mai (không chạy bù).
        {data.settings.updated_by_email ? ` Lần đổi gần nhất: ${data.settings.updated_by_email}, ${formatVnDateTime(data.settings.updated_at)}.` : ""}
      </p>
      <form
        noValidate
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-wrap items-start gap-4">
          <div>
            <label htmlFor={`${ids}-time`} className="mb-1.5 block text-sm font-bold">
              Giờ chạy hằng ngày (giờ VN)
            </label>
            <input
              id={`${ids}-time`}
              type="time"
              step={60}
              value={draft.time}
              onChange={(e) => edit({ time: e.target.value.slice(0, 5) })}
              aria-invalid={tried && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)}
              className="admin-input w-36"
            />
          </div>
          {field("daily", "Bản theo ngày", L.keep_daily)}
          {field("weekly", "Bản theo tuần", L.keep_weekly)}
          {field("monthly", "Bản theo tháng", L.keep_monthly)}
        </div>
        {estimate && (
          <p className="text-sm text-ink-2" data-testid="retention-estimate">
            Khi đủ lịch sử: khoảng {estimate.count} bản chụp{estimate.bytes != null ? ` ≈ ${formatBytes(estimate.bytes)} trên GitHub (nhánh db-snapshots)` : ""}.
          </p>
        )}
        {dirty && dropped.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900" data-testid="retention-drop">
            <p>
              <strong>Xoá vĩnh viễn:</strong> lần sao lưu kế tiếp sẽ xoá {dropped.length} bản chụp cũ khỏi máy chủ và GitHub (nhánh db-snapshots được ghi đè, không
              lấy lại được): {dropped.slice(0, 5).map((d) => formatVnDate(stampToIso(d.taken))).join(", ")}
              {dropped.length > 5 ? "…" : ""}.
            </p>
            <label className="mt-2 flex min-h-11 items-center gap-3 font-bold">
              <input type="checkbox" className="h-5 w-5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              Tôi hiểu các bản này sẽ bị xoá vĩnh viễn
            </label>
            {tried && !ack && <p className="mt-1 text-red-800">Cần xác nhận trước khi lưu.</p>}
          </div>
        )}
        <div>
          <label htmlFor={`${ids}-reason`} className="mb-1.5 block text-sm font-bold">
            Lý do thay đổi (10–{REASON_MAX} ký tự, ghi vào Nhật ký)
          </label>
          <textarea
            id={`${ids}-reason`}
            rows={2}
            value={reason}
            maxLength={REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={tried && dirty && Boolean(reasonErr)}
            aria-describedby={tried && dirty && reasonErr ? `${ids}-reason-err` : undefined}
            placeholder="Ví dụ: Dời giờ sao lưu sau giờ đọc truyện tối"
            className="admin-input w-full max-w-2xl"
          />
          {tried && dirty && reasonErr && (
            <p id={`${ids}-reason-err`} className="mt-1 text-sm text-red-800">
              {reasonErr}
            </p>
          )}
        </div>
        {tried && !dirty && <p className="text-sm">Chưa có gì thay đổi.</p>}
        {tried && dirty && !valid && <p className="text-sm text-red-800">Kiểm tra lại giờ (HH:MM) và số bản trong khoảng cho phép.</p>}
        {error && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
        <button type="submit" className="min-h-11 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50" disabled={busy}>
          {busy ? "Đang lưu…" : "Lưu lịch sao lưu"}
        </button>
      </form>
    </section>
  );
}

function TokenSection({ data, canSetToken, busy, setBusy, reload }: SectionProps & { canSetToken: boolean }) {
  const { toast } = useToast();
  const ids = useId();
  const [token, setToken] = useState("");
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; warnings?: string[] } | null>(null);
  const now = Date.parse(data.now);
  const tc = data.worker.token_check;
  const left = daysLeft(tc?.expires_at, now);
  const trimmed = token.trim();
  const tokenErr = !trimmed ? "Dán token GitHub mới." : TOKEN_FORMAT.test(trimmed) ? null : "Token phải bắt đầu bằng github_pat_ (fine-grained) hoặc ghp_ (classic), không có khoảng trắng.";
  const reasonErr = reasonProblem(reason);

  async function save() {
    setTried(true);
    setResult(null);
    if (tokenErr || reasonErr) return;
    setBusy(true);
    let res: Response | null = null;
    try {
      res = await fetch("/api/admin/backup/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: trimmed, reason: reason.trim() }),
      });
    } catch {
      res = null;
    }
    const body = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string; last4?: string; kind?: string; expires_at?: string | null; warnings?: string[] } | null;
    setBusy(false);
    if (!res?.ok || !body?.ok) {
      const text = body?.error ?? "Chưa lưu được token. Kiểm tra mạng rồi thử lại.";
      setResult({ ok: false, text });
      toast("error", text);
      return;
    }
    const text = `Đã lưu token …${body.last4} (${body.kind === "fine_grained" ? "fine-grained" : "classic"}${body.expires_at ? `, hết hạn ${formatVnDate(body.expires_at)}` : ""}). Máy chủ dùng token mới từ lượt kế tiếp (≤ 2 phút).`;
    setResult({ ok: true, text, warnings: body.warnings });
    toast("success", text);
    setToken("");
    setReason("");
    setTried(false);
    await reload();
  }

  return (
    <section aria-labelledby={`${ids}-h`} className="rounded-xl border border-gray-200 bg-white p-4" data-testid="backup-token">
      <h2 id={`${ids}-h`} className="text-lg font-bold">
        Token GitHub
      </h2>
      <div className="mt-2 space-y-1.5 text-sm">
        <p>
          Trang này:{" "}
          {data.token.is_set ? (
            <strong>
              Đã đặt · …{data.token.last4} · {data.token.kind === "fine_grained" ? "fine-grained" : "classic"}
            </strong>
          ) : (
            <strong>Chưa đặt</strong>
          )}
          {data.token.is_set && data.token.set_at ? ` · ${data.token.set_by_email ?? "?"}, ${formatVnDateTime(data.token.set_at)}` : ""}
        </p>
        <p>
          Máy chủ đang đẩy bằng: {data.worker.push_via ? PUSH_VIA_LABELS[data.worker.push_via] : "—"}
          {tc?.last4 ? ` (…${tc.last4})` : ""}
        </p>
        {tc && (
          <p>
            Kiểm tra lúc {formatVnDateTime(tc.checked_at)}:{" "}
            <strong className={tc.status === "ok" ? "text-green-900" : tc.status === "deploy_key" ? "" : "text-red-800"}>{TOKEN_STATUS_LABELS[tc.status]}</strong>
            {tc.status === "ok" && tc.expires_at ? ` · hết hạn ${formatVnDate(tc.expires_at)}${left !== null ? ` (còn ${Math.max(0, left)} ngày)` : ""}` : ""}
            {tc.status === "ok" && !tc.expires_at ? " · không đặt hạn dùng" : ""}
          </p>
        )}
      </div>
      {canSetToken ? (
        <form
          noValidate
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="max-w-2xl rounded-xl bg-parent-bg p-3 text-sm leading-relaxed">
            <p>
              Tạo token <strong>fine-grained</strong> chỉ cho repo <strong>{data.worker.repo ?? "sao lưu"}</strong>, quyền <strong>Contents: Read and write</strong>,
              hạn dùng 90 ngày:{" "}
              <a className="font-semibold text-brand-ink underline" href={NEW_TOKEN_URL} target="_blank" rel="noreferrer">
                tạo token trên GitHub
                <ExternalLink size={14} className="ml-1 inline" aria-label="(mở tab mới)" />
              </a>
              . Token được kiểm tra với GitHub (repo riêng tư, đẩy được), lưu mã hoá trong Vault và không bao giờ hiện lại — chỉ thấy 4 ký tự cuối.
            </p>
          </div>
          <div>
            <label htmlFor={`${ids}-token`} className="mb-1.5 block text-sm font-bold">
              Token mới
            </label>
            <input
              id={`${ids}-token`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              aria-invalid={tried && Boolean(tokenErr)}
              aria-describedby={tried && tokenErr ? `${ids}-token-err` : undefined}
              placeholder="github_pat_…"
              className="admin-input w-full max-w-2xl font-mono"
            />
            {tried && tokenErr && (
              <p id={`${ids}-token-err`} className="mt-1 text-sm text-red-800">
                {tokenErr}
              </p>
            )}
          </div>
          <div>
            <label htmlFor={`${ids}-treason`} className="mb-1.5 block text-sm font-bold">
              Lý do (10–{REASON_MAX} ký tự, ghi vào Nhật ký)
            </label>
            <textarea
              id={`${ids}-treason`}
              rows={2}
              value={reason}
              maxLength={REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={tried && Boolean(reasonErr)}
              aria-describedby={tried && reasonErr ? `${ids}-treason-err` : undefined}
              placeholder="Ví dụ: Thay token sắp hết hạn"
              className="admin-input w-full max-w-2xl"
            />
            {tried && reasonErr && (
              <p id={`${ids}-treason-err`} className="mt-1 text-sm text-red-800">
                {reasonErr}
              </p>
            )}
          </div>
          {result && (
            <div
              role={result.ok ? "status" : "alert"}
              className={`max-w-2xl rounded-xl border p-3 text-sm ${result.ok ? "border-green-200 bg-green-50 text-green-900" : "border-red-200 bg-red-50 text-red-800"}`}
            >
              <p>{result.text}</p>
              {result.warnings?.map((w) => (
                <p key={w} className="mt-1">
                  Lưu ý: {w}
                </p>
              ))}
            </div>
          )}
          <button type="submit" className="min-h-11 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50" disabled={busy}>
            {busy ? "Đang kiểm tra với GitHub…" : "Kiểm tra & lưu token"}
          </button>
        </form>
      ) : (
        <p className="mt-3 text-sm text-ink-2">Đổi token cần thêm quyền quản lý API key (secrets.manage).</p>
      )}
    </section>
  );
}

function SnapshotList({ data }: { data: BackupStatus }) {
  const ids = useId();
  const snaps = data.worker.snapshots;
  const total = snaps.reduce((a, s) => a + (s.encrypted_bytes ?? 0), 0);
  return (
    <section aria-labelledby={`${ids}-h`} className="space-y-3">
      <div>
        <h2 id={`${ids}-h`} className="text-lg font-bold">
          Bản chụp cơ sở dữ liệu ({snaps.length})
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          Mã hoá AES-256, tổng {formatBytes(total)}. Nhánh db-snapshots trên GitHub chỉ giữ một commit, ghi đè mỗi lần sao lưu.
        </p>
      </div>
      {snaps.length > 0 ? (
        <AdminTable caption="Bản chụp cơ sở dữ liệu" headers={["Chụp lúc (giờ VN)", "Dung lượng gốc", "Mã hoá", "Tên file"]}>
          {snaps.slice(0, 40).map((s) => (
            <tr key={s.file}>
              <td className="whitespace-nowrap">{formatVnDateTime(stampToIso(s.taken))}</td>
              <td>{formatBytes(s.plain_bytes)}</td>
              <td>{formatBytes(s.encrypted_bytes)}</td>
              <td className="break-all font-mono text-xs">{s.file}</td>
            </tr>
          ))}
        </AdminTable>
      ) : (
        <p className="text-sm">Máy chủ chưa báo danh sách bản chụp.</p>
      )}
    </section>
  );
}

function RunHistory({ data }: { data: BackupStatus }) {
  const ids = useId();
  return (
    <section aria-labelledby={`${ids}-h`} className="space-y-3">
      <h2 id={`${ids}-h`} className="text-lg font-bold">
        Lịch sử chạy
      </h2>
      {data.runs.length > 0 ? (
        <AdminTable caption="Lịch sử sao lưu" headers={["Bắt đầu", "Loại", "Kết quả", "Thời gian", "Nội dung"]}>
          {data.runs.map((r) => (
            <tr key={r.id} data-testid={`backup-run-${r.id}`}>
              <td className="whitespace-nowrap">{formatVnDateTime(r.started_at)}</td>
              <td>
                <p>{RUN_KIND_LABELS[r.kind]}</p>
                {r.requested_by_email && <p className="text-xs text-ink-2">{r.requested_by_email}</p>}
                {r.reason && <p className="max-w-[16rem] break-words text-xs text-ink-2">“{r.reason}”</p>}
              </td>
              <td>
                <StatusChip run={r} />
                {r.status === "running" && r.phase && <p className="mt-1 text-xs">{PHASE_LABELS[r.phase] ?? r.phase}</p>}
                {r.error && <p className="mt-1 max-w-[18rem] break-words text-xs text-red-800">{r.error}</p>}
              </td>
              <td className="whitespace-nowrap">{runDuration(r)}</td>
              <td className="min-w-[14rem]">
                {r.summary ? (
                  <>
                    <p>{contentText(r.summary)}</p>
                    <p className="text-xs text-ink-2">{restoreText(r.summary)}</p>
                    <p className="text-xs text-ink-2">{pushText(r.summary)}</p>
                  </>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </AdminTable>
      ) : (
        <p className="text-sm">Chưa có lần chạy nào được ghi nhận.</p>
      )}
    </section>
  );
}
