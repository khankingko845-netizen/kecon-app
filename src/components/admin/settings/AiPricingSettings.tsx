"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
export default function AiPricingSettings() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let live = true;
    void createClient()
      .rpc("has_permission", { p_permission: "settings.write" })
      .then(({ data }) => {
        if (live) setAllowed(Boolean(data));
      });
    return () => {
      live = false;
    };
  }, []);
  const [provider, setProvider] = useState("openai"),
    [kind, setKind] = useState("llm"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const f = new FormData(e.currentTarget);
    try {
      const db = createClient();
      const { data: allowed } = await db.rpc("has_permission", {
        p_permission: "settings.write",
      });
      if (!allowed) throw Error("Bạn không có quyền sửa đơn giá.");
      const r = await fetch("/api/admin/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          kind,
          model: String(f.get("model")),
          input: kind === "llm" ? Number(f.get("input")) : null,
          output: kind === "llm" ? Number(f.get("output")) : null,
          unit: kind !== "llm" ? Number(f.get("unit")) : null,
          source: String(f.get("source")),
        }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      setMessage(
        "Đã lưu đơn giá. Chỉ áp dụng cho lần gọi mới; lịch sử giữ snapshot cũ.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Không lưu được đơn giá");
    } finally {
      setBusy(false);
    }
  }
  const field = (name: string, label: string, type = "number") => (
    <label className="block text-sm">
      {label}
      <input
        name={name}
        type={type}
        required
        min={type === "number" ? 0 : undefined}
        max={type === "number" ? 1e6 : undefined}
        step={type === "number" ? "any" : undefined}
        className="mt-1 block w-full rounded-xl border border-line p-3"
      />
    </label>
  );
  if (!allowed) return null;
  return (
    <section
      id="ai-pricing"
      className="mx-5 my-5 rounded-2xl border border-line bg-white p-4"
    >
      <h2 className="text-lg font-bold">Đơn giá ước tính AI · T07</h2>
      <p className="mt-2 text-sm text-txt-secondary">
        Chỉ nhân sự có quyền Cài đặt được lưu. Kiểm tra giá theo tài khoản/hợp
        đồng của bạn; không có đơn giá mặc định suy đoán. USD/1M token cho LLM;
        USD mỗi ảnh, ký tự TTS, lần clone hoặc giây âm nền. Key riêng được tách
        khỏi chi phí nền tảng. Không nhập API key hay thông tin riêng.
      </p>
      <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
        <label>
          Provider
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="ml-2 rounded-xl border border-line p-2"
          >
            {[
              "openai",
              "gemini",
              "anthropic",
              "custom",
              "elevenlabs",
              "fishaudio",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Loại
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="ml-2 rounded-xl border border-line p-2"
          >
            {["llm", "image", "tts", "clone", "ambient"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        {field(
          "model",
          "Mã model chính xác (ảnh: dall-e-3.standard.1024x1024)",
          "text",
        )}
        {field("source", "Nguồn giá HTTPS (không query/fragment)", "url")}
        {kind === "llm" ? (
          <>
            {field("input", "USD / 1M input token")}
            {field("output", "USD / 1M output token")}
          </>
        ) : (
          field("unit", "USD / đơn vị")
        )}
        <button
          disabled={busy}
          className="rounded-xl bg-accent p-3 font-bold text-white"
        >
          {busy ? "Đang lưu…" : "Lưu đơn giá"}
        </button>
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </form>
    </section>
  );
}
