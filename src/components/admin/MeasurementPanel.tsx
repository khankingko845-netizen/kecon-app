"use client";
import { useEffect, useState } from "react";
import type { MeasurementSummary } from "@/lib/measurement-types";
export default function MeasurementPanel() {
  const [days, setDays] = useState(14),
    [data, setData] = useState<MeasurementSummary | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetch("/api/admin/measurement?days=" + days, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error("Không tải được đo lường T07.");
        return r.json();
      })
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [days]);
  const usd = (v: number | null) =>
    v === null ? "Chưa xác định" : "$" + Number(v).toFixed(6);
  return (
    <section
      aria-label="Đo lường first-party"
      className="mx-5 my-5 rounded-2xl border border-line bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Đo lường & chi phí AI</h2>
        <label className="text-sm">
          Khoảng ngày UTC{" "}
          <select
            className="rounded-xl border border-line p-2 ml-2"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>7 ngày</option>
            <option value={14}>14 ngày</option>
            <option value={30}>30 ngày</option>
          </select>
        </label>
      </div>
      <p className="mt-2 text-sm text-txt-secondary">
        Tài khoản, chưa phải hộ gia đình (T08). Chỉ đo từ lúc bật T07; không hồi
        điền lịch sử. Không đo khách ẩn danh. Chi phí là ước tính theo đơn giá
        đã lưu, không phải hoá đơn.
      </p>
      {loading ? (
        <p role="status" className="mt-3">
          Đang tải đo lường…
        </p>
      ) : error ? (
        <p role="alert" className="mt-3 text-red-700">
          {error}
        </p>
      ) : (
        data && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <b className="text-xl">{usd(data.totals.estimated_usd)}</b>
                <p>Ước tính đã biết · nền tảng</p>
              </div>
              <div>
                <b className="text-xl">{data.totals.unknown_cost}</b>
                <p>Lần gọi chưa xác định chi phí</p>
              </div>
              <div>
                <b>{data.totals.attempts}</b> lần gọi · {data.totals.pending}{" "}
                chưa chốt
              </div>
              <div>
                {data.totals.byo_attempts} lần dùng key riêng · không cộng vào
                chi phí nền tảng
              </div>
            </div>
            {data.totals.unknown_cost > 0 && (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                Tổng ước tính chưa đầy đủ. Có lần lỗi, usage thiếu hoặc đơn giá
                chưa cấu hình. Các lần này không được tính thành $0.
              </p>
            )}
            <h3 className="mt-5 font-bold">
              Funnel tài khoản mới trong khoảng ngày
            </h3>
            <p className="text-sm text-txt-secondary">
              Cùng cohort đăng ký; mốc Trang chủ và nghe phải xảy ra theo thứ
              tự. Nghe đầu chỉ khi trình duyệt thực sự phát audio, không phải mở
              Player/nghe thử.
            </p>
            <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                ["Đăng ký", data.funnel.signup],
                ["Vào Trang chủ", data.funnel.home_view],
                ["Nghe truyện đầu", data.funnel.first_listen],
              ].map(([label, n]) => (
                <li key={label} className="rounded-xl bg-lavender p-3">
                  <b>{n}</b> {label}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-sm">
              Tạo truyện sau khi vào Trang chủ: {data.funnel.story_created} tài
              khoản. Không bắt buộc tạo truyện trước khi nghe truyện thư viện.
            </p>
            <h3 className="mt-5 font-bold">Chi phí/ngày · UTC</h3>
            <div
              className="mt-2 overflow-x-auto rounded-xl border border-line"
              tabIndex={0}
              role="region"
              aria-label="Bảng chi phí AI"
            >
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr>
                    {[
                      "Ngày",
                      "Provider / tính năng",
                      "Lần gọi",
                      "Lỗi / chờ",
                      "Ước tính USD",
                      "Chưa xác định",
                    ].map((v) => (
                      <th key={v} className="p-3">
                        {v}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.costs.map((r) => (
                    <tr
                      key={[r.day, r.provider, r.feature].join(":")}
                      className="border-t border-line"
                    >
                      <td className="p-3">{r.day}</td>
                      <td className="p-3">
                        {r.provider}
                        <br />
                        {r.feature}
                      </td>
                      <td className="p-3">{r.attempts}</td>
                      <td className="p-3">
                        {r.failed} / {r.pending}
                      </td>
                      <td className="p-3">{usd(r.estimated_usd)}</td>
                      <td className="p-3">{r.unknown_cost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.costs.length && (
              <p className="mt-2 text-sm">
                Chưa có lần gọi AI trong khoảng ngày.
              </p>
            )}
          </>
        )
      )}
    </section>
  );
}
