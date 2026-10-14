"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Loader2, RefreshCw } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { useAdminConfirm } from "@/components/admin/AdminConfirm";
import type { SettingsController } from "./useAdminSettings";

/** PR #49 — card thumbnails: how they are made + coverage + bulk (re)generation. */
interface Stats {
  platform: {
    total: number;
    with_cover: number;
    missing: number;
    cover: number;
    page: number;
    upload: number;
    scene: number;
    icon: number;
  };
  family: { total: number; missing: number };
}
async function fetchStats(): Promise<{ stats: Stats | null; error: string }> {
  try {
    const r = await fetch("/api/admin/thumbnails", { cache: "no-store" });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.stats?.platform)
      return { stats: null, error: body.error || "Không tải được thống kê" };
    return { stats: body.stats as Stats, error: "" };
  } catch {
    return { stats: null, error: "Không tải được thống kê" };
  }
}
const selectClass =
  "w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-surface text-sm font-semibold outline-none focus:border-accent transition-colors appearance-none pr-10";

export default function ThumbnailSettings({
  controller,
}: {
  controller: SettingsController;
}) {
  const { settings, handleChange } = controller;
  const { toast } = useToast();
  const confirm = useAdminConfirm();
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState("");
  const [busy, setBusy] = useState<"missing" | "all" | null>(null);
  const auto = (settings["thumbnail_auto"] ?? "true") !== "false";
  const quality = Number(settings["thumbnail_quality"] || 72);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void fetchStats().then((r) => {
      if (!alive) return;
      setStats(r.stats);
      setStatsError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [tick]);

  const run = async (mode: "missing" | "all") => {
    let reason: string | undefined;
    if (mode === "all") {
      const r = await confirm({
        title: "Tạo lại thumbnail mọi truyện nền tảng?",
        description:
          "Ảnh nhỏ được dựng lại từ ảnh bìa / tranh trang 1 theo cài đặt đã lưu (giữ nguyên ảnh bìa tải lên). Có nhật ký quản trị.",
        confirmLabel: "Tạo lại",
      });
      if (!r) return;
      reason = r;
    }
    setBusy(mode);
    try {
      const r = await fetch("/api/admin/thumbnails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason ? { mode, reason } : { mode }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(body.error || "Không tạo được thumbnail");
      toast(
        body.failed ? "info" : "success",
        body.total === 0
          ? "Không còn truyện nào thiếu thumbnail."
          : `Đã tạo ${body.updated}/${body.total} thumbnail${body.failed ? ` · ${body.failed} truyện lỗi ảnh nguồn` : ""}.`,
      );
    } catch (e) {
      toast(
        "error",
        e instanceof Error ? e.message : "Không tạo được thumbnail",
      );
    } finally {
      setBusy(null);
      setTick((t) => t + 1);
    }
  };

  const p = stats?.platform;
  return (
    <section
      id="thumbnails"
      aria-labelledby="thumbnails-title"
      className="overflow-hidden rounded-xl border border-gray-200 bg-white"
    >
      <div className="px-5 mt-6 mb-2">
        <h3 id="thumbnails-title" className="text-lg font-semibold text-ink">
          Ảnh bìa &amp; thumbnail truyện
        </h3>
      </div>
      <div className="space-y-4 bg-white px-5 py-4">
        <p className="text-sm leading-relaxed text-txt-secondary">
          Thư viện và trang chủ hiện ảnh nhỏ (WebP tỉ lệ 3:2) thay cho ảnh bìa
          gốc để tải nhanh trên điện thoại. Ảnh nhỏ được dựng từ ảnh bìa → tranh
          trang 1 → tranh khung cảnh dựng sẵn. Đổi ảnh bìa từng truyện ở mục
          Quản lý truyện → “Ảnh bìa”.
        </p>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 accent-[var(--color-accent,#6C5CE7)]"
            checked={auto}
            onChange={(e) =>
              handleChange(
                "thumbnail_auto",
                e.target.checked ? "true" : "false",
              )
            }
          />
          <span>
            <span className="block text-sm font-bold text-ink">
              Tự tạo thumbnail
            </span>
            <span className="block text-sm text-txt-secondary">
              Khi truyện mới được tạo, có ảnh bìa mới, hoặc gia đình mở Thư viện
              mà truyện chưa có ảnh nhỏ.
            </span>
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label
              htmlFor="thumbnail-fallback"
              className="mb-1.5 block text-sm font-bold text-txt-secondary"
            >
              Khi chưa có tranh
            </label>
            <div className="relative">
              <select
                id="thumbnail-fallback"
                value={settings["thumbnail_fallback"] || "scene"}
                onChange={(e) =>
                  handleChange("thumbnail_fallback", e.target.value)
                }
                className={selectClass}
              >
                <option value="scene">Tranh khung cảnh của trang 1</option>
                <option value="icon">Biểu tượng chủ đề</option>
              </select>
              <ChevronDown
                size={16}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-txt-secondary"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="thumbnail-width"
              className="mb-1.5 block text-sm font-bold text-txt-secondary"
            >
              Kích thước
            </label>
            <div className="relative">
              <select
                id="thumbnail-width"
                value={settings["thumbnail_width"] || "480"}
                onChange={(e) =>
                  handleChange("thumbnail_width", e.target.value)
                }
                className={selectClass}
              >
                <option value="360">360 × 240 — nhẹ nhất</option>
                <option value="480">480 × 320 — khuyên dùng</option>
                <option value="640">640 × 427 — nét hơn</option>
              </select>
              <ChevronDown
                size={16}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-txt-secondary"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="thumbnail-quality"
              className="mb-1.5 block text-sm font-bold text-txt-secondary"
            >
              Chất lượng WebP: {quality}
            </label>
            <input
              id="thumbnail-quality"
              type="range"
              min={60}
              max={90}
              step={1}
              value={quality}
              onChange={(e) =>
                handleChange("thumbnail_quality", e.target.value)
              }
              className="w-full accent-[var(--color-accent,#6C5CE7)]"
              aria-describedby="thumbnail-quality-hint"
            />
            <p
              id="thumbnail-quality-hint"
              className="text-sm text-txt-secondary"
            >
              60–90 · mặc định 72
            </p>
          </div>
        </div>
        <div
          className="rounded-xl border border-gray-100 bg-surface p-4"
          aria-live="polite"
        >
          <h4 className="text-sm font-bold text-ink">Độ phủ</h4>
          {statsError ? (
            <p role="alert" className="mt-1 text-sm text-red-800">
              {statsError}
            </p>
          ) : !stats || !p ? (
            <p className="mt-1 flex items-center gap-2 text-sm text-txt-secondary">
              <Loader2 size={14} className="animate-spin" /> Đang tải…
            </p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm text-ink-2">
              <li>
                Truyện nền tảng:{" "}
                <b className="text-ink">
                  {p.total - p.missing}/{p.total}
                </b>{" "}
                có thumbnail
                {p.total
                  ? ` (ảnh bìa ${p.cover}, tranh trang ${p.page}, tải lên ${p.upload}, khung cảnh ${p.scene}, biểu tượng ${p.icon})`
                  : ""}
                {p.missing ? ` · thiếu ${p.missing}` : ""}
              </li>
              <li>
                Truyện gia đình: {stats.family.total - stats.family.missing}/
                {stats.family.total} có thumbnail (phần còn lại tự tạo khi gia
                đình mở Thư viện; chỉ đếm tổng, không xem truyện riêng).
              </li>
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="admin-button"
              disabled={busy !== null}
              onClick={() => void run("missing")}
            >
              {busy === "missing" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              Tạo thumbnail còn thiếu
            </button>
            <button
              type="button"
              className="admin-button"
              disabled={busy !== null}
              onClick={() => void run("all")}
            >
              {busy === "all" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              Tạo lại tất cả…
            </button>
          </div>
          <p className="mt-2 text-sm text-txt-secondary">
            Dùng cài đặt đã lưu — bấm “Lưu Cài Đặt” trước nếu vừa đổi kích
            thước/chất lượng.
          </p>
        </div>
      </div>
    </section>
  );
}
