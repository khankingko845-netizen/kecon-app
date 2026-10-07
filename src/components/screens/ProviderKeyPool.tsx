"use client";

/**
 * Admin v2 · A-04b — kho nhiều API key cho một nhà cung cấp giọng nói.
 *
 * Write-only like A-04: a key is typed once, stored in Vault, and from then on
 * only its label, last 4 chars, status, credit and usage are shown. The server
 * rotates the keys (least busy / least recently used first) and skips keys that
 * run out of credit or fail, filling in with the next one (src/lib/key-pool.ts).
 */
import { useAdminConfirm } from "@/components/admin/AdminConfirm";
import { useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  Key,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "@/components/ui/icons";
import {
  addProviderKey,
  checkProviderKeys,
  deleteProviderKey,
  updateProviderKey,
} from "@/lib/db";
import {
  providerCreditText,
  providerKeyStatusText,
  VOICE_PROVIDER_INFO,
  type ProviderKeyRow,
  type VoiceProvider,
} from "@/lib/provider-keys";

const TONE_CLASS = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  error: "bg-red-50 text-red-600 border-red-200",
  off: "bg-gray-100 text-gray-500 border-gray-200",
} as const;

const fmt = (n: number) => n.toLocaleString("vi-VN");
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : null;

function errorText(err: unknown, fallback: string): string {
  if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return fallback;
}

export default function ProviderKeyPool({
  provider,
  rows,
  onChanged,
  locked = false,
}: {
  provider: VoiceProvider;
  /** This provider's rows of list_provider_keys(). */
  rows: ProviderKeyRow[];
  /** Reload the list after a change. */
  onChanged: () => Promise<void> | void;
  /** No `secrets.manage` → nothing to show or change. */
  locked?: boolean;
}) {
  const confirm = useAdminConfirm();
  const info = VOICE_PROVIDER_INFO[provider];
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // "add" | "all" | key id
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (locked) {
    return (
      <p className="text-sm text-txt-secondary ">
        Chỉ Super admin / Admin xem và đặt được key {info.label}.
      </p>
    );
  }

  const active = rows.filter((r) => r.enabled && r.status === "active").length;

  async function act(tag: string, fn: () => Promise<void>, fallback: string) {
    setBusy(tag);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      setBusy(null);
      await onChanged();
    }
  }

  async function handleAdd() {
    const value = newKey.trim();
    if (!value) {
      setError("Nhập API key trước");
      return;
    }
    await act(
      "add",
      async () => {
        const added = await addProviderKey(
          provider,
          value,
          newLabel.trim() || undefined,
        );
        setNewKey("");
        setNewLabel("");
        setShow(false);
        const [result] = await checkProviderKeys({ id: added.id }).catch(
          () => [],
        );
        setNotice(
          `Đã thêm key …${added.last4 ?? "????"}` +
            (result
              ? result.ok
                ? " · kiểm tra OK"
                : ` · ${result.error ?? "chưa kiểm tra được"}`
              : ""),
        );
      },
      "Thêm key thất bại",
    );
  }

  return (
    <div data-testid={`key-pool-${provider}`} className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-bold text-txt-secondary ">
          Kho API key · {rows.length} key · {active} đang dùng
        </p>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={() =>
              act(
                "all",
                async () => void (await checkProviderKeys({ provider })),
                "Kiểm tra thất bại",
              )
            }
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200  text-sm font-bold text-txt-secondary  hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === "all" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            Kiểm tra tất cả
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-txt-secondary  leading-relaxed">
          Chưa có key nào. Thêm một hay nhiều key bên dưới (máy chủ vẫn dùng
          biến môi trường {info.envVar} nếu có).
        </p>
      ) : (
        <ul aria-label={`Kho key ${info.label}`} className="space-y-2">
          {rows.map((row) => {
            const status = providerKeyStatusText(row);
            const credit = providerCreditText(row.credit);
            const lastUsed = when(row.last_used_at);
            return (
              <li
                key={row.id}
                data-testid={`pool-key-${row.id}`}
                className="rounded-xl border border-gray-200  px-3 py-2.5 text-sm"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Key size={13} className="text-txt-secondary" />
                  <span className="font-bold text-sm">
                    {row.label || `Key …${row.last4 ?? "????"}`}
                  </span>
                  <code className="font-mono text-txt-secondary ">
                    …{row.last4 ?? "????"}
                  </code>
                  <span
                    className={`px-2 py-0.5 rounded-full border font-semibold ${TONE_CLASS[status.tone]}`}
                  >
                    {status.text}
                  </span>
                </div>
                <p className="mt-1 text-txt-secondary ">
                  {[
                    credit,
                    `${fmt(row.use_count)} lượt · ${fmt(row.char_count)} ký tự`,
                    lastUsed ? `dùng lần cuối ${lastUsed}` : "chưa dùng",
                    row.created_by_email
                      ? `thêm bởi ${row.created_by_email}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {row.last_error && (
                  <p className="mt-1 text-red-700 break-words">
                    Lỗi gần nhất: {row.last_error}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-3 flex-wrap font-semibold">
                  <button
                    type="button"
                    onClick={() =>
                      act(
                        row.id,
                        async () =>
                          void (await checkProviderKeys({ id: row.id })),
                        "Kiểm tra thất bại",
                      )
                    }
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1 text-accent hover:underline disabled:opacity-50"
                  >
                    {busy === row.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Check size={12} />
                    )}
                    Kiểm tra
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      act(
                        row.id,
                        () =>
                          updateProviderKey(row.id, {
                            enabled:
                              !row.enabled || row.status !== "active"
                                ? true
                                : false,
                          }),
                        "Đổi trạng thái thất bại",
                      )
                    }
                    disabled={busy !== null}
                    className="text-txt-secondary  hover:underline disabled:opacity-50"
                  >
                    {!row.enabled
                      ? "Bật"
                      : row.status !== "active"
                        ? "Bật lại"
                        : "Tắt"}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const reason = await confirm({
                        title: `Xoá key ${info.label} …${row.last4 ?? "????"}?`,
                        description:
                          "Giọng nhân bản trong tài khoản này có thể không đọc được nữa. Không thể xem lại key đã xoá.",
                        confirmLabel: "Xoá key",
                      });
                      if (!reason) return;
                      void act(
                        row.id,
                        () => deleteProviderKey(row.id, reason),
                        "Xoá key thất bại",
                      );
                    }}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1 text-red-700 hover:underline disabled:opacity-50"
                  >
                    <Trash2 size={12} />
                    Xoá
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="rounded-xl bg-surface  p-3 space-y-2">
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            maxLength={60}
            aria-label={`Tên key ${info.label} mới`}
            placeholder="Tên gợi nhớ (VD: Tài khoản 2)"
            className="flex-1 min-w-[140px] px-3 py-2.5 rounded-xl border border-gray-200  bg-white  text-sm outline-none focus:border-accent"
          />
        </div>
        <div className="flex gap-2">
          <input
            type={show ? "text" : "password"}
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAdd();
            }}
            aria-label={`API key ${info.label} mới`}
            autoComplete="off"
            spellCheck={false}
            placeholder={info.placeholder}
            className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-gray-200  bg-white  text-sm font-mono outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            aria-label={show ? "Ẩn key đang nhập" : "Hiện key đang nhập"}
            className="shrink-0 px-3 rounded-xl border border-gray-200  text-txt-secondary"
          >
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={busy !== null}
            className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 px-3.5 rounded-xl bg-accent text-white text-sm font-bold disabled:opacity-50"
          >
            {busy === "add" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            Thêm key
          </button>
        </div>
        <a
          href={info.keysUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-accent text-sm font-semibold"
        >
          Lấy API key {info.label} <ExternalLink size={12} />
        </a>
      </div>

      {notice && (
        <p role="status" className="text-sm font-semibold text-emerald-800">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold text-red-700">
          {error}
        </p>
      )}
      <p className="text-sm text-txt-secondary  leading-relaxed">
        Máy chủ xoay vòng các key: request chia đều cho key đang rảnh; key hết
        credit hoặc lỗi được tự bỏ qua và bù bằng key kế tiếp. Key đã lưu được
        mã hoá, chỉ hiện 4 ký tự cuối. Giọng nhân bản chỉ nằm trong tài khoản đã
        tạo nó.
      </p>
    </div>
  );
}
