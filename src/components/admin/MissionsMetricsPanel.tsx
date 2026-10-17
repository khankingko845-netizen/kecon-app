"use client";
/**
 * G-10 · "Bầu trời của Đóm" weekly metrics + guardrails for the team
 * (docs/g10-missions-metrics.md). Aggregates only — no family, child or story.
 */
import { useEffect, useState } from "react";
import type { MissionsMetrics, MissionsWeek } from "@/lib/missions-metrics-types";

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const weekLabel = (w: MissionsWeek) => `${dm(w.week_start)}–${dm(w.week_end)}${w.partial ? " (đang chạy)" : ""}`;
const viNumber = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
/** Vietnamese decimals ("2,5"), "—" when the metric is missing. */
const num = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? "—" : `${viNumber.format(v)}${suffix}`);

export default function MissionsMetricsPanel() {
  const [weeks, setWeeks] = useState(8),
    [state, setState] = useState<{ weeks: number; data?: MissionsMetrics; error?: string } | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/admin/missions-metrics?weeks=" + weeks, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error("Không tải được số liệu Bầu trời của Đóm.");
        return (await r.json()) as MissionsMetrics;
      })
      .then((data) => {
        if (active) setState({ weeks, data });
      })
      .catch((e: Error) => {
        if (active) setState({ weeks, error: e.message });
      });
    return () => {
      active = false;
    };
  }, [weeks]);
  const loading = state?.weeks !== weeks;
  const data = loading ? null : (state?.data ?? null);
  const error = loading ? "" : (state?.error ?? "");

  // Headline: the last full week (the current one is still running).
  const full = data?.weeks.find((w) => !w.partial) ?? data?.weeks[0];
  return (
    <section aria-label="Số liệu Bầu trời của Đóm" className="mx-5 my-5 rounded-2xl border border-line bg-white p-4" data-testid="missions-metrics">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Bầu trời của Đóm · số liệu tuần</h2>
        <label className="text-sm">
          Số tuần
          <select className="ml-2 min-h-11 rounded-xl border border-line p-2" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            <option value={4}>4 tuần</option>
            <option value={8}>8 tuần</option>
            <option value={12}>12 tuần</option>
          </select>
        </label>
      </div>
      <p className="mt-2 text-sm text-txt-secondary">
        Tuần theo giờ Việt Nam, bắt đầu thứ Hai. Chỉ tính tài khoản gia đình (không tính nhân viên và tài khoản thử @kecon.test), theo tài
        khoản cho tới T10. Chỉ có số tổng hợp, không hiện từng gia đình; dưới {data?.min_families ?? 5} gia đình thì ẩn phân bố số tối.
      </p>
      {loading ? (
        <p role="status" className="mt-3">Đang tải số liệu…</p>
      ) : error ? (
        <p role="alert" className="mt-3 text-red-700">{error}</p>
      ) : (
        data &&
        full && (
          <>
            <h3 className="mt-4 font-bold">Tuần {weekLabel(full)}</h3>
            <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Gia đình có nghe", `${full.families_listening} / ${data.families_total}`],
                ["Số tối trung bình", num(full.avg_nights)],
                ["Nghe hết / bắt đầu", num(full.listening.finish_rate, "%")],
                ["Đọc cùng đạt 3/3", String(full.family_reads.reached_target)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-lavender p-3">
                  <dt className="text-sm">{label}</dt>
                  <dd className="text-xl font-bold">{value}</dd>
                </div>
              ))}
            </dl>
            <h3 className="mt-4 font-bold">Số gia đình theo số tối nghe hết truyện</h3>
            {full.nights_histogram ? (
              <ol aria-label="Số gia đình theo số tối trong tuần" className="mt-2 grid grid-cols-7 gap-1 text-center">
                {(Object.entries(full.nights_histogram) as [string, number][]).map(([k, v]) => (
                  <li key={k} className="rounded-lg bg-surface px-0.5 py-2">
                    <b className="block text-base">{v}</b>
                    <span className="block whitespace-nowrap text-xs">{k} tối</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-1 text-sm">Ẩn vì tuần này có dưới {data.min_families} gia đình nghe — số nhỏ dễ đoán ra từng nhà.</p>
            )}

            <h3 className="mt-5 font-bold">Vòng lặp theo tuần</h3>
            <div className="mt-2 overflow-x-auto rounded-xl border border-line" tabIndex={0} role="region" aria-label="Bảng vòng lặp theo tuần">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr>
                    {["Tuần", "Gia đình nghe", "Tối TB", "Bắt đầu → nghe hết", "Nhiệm vụ nghe", "Thói quen (nhà)", "Cảm ơn việc tốt", "Đọc cùng (đạt 3/3)"].map((v) => (
                      <th key={v} scope="col" className="p-3">{v}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.weeks.map((w) => (
                    <tr key={w.week_start} className="border-t border-line">
                      <th scope="row" className="p-3 font-semibold">{weekLabel(w)}</th>
                      <td className="p-3">{w.families_listening}</td>
                      <td className="p-3">{num(w.avg_nights)}</td>
                      <td className="p-3">
                        {w.listening.started} → {w.listening.finished} ({num(w.listening.finish_rate, "%")}){w.listening.exact ? "" : " *"}
                      </td>
                      <td className="p-3">{w.missions_done}</td>
                      <td className="p-3">{w.habits.confirmed} ({w.habits.families})</td>
                      <td className="p-3">{w.kindness.thanked}</td>
                      <td className="p-3">{w.family_reads.reads} ({w.family_reads.reached_target})</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="mt-5 font-bold">Giới hạn an toàn</h3>
            <p className="text-sm text-txt-secondary">
              Mong đợi thấp và ổn định. “Nghe quá nhanh”: bấm xong truyện sớm hơn thời gian đọc tối thiểu (không được sao). “Trong giờ ngủ”: theo giờ
              ngủ hiện tại bố mẹ đặt, giờ Việt Nam. Phút/tối là ước tính từ lúc bấm nghe tới lúc nghe xong, tối đa 60 phút mỗi truyện.
            </p>
            <div className="mt-2 overflow-x-auto rounded-xl border border-line" tabIndex={0} role="region" aria-label="Bảng giới hạn an toàn theo tuần">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr>
                    {["Tuần", "Nghe quá nhanh", "Hết hạn", "Trong giờ ngủ", "Tối ≥ 3 truyện", "Phút / tối", "Nhắc: gửi / lỗi / bỏ qua", "Tắt nhắc"].map((v) => (
                      <th key={v} scope="col" className="p-3">{v}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.weeks.map((w) => (
                    <tr key={w.week_start} className="border-t border-line">
                      <th scope="row" className="p-3 font-semibold">{weekLabel(w)}</th>
                      <td className="p-3">{w.listening.too_fast === null ? "chưa đo" : w.listening.too_fast}</td>
                      <td className="p-3">{w.listening.expired}</td>
                      <td className="p-3">{w.guardrails.bedtime_sessions}</td>
                      <td className="p-3">{w.guardrails.nights_3plus} / {w.guardrails.family_nights}</td>
                      <td className="p-3">{num(w.guardrails.avg_minutes_per_night)}</td>
                      <td className="p-3">{w.reminders.sent} / {w.reminders.failed} / {w.reminders.skipped}</td>
                      <td className="p-3">{w.reminders.turned_off}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm">
              Đang bật nhắc bố mẹ: {data.reminders_on} gia đình.
              {data.weeks.some((w) => !w.listening.exact) &&
                " * Tuần trước khi bật đo (migration 038): số “bắt đầu” lấy từ dữ liệu còn lại, phiên chưa xong đã bị dọn sau 7 ngày nên tỉ lệ nghe hết có thể cao hơn thực tế."}
            </p>
            <p className="mt-1 text-sm text-txt-secondary">
              Chưa đo được: phút dùng app/ngày và ngày vượt giới hạn (đếm trên máy của bé, không gửi lên máy chủ).
            </p>
          </>
        )
      )}
    </section>
  );
}
