"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Upload, Wand2 } from "@/components/ui/icons";
import { AdminDrawer } from "@/components/admin/AdminUi";
import StoryThumb from "@/components/ui/StoryThumb";
import { useToast } from "@/components/ui/Toast";
import { getStoryPages, type StoryRow } from "@/lib/db";
import { SCENE_IDS, SCENE_LABEL, type SceneId } from "@/lib/scene-library";
import { safeCoverUrl, sceneThumbUrl } from "@/lib/story-thumb";

/**
 * PR #49 — "Ảnh bìa" drawer for one platform story: page picture, built-in
 * scene, upload (JPG/PNG/WebP ≤ 5 MB), automatic, or topic icon only.
 */
type Choice =
  | { type: "auto" }
  | { type: "icon" }
  | { type: "scene"; scene: SceneId }
  | { type: "page"; page: number };
type Patch = Pick<
  StoryRow,
  | "id"
  | "cover_image_url"
  | "thumbnail_source"
  | "thumbnail_path"
  | "thumbnail_scene"
>;

export default function StoryCoverDrawer({
  story,
  onClose,
  onSaved,
}: {
  story: StoryRow | null;
  onClose: () => void;
  onSaved: (patch: Patch) => void;
}) {
  return (
    <AdminDrawer
      title={story ? `Ảnh bìa · ${story.title}` : "Ảnh bìa"}
      open={Boolean(story)}
      onClose={onClose}
    >
      {story && <CoverPanel key={story.id} story={story} onSaved={onSaved} />}
    </AdminDrawer>
  );
}

function CoverPanel({
  story,
  onSaved,
}: {
  story: StoryRow;
  onSaved: (patch: Patch) => void;
}) {
  const { toast } = useToast();
  const [pages, setPages] = useState<
    { page_number: number; illustration_url: string }[] | null
  >(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const storyId = story.id;

  useEffect(() => {
    let alive = true;
    getStoryPages(storyId)
      .then((rows) => {
        if (!alive) return;
        setPages(
          rows
            .filter((p) => safeCoverUrl(p.illustration_url))
            .map((p) => ({
              page_number: p.page_number,
              illustration_url: p.illustration_url as string,
            })),
        );
      })
      .catch(() => alive && setPages([]));
    return () => {
      alive = false;
    };
  }, [storyId]);

  const trimmed = reason.trim();
  const reasonInvalid =
    trimmed.length > 0 && (trimmed.length < 10 || trimmed.length > 500);

  const finish = async (label: string, res: Response) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Error(body.error || "Không đổi được ảnh bìa");
    onSaved(body.story as Patch);
    toast("success", `Đã đổi ảnh bìa: ${label}.`);
  };

  const choose = async (choice: Choice, label: string) => {
    if (reasonInvalid) return;
    setBusy(label);
    setError("");
    try {
      const res = await fetch("/api/admin/story-cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyId: story.id,
          choice,
          ...(trimmed ? { reason: trimmed } : {}),
        }),
      });
      await finish(label, res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đổi được ảnh bìa");
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file || reasonInvalid) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Ảnh bìa cần nhỏ hơn hoặc bằng 5 MB.");
      return;
    }
    setBusy("upload");
    setError("");
    try {
      const form = new FormData();
      form.set("storyId", story.id);
      form.set("file", file);
      if (trimmed) form.set("reason", trimmed);
      await finish(
        "ảnh tải lên",
        await fetch("/api/admin/story-cover", { method: "POST", body: form }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được ảnh bìa");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const platform = Boolean(story.is_platform_content);
  const disabled = busy !== null || reasonInvalid || !platform;
  const tile =
    "group relative overflow-hidden rounded-xl border-2 text-left disabled:opacity-60";
  return (
    <div className="space-y-5 p-5">
      <div className="flex items-center gap-4">
        <StoryThumb
          story={story}
          category={story.category}
          iconSize={56}
          className="h-[120px] w-[180px] rounded-xl"
          eager
        />
        <p className="text-sm text-txt-secondary">
          Đang dùng:{" "}
          <b className="text-ink">{sourceLabel(story.thumbnail_source)}</b>. Thư
          viện hiện ảnh nhỏ 3:2 dựng từ lựa chọn này.
        </p>
      </div>
      {!platform && (
        <p
          role="note"
          className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
        >
          Truyện gia đình là riêng tư — ảnh bìa do gia đình quản lý, quản trị
          không đổi được.
        </p>
      )}
      <div>
        <label
          htmlFor="cover-reason"
          className="mb-1.5 block text-sm font-bold text-txt-secondary"
        >
          Lý do (không bắt buộc, 10–500 ký tự — ghi vào nhật ký)
        </label>
        <input
          id="cover-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          aria-invalid={reasonInvalid}
          className="w-full rounded-xl border border-gray-200 bg-surface px-3.5 py-3 text-sm outline-none focus:border-accent"
          placeholder="Ví dụ: Dùng tranh trang 3 rõ nhân vật hơn"
        />
        {reasonInvalid && (
          <p className="mt-1 text-sm text-red-800">
            Lý do cần 10–500 ký tự, hoặc để trống.
          </p>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="admin-button"
          disabled={disabled}
          onClick={() => void choose({ type: "auto" }, "tự động")}
        >
          {busy === "tự động" ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Wand2 size={16} />
          )}{" "}
          Tự động
        </button>
        <button
          type="button"
          className="admin-button"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
        >
          {busy === "upload" ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Upload size={16} />
          )}{" "}
          Tải ảnh lên…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label="Chọn ảnh bìa (JPG, PNG, WebP, tối đa 5 MB)"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        <button
          type="button"
          className="admin-button"
          disabled={disabled}
          onClick={() => void choose({ type: "icon" }, "biểu tượng chủ đề")}
        >
          Chỉ biểu tượng
        </button>
      </div>
      <section aria-labelledby="cover-pages">
        <h3 id="cover-pages" className="mb-2 text-sm font-bold text-ink">
          Tranh các trang
        </h3>
        {pages === null ? (
          <p className="flex items-center gap-2 text-sm text-txt-secondary">
            <Loader2 size={14} className="animate-spin" /> Đang tải…
          </p>
        ) : pages.length === 0 ? (
          <p className="text-sm text-txt-secondary">
            Truyện chưa có tranh minh hoạ.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-2">
            {pages.map((p) => (
              <li key={p.page_number}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Dùng tranh trang ${p.page_number} làm ảnh bìa`}
                  onClick={() =>
                    void choose(
                      { type: "page", page: p.page_number },
                      `tranh trang ${p.page_number}`,
                    )
                  }
                  className={`${tile} ${story.cover_image_url === p.illustration_url ? "border-accent" : "border-transparent"} aspect-[3/2] w-full`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.illustration_url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-xs font-bold text-white">
                    Trang {p.page_number}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="cover-scenes">
        <h3 id="cover-scenes" className="mb-2 text-sm font-bold text-ink">
          Tranh khung cảnh dựng sẵn
        </h3>
        <ul className="grid grid-cols-3 gap-2">
          {SCENE_IDS.map((id) => (
            <li key={id}>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Dùng khung cảnh ${SCENE_LABEL[id]}`}
                onClick={() =>
                  void choose(
                    { type: "scene", scene: id },
                    `khung cảnh ${SCENE_LABEL[id]}`,
                  )
                }
                className={`${tile} ${story.thumbnail_scene === id ? "border-accent" : "border-transparent"} aspect-[3/2] w-full`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={sceneThumbUrl(id)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-xs font-bold text-white">
                  {SCENE_LABEL[id]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function sourceLabel(source: StoryRow["thumbnail_source"]): string {
  switch (source) {
    case "cover":
      return "ảnh bìa";
    case "page":
      return "tranh trang";
    case "upload":
      return "ảnh tải lên";
    case "scene":
      return "tranh khung cảnh";
    case "icon":
      return "biểu tượng chủ đề";
    default:
      return "chưa có thumbnail (đang dùng ảnh bìa gốc nếu có)";
  }
}
