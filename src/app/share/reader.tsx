"use client";
import { useEffect, useState } from "react";
import { SharedStoryText, shareToken } from "@/lib/story-links";
import type { z } from "zod";
export default function SharedStoryReader() {
  const [story, setStory] = useState<z.infer<typeof SharedStoryText> | null>(
    null,
  );
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    const token = shareToken.safeParse(window.location.hash.slice(1));
    if (!token.success) {
      queueMicrotask(() => {
        if (!abort.signal.aborted)
          setError("Link không hợp lệ. Bố mẹ hãy gửi link mới.");
      });
      return () => abort.abort();
    }
    void fetch("/api/share/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token.data }),
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        const parsed = SharedStoryText.safeParse(data);
        if (!r.ok || !parsed.success) throw new Error();
        if (!abort.signal.aborted) setStory(parsed.data);
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError("Link không khả dụng, đã hết hạn hoặc được thu hồi.");
      });
    return () => abort.abort();
  }, []);
  return (
    <main className="mx-auto min-h-screen max-w-[650px] bg-cream px-6 py-8 text-ink">
      <p className="mb-4 text-sm text-ink-2">
        KểCon · Bản đọc chữ của truyện nền tảng công khai. Chưa chia sẻ audio
        hoặc giọng gia đình.
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : story ? (
        <>
          <h1 className="font-display text-3xl font-bold">
            {story.story.title}
          </h1>
          {story.story.description && (
            <p className="mt-3">{story.story.description}</p>
          )}
          {story.pages.map((p) => (
            <section
              key={p.page_number}
              className="mt-6 rounded-2xl bg-white p-5"
            >
              <h2 className="text-sm text-ink-2">Trang {p.page_number}</h2>
              <p className="mt-3 whitespace-pre-wrap text-lg leading-relaxed">
                {p.content}
              </p>
            </section>
          ))}
        </>
      ) : (
        <p role="status">Đang mở truyện…</p>
      )}
    </main>
  );
}
