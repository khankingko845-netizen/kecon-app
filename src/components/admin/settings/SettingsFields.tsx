"use client";
import { useState } from "react";
import {
  Mic,
  Eye,
  EyeOff,
  Loader2,
  Trash2,
  Plug,
  ChevronDown,
} from "@/components/ui/icons";
import {
  secretStatusText,
  type SystemSecretStatus,
} from "@/lib/system-secrets";
import { SECRET_LABELS, type TestResult } from "./types";
export function SectionIcon({
  icon: Icon,
  color,
}: {
  icon: typeof Mic;
  color: string;
}) {
  return (
    <div
      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
      style={{ background: color, color: "#fff" }}
    >
      <Icon size={14} />
    </div>
  );
}

/**
 * A-04 · write-only API key field. The stored key never comes back to the
 * browser: the field shows its status ("Đã đặt · …abcd") and the input only
 * holds a NEW key typed by the admin (saved to Vault on "Lưu Cài Đặt").
 */
export function SecretInput({
  settingKey,
  status,
  value,
  onChange,
  placeholder,
  locked = false,
  onClear,
  clearing = false,
}: {
  settingKey: string;
  status?: SystemSecretStatus;
  /** Newly typed key (draft) — empty = keep the stored key. */
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** A-02: roles without `secrets.manage` can't read or set keys. */
  locked?: boolean;
  onClear?: () => void;
  clearing?: boolean;
}) {
  const [show, setShow] = useState(false);
  const label = SECRET_LABELS[settingKey] ?? settingKey;
  return (
    <div>
      <div className="flex gap-2">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`API key ${label}`}
          autoComplete="off"
          spellCheck={false}
          placeholder={
            locked
              ? "Chỉ Super admin / Admin đặt được key"
              : status?.is_set
                ? "Nhập key mới để thay (key hiện tại được giữ kín)"
                : placeholder
          }
          disabled={locked}
          className="flex-1 px-3.5 py-3 rounded-xl border border-gray-200  bg-surface  text-sm font-mono outline-none focus:border-accent transition-colors"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          aria-label={show ? "Ẩn key đang nhập" : "Hiện key đang nhập"}
          className="px-3 py-3 rounded-xl border border-gray-200  text-txt-secondary  hover:bg-gray-50  transition-colors"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {!locked && (
        <div
          className="flex items-center gap-2 flex-wrap mt-1.5 text-sm"
          data-testid={`secret-status-${settingKey}`}
        >
          <span
            className={
              status?.is_set
                ? "font-semibold text-emerald-800"
                : "text-txt-secondary "
            }
          >
            {secretStatusText(status)}
          </span>
          {status?.is_set && status.updated_at && (
            <span className="text-txt-secondary ">
              ·{" "}
              {new Date(status.updated_at).toLocaleString("vi-VN", {
                dateStyle: "short",
                timeStyle: "short",
              })}
              {status.updated_by_email ? ` · ${status.updated_by_email}` : ""}
            </span>
          )}
          {status?.is_set && onClear && (
            <button
              type="button"
              onClick={onClear}
              disabled={clearing}
              className="inline-flex items-center gap-1 font-semibold text-red-700 hover:underline disabled:opacity-50"
            >
              {clearing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Trash2 size={12} />
              )}
              Xoá key
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function TestButton({
  loading,
  result,
  onClick,
}: {
  loading: boolean;
  result: TestResult | null;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-gray-200  text-sm font-bold text-txt-secondary  hover:bg-gray-50  active:scale-[0.97] transition-all disabled:opacity-50"
      >
        {loading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Plug size={14} />
        )}
        Test Kết Nối
      </button>
      {result && (
        <span
          className={`text-sm font-semibold ${
            result.ok ? "text-emerald-800" : "text-red-700"
          }`}
        >
          {result.ok
            ? `✅ Kết nối thành công${
                result.models
                  ? ` · ${result.models.length} models`
                  : result.voices
                    ? ` · ${result.voices.length} voices`
                    : ""
              }`
            : `❌ ${result.error || "Kết nối thất bại"}`}
        </span>
      )}
    </div>
  );
}

export function ModelSelect({
  value,
  onChange,
  models,
  placeholder,
  allowFreeText,
}: {
  value: string;
  onChange: (v: string) => void;
  models: string[];
  placeholder: string;
  allowFreeText?: boolean;
}) {
  if (models.length === 0 && allowFreeText) {
    return (
      <input
        type="text"
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3.5 py-3 rounded-xl border border-gray-200  bg-surface  text-sm font-mono outline-none focus:border-accent transition-colors"
      />
    );
  }
  if (models.length === 0) {
    return (
      <div className="px-3.5 py-3 rounded-xl border border-gray-200  bg-gray-50  text-sm text-txt-secondary ">
        Nhấn &quot;Test Kết Nối&quot; để tải danh sách models
      </div>
    );
  }
  return (
    <div className="relative">
      <select
        aria-label="Model Mặc Định"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3.5 py-3 rounded-xl border border-gray-200  bg-surface  text-sm font-semibold outline-none focus:border-accent transition-colors appearance-none pr-10"
      >
        <option value="">— Chọn model —</option>
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-txt-secondary  pointer-events-none"
      />
    </div>
  );
}
