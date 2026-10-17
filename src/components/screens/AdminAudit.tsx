"use client";

/**
 * Admin v2 · A-03 — màn "Nhật ký": ai làm gì, lúc nào, trước → sau.
 * Read-only (the table is append-only in the DB); filters by actor email,
 * action and day range. Visible with `audit.read` (super admin, admin).
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { Loader2, Search } from "@/components/ui/icons";
import { AdminHeader as TopBar } from "@/components/admin/AdminUi";
import {
  listAdminAudit,
  type AdminAuditFilter,
  type AdminAuditRow,
} from "@/lib/db";
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_LABELS,
  auditActionLabel,
  auditChanges,
} from "@/lib/admin-audit";
import { ROLE_LABELS } from "@/lib/admin-permissions";

interface AdminAuditProps {
  onBack: () => void;
}

const PAGE_SIZE = 50;
const ACTION_OPTIONS = Object.entries(AUDIT_ACTIONS) as [string, string][];
const SOURCE_LABELS: Record<string, string> = {
  db: "CSDL",
  api: "API",
  system: "Hệ thống",
};
const roleLabels: Record<string, string> = ROLE_LABELS;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

export default function AdminAudit({ onBack }: AdminAuditProps) {
  const [actor, setActor] = useState("");
  const [actorQuery, setActorQuery] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  /** Result of the last finished load, tagged with the filter it was loaded for. */
  const [result, setResult] = useState<{
    key: string;
    rows: AdminAuditRow[];
    hasMore: boolean;
    error: string | null;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const keyRef = useRef("");

  // Debounce typing in the actor box.
  useEffect(() => {
    const t = setTimeout(() => setActorQuery(actor.trim()), 350);
    return () => clearTimeout(t);
  }, [actor]);

  const filter = useMemo<AdminAuditFilter>(
    () => ({
      actor: actorQuery || undefined,
      action: action || undefined,
      from: from || undefined,
      to: to || undefined,
      limit: PAGE_SIZE,
    }),
    [actorQuery, action, from, to],
  );
  const key = JSON.stringify(filter);
  const loading = result?.key !== key;
  const rows = loading ? [] : result.rows;
  const hasMore = !loading && result.hasMore;
  const error = result?.key === key ? result.error : null;

  useEffect(() => {
    keyRef.current = key;
    listAdminAudit(filter)
      .then((data) => {
        if (keyRef.current === key)
          setResult({
            key,
            rows: data,
            hasMore: data.length === PAGE_SIZE,
            error: null,
          });
      })
      .catch(() => {
        if (keyRef.current === key)
          setResult({
            key,
            rows: [],
            hasMore: false,
            error: "Không tải được nhật ký. Thử lại sau.",
          });
      });
  }, [filter, key]);

  const loadMore = async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const data = await listAdminAudit({ ...filter, beforeId: last.id });
      setResult((prev) =>
        prev && prev.key === key
          ? {
              ...prev,
              rows: [...prev.rows, ...data],
              hasMore: data.length === PAGE_SIZE,
            }
          : prev,
      );
    } catch {
      setResult((prev) =>
        prev && prev.key === key
          ? { ...prev, error: "Không tải thêm được nhật ký." }
          : prev,
      );
    } finally {
      setLoadingMore(false);
    }
  };

  const filtering = Boolean(actor || actorQuery || action || from || to);
  const inputClass =
    "w-full min-h-[38px] rounded-lg border border-gray-200  bg-white  px-2 text-sm font-medium text-txt ";

  return (
    <div className="min-h-screen bg-surface  pb-10">
      <TopBar title="Nhật ký" onBack={onBack} />

      <div className="px-5 pt-1">
        <p className="text-sm text-txt-secondary  mb-3">
          Mọi thao tác quản trị được ghi lại tự động và không thể sửa hay xoá.
        </p>

        <div className="bg-white  rounded-2xl p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] mb-3 space-y-2.5">
          <label className="block text-sm font-bold text-txt-secondary ">
            Người thực hiện
            <span className="mt-1 flex items-center gap-2 rounded-lg border border-gray-200  px-2">
              <Search size={16} className="text-gray-400 " />
              <input
                value={actor}
                onChange={(e) => setActor(e.target.value)}
                placeholder="Email..."
                className="flex-1 min-h-[36px] text-sm font-medium outline-none bg-transparent text-txt "
              />
            </span>
          </label>
          <label className="block text-sm font-bold text-txt-secondary ">
            Hành động
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className={`mt-1 ${inputClass}`}
            >
              <option value="">Tất cả</option>
              {ACTION_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block text-sm font-bold text-txt-secondary ">
              Từ ngày
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className={`mt-1 ${inputClass}`}
              />
            </label>
            <label className="block text-sm font-bold text-txt-secondary ">
              Đến ngày
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className={`mt-1 ${inputClass}`}
              />
            </label>
          </div>
          {filtering && (
            <button
              type="button"
              onClick={() => {
                setActor("");
                setActorQuery("");
                setAction("");
                setFrom("");
                setTo("");
              }}
              className="text-sm font-bold text-accent"
            >
              Xoá bộ lọc
            </button>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="bg-red-50 text-red-700 rounded-xl p-3 text-sm font-medium mb-3"
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center pt-16">
            <Loader2 size={24} className="animate-spin text-accent" />
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white  rounded-2xl p-6 text-center text-sm text-txt-secondary ">
            {filtering
              ? "Không có thao tác nào khớp bộ lọc"
              : "Chưa có thao tác nào"}
          </div>
        ) : (
          <>
            <ul aria-label="Nhật ký thao tác" className="space-y-2">
              {rows.map((row) => {
                const changes = auditChanges(row);
                const target = row.target_type
                  ? (AUDIT_TARGET_LABELS[row.target_type] ?? row.target_type)
                  : null;
                return (
                  <li
                    key={row.id}
                    className="bg-white  rounded-2xl p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[14px] font-bold">
                        {auditActionLabel(row.action)}
                      </p>
                      <time
                        dateTime={row.created_at}
                        className="shrink-0 text-sm text-txt-secondary "
                      >
                        {formatTime(row.created_at)}
                      </time>
                    </div>
                    <p className="mt-0.5 text-sm text-txt-secondary  break-all">
                      {row.actor_email ||
                        (row.actor_id
                          ? row.actor_id.slice(0, 8)
                          : "Hệ thống / SQL")}
                      {row.actor_role &&
                        ` · ${roleLabels[row.actor_role] ?? row.actor_role}`}
                    </p>
                    {target && (
                      <p className="mt-0.5 text-sm text-txt-secondary  break-all">
                        {target}
                        {row.target_id && `: ${row.target_id}`}
                      </p>
                    )}
                    {changes.length > 0 && (
                      <ul className="mt-2 space-y-0.5 rounded-lg bg-gray-50  px-2.5 py-2 font-mono text-sm text-txt ">
                        {changes.map((line, i) => (
                          <li key={i} className="break-all">
                            {line}
                          </li>
                        ))}
                      </ul>
                    )}
                    {row.reason && (
                      <p className="mt-1.5 text-sm italic">
                        Lý do: {row.reason}
                      </p>
                    )}
                    <p className="mt-1.5 text-sm text-txt-secondary ">
                      {SOURCE_LABELS[row.source] ?? row.source}
                      {row.ip && ` · IP ${row.ip}`}
                    </p>
                  </li>
                );
              })}
            </ul>
            {hasMore && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="mt-3 w-full min-h-[44px] rounded-xl bg-white  text-sm font-bold text-accent disabled:opacity-60"
              >
                {loadingMore ? "Đang tải..." : "Tải thêm"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
