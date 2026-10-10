"use client";
import { useToast } from "@/components/ui/Toast";
import { useState, useEffect } from "react";
import {
  Plus,
  Trash2,
  X,
  Search,
  Loader2,
  ExternalLink,
  AlertCircle,
} from "@/components/ui/icons";
import VoicePreviewButton from "@/components/ui/VoicePreviewButton";
import { useVoicePreview, type VoicePreview } from "@/lib/use-voice-preview";
import {
  voiceMatchesLanguage,
  nativeVoiceLanguage,
  voiceLanguages,
  rankedDefaultsForLocale,
} from "@/lib/voice-selection";
import { LANGUAGES, type VoiceOption, type DefaultVoiceRow } from "./types";
export default function DefaultVoicesManager({
  availableVoices,
  defaultVoices,
  onAdd,
  onRemove,
  onReorder,
  onToggle,
  loading,
}: {
  availableVoices: VoiceOption[];
  defaultVoices: DefaultVoiceRow[];
  onAdd: (voice: {
    voice_id: string;
    name: string;
    language: string;
    gender?: string;
    public_owner_id?: string;
    languageConfirmed?: boolean;
  }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onReorder: (language: string, ids: string[]) => Promise<void>;
  onToggle: (id: string, active: boolean) => Promise<void>;
  loading: boolean;
}) {
  const [addingForLang, setAddingForLang] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [manualVoiceId, setManualVoiceId] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualConfirmed, setManualConfirmed] = useState(false);
  const [manualLanguages, setManualLanguages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<VoiceOption[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogWarnings, setCatalogWarnings] = useState<string[]>([]);
  const { toast } = useToast();
  const [managerError, setManagerError] = useState<string | null>(null);
  const [ordering, setOrdering] = useState<string | null>(null);
  const [showUnknown, setShowUnknown] = useState(false);
  const [showVerified, setShowVerified] = useState(false);
  const [catalogPage, setCatalogPage] = useState(0);
  useEffect(() => {
    setCatalogPage(0);
    setSearchQuery("");
    setCatalogue([]);
  }, [addingForLang]);
  const [hasMore, setHasMore] = useState(false);
  const preview = useVoicePreview(addingForLang || "vi");
  const { stop } = preview;
  useEffect(() => {
    stop();
  }, [addingForLang, stop]);
  const [toggling, setToggling] = useState<string | null>(null);
  async function toggleVoice(id: string, active: boolean) {
    setToggling(id);
    setManagerError(null);
    preview.stop();
    try {
      await onToggle(id, active);
    } catch (e) {
      setManagerError(
        e instanceof Error ? e.message : "Chưa đổi được trạng thái giọng.",
      );
    } finally {
      setToggling(null);
    }
  }
  useEffect(() => {
    if (!addingForLang || manualMode) return;
    const abort = new AbortController();
    const timer = setTimeout(
      () => {
        setCatalogLoading(true);
        setManagerError(null);
        const params = new URLSearchParams({
          language: addingForLang,
          search: searchQuery.trim(),
          page: String(catalogPage),
        });
        fetch(`/api/admin/voice-catalog?${params}`, { signal: abort.signal })
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || "Chưa tải được giọng.");
            if (!abort.signal.aborted) {
              setCatalogue((prev) =>
                catalogPage
                  ? Array.from(
                      new Map(
                        [...prev, ...(d.voices ?? [])].map((v) => [
                          v.voice_id,
                          v,
                        ]),
                      ).values(),
                    )
                  : (d.voices ?? []),
              );
              setCatalogWarnings(d.warnings ?? []);
              setHasMore(!!d.hasMore);
            }
          })
          .catch((e) => {
            if (!abort.signal.aborted) setManagerError(e.message);
          })
          .finally(() => {
            if (!abort.signal.aborted) setCatalogLoading(false);
          });
      },
      searchQuery ? 350 : 0,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [addingForLang, searchQuery, catalogPage, manualMode]);
  async function moveVoice(language: string, id: string, direction: number) {
    const list = rankedDefaultsForLocale(defaultVoices, language);
    const from = list.findIndex((v) => v.id === id);
    const to = from + direction;
    if (to < 0 || to >= list.length) return;
    [list[from], list[to]] = [list[to], list[from]];
    setOrdering(language);
    setManagerError(null);
    try {
      await onReorder(
        language,
        list.map((v) => v.id),
      );
    } catch (e) {
      toast("error", "Thao tác giọng chưa thành công. Xem lỗi và thử lại.");
      setManagerError(e instanceof Error ? e.message : "Chưa sắp xếp được.");
    } finally {
      setOrdering(null);
    }
  }

  // Auto-lookup voice info when user enters a voice_id
  async function handleLookupVoice() {
    const id = manualVoiceId.trim();
    if (!id) return;
    setLookingUp(true);
    setLookupError(null);
    try {
      const res = await fetch(
        `/api/admin/test-provider?voice_id=${encodeURIComponent(id)}`,
      );
      const data = await res.json();
      if (data.ok && data.voice) {
        setManualName(data.voice.name || "");
        setManualLanguages(voiceLanguages(data.voice));
        // Could auto-detect language from voice info too
      } else {
        setLookupError(data.error || "Không tìm thấy voice");
      }
    } catch {
      setLookupError("Lỗi kết nối");
    } finally {
      setLookingUp(false);
    }
  }

  async function handleAddVoice(v: VoiceOption, lang: string) {
    setSubmitting(true);
    try {
      await onAdd({
        voice_id: v.voice_id,
        name: v.name,
        language: lang,
        public_owner_id: v.source === "library" ? v.public_owner_id : undefined,
        languageConfirmed: showVerified || showUnknown,
      });
      preview.stop();
      setAddingForLang(null);
      setSearchQuery("");
    } catch (e) {
      toast("error", "Thao tác giọng chưa thành công. Xem lỗi và thử lại.");
      setManagerError(e instanceof Error ? e.message : "Chưa thêm được giọng.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddManual(lang: string) {
    if (!manualVoiceId.trim() || !manualName.trim()) return;
    setSubmitting(true);
    try {
      await onAdd({
        voice_id: manualVoiceId.trim(),
        name: manualName.trim(),
        language: lang,
        languageConfirmed: manualConfirmed,
      });
      preview.stop();
      setAddingForLang(null);
      setManualVoiceId("");
      setManualName("");
      setManualMode(false);
    } catch (e) {
      toast("error", "Thao tác giọng chưa thành công. Xem lỗi và thử lại.");
      setManagerError(e instanceof Error ? e.message : "Chưa thêm được giọng.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    try {
      await onRemove(id);
    } catch (e) {
      toast("error", "Thao tác giọng chưa thành công. Xem lỗi và thử lại.");
      setManagerError(e instanceof Error ? e.message : "Chưa xoá được giọng.");
    } finally {
      setRemovingId(null);
    }
  }

  // Filter available voices for the add modal
  const filteredVoices = catalogue.filter(
    (v) =>
      !searchQuery ||
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.voice_id.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const matches = filteredVoices.filter(
    (v) =>
      nativeVoiceLanguage(v) === (addingForLang ?? "vi") ||
      (showVerified && voiceMatchesLanguage(v, addingForLang ?? "vi")),
  );
  const libraryForLang = matches.filter((v) => v.source === "library");
  const ownCloned = matches.filter(
    (v) =>
      v.source === "own" && ["cloned", "professional"].includes(v.category),
  );
  const ownPremade = matches.filter(
    (v) =>
      v.source === "own" && !["cloned", "professional"].includes(v.category),
  );
  const unknownVoices = showUnknown
    ? filteredVoices.filter((v) => voiceLanguages(v).length === 0)
    : [];

  return (
    <div className="space-y-4 pt-1">
      <p className="text-sm font-bold text-txt-secondary  uppercase tracking-widest">
        Giọng mặc định cho người dùng
      </p>
      <p className="text-sm text-txt-secondary  -mt-2 leading-relaxed">
        Tự chọn giọng: clone bố mẹ/ông bà trước, rồi danh sách theo thứ tự bên
        dưới. Kết nối key không tự gán giọng mặc định; bấm Thêm giọng để chọn
        cho từng ngôn ngữ.
      </p>

      {managerError && (
        <p role="alert" className="text-[14px] text-red-700 ">
          {managerError}
        </p>
      )}
      {preview.error && !addingForLang && (
        <p role="alert" className="text-[14px] text-red-700 ">
          {preview.error}
        </p>
      )}
      <p className="text-[14px] text-ink-2 ">
        Nghe thử dùng câu mẫu theo ngôn ngữ và hạn mức TTS. Tắt giọng không xoá
        giọng hoặc thứ tự đã lưu.
      </p>
      {LANGUAGES.map((lang) => {
        const activeForLang = rankedDefaultsForLocale(defaultVoices, lang.code);
        const voicesForLang = [
          ...activeForLang,
          ...defaultVoices
            .filter((v) => v.language === lang.code && !v.is_active)
            .sort((a, b) => a.sort_order - b.sort_order),
        ];

        return (
          <div
            key={lang.code}
            className="rounded-xl border border-gray-200  overflow-hidden"
          >
            {/* Language header */}
            <div className="flex items-center justify-between px-3.5 py-2.5 bg-gray-50 ">
              <span className="text-sm font-bold">{lang.label}</span>
              <span className="text-sm text-txt-secondary  font-semibold">
                {activeForLang.length} bật ·{" "}
                {voicesForLang.length - activeForLang.length} tắt
              </span>
            </div>

            {/* Voice list */}
            {voicesForLang.length > 0 ? (
              <div className="divide-y divide-gray-100 ">
                {voicesForLang.map((v, index) => (
                  <div
                    key={v.id}
                    className="flex flex-wrap items-center gap-2 px-3.5 py-2.5"
                  >
                    <div className="w-full min-w-0">
                      <p className="text-[14px] font-semibold truncate">
                        {v.is_active ? `${index + 1}. ` : "Đã tắt · "}
                        {v.name}
                      </p>
                      <p className="text-sm text-txt-secondary  font-mono truncate">
                        {v.voice_id}
                      </p>
                    </div>
                    <VoicePreviewButton
                      preview={preview}
                      voiceId={v.voice_id}
                      name={v.name}
                      language={lang.code}
                    />
                    <button
                      type="button"
                      role="switch"
                      aria-label={`Bật giọng: ${v.name}`}
                      aria-checked={v.is_active}
                      disabled={
                        !!toggling || !!ordering || !!removingId || submitting
                      }
                      onClick={() => toggleVoice(v.id, !v.is_active)}
                      className="min-h-11 rounded-xl border border-gray-200 px-3 text-[14px] font-bold text-ink   disabled:opacity-50"
                    >
                      {toggling === v.id
                        ? "Đang lưu…"
                        : v.is_active
                          ? "Bật"
                          : "Tắt"}
                    </button>
                    <button
                      type="button"
                      aria-label={`Ưu tiên lên: ${v.name}`}
                      disabled={
                        !v.is_active ||
                        index === 0 ||
                        !!ordering ||
                        !!toggling ||
                        !!removingId ||
                        submitting
                      }
                      onClick={() => moveVoice(lang.code, v.id, -1)}
                      className="min-h-11 min-w-11 rounded-xl text-brand disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Ưu tiên xuống: ${v.name}`}
                      disabled={
                        !v.is_active ||
                        index === activeForLang.length - 1 ||
                        !!ordering ||
                        !!toggling ||
                        !!removingId ||
                        submitting
                      }
                      onClick={() => moveVoice(lang.code, v.id, 1)}
                      className="min-h-11 min-w-11 rounded-xl text-brand disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`Xoá giọng: ${v.name}`}
                      onClick={() => handleRemove(v.id)}
                      disabled={!!removingId || !!ordering || submitting}
                      className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-50"
                    >
                      {removingId === v.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-3.5 py-3 text-sm text-txt-secondary  italic">
                Chưa có giọng mặc định nào
              </div>
            )}

            {/* Add button */}
            <div className="px-3.5 py-2.5 border-t border-gray-100 ">
              <button
                type="button"
                aria-label={`Thêm giọng ${lang.code}`}
                onClick={() => {
                  setCatalogue(availableVoices);
                  setCatalogLoading(true);
                  setCatalogWarnings([]);
                  setManagerError(null);
                  setAddingForLang(lang.code);
                  setSearchQuery("");
                  setManualMode(false);
                }}
                disabled={loading}
                className="inline-flex items-center gap-1.5 text-accent text-sm font-bold hover:underline disabled:opacity-50"
              >
                <Plus size={13} />
                Thêm giọng
              </button>
            </div>
          </div>
        );
      })}

      {/* ─── Add Voice Modal ─── */}
      {addingForLang && (
        <div
          onKeyDown={(e) => {
            if (e.key === "Escape" && !submitting) {
              preview.stop();
              setAddingForLang(null);
              return;
            }
            if (e.key !== "Tab") return;
            const nodes = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(
                "button:not(:disabled), input:not(:disabled), a[href]",
              ),
            );
            const first = nodes[0],
              last = nodes.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Chọn giọng theo ngôn ngữ"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
        >
          <div className="bg-white   w-full max-w-md max-h-[80vh] rounded-t-2xl sm:rounded-2xl flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h4 className="text-[15px] font-bold">
                Thêm giọng ·{" "}
                {LANGUAGES.find((l) => l.code === addingForLang)?.label}
              </h4>
              <button
                type="button"
                onClick={() => setAddingForLang(null)}
                aria-label="Đóng chọn giọng"
                className="p-1.5 rounded-lg hover:bg-gray-100  transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Search / Manual toggle */}
            <div className="px-4 py-3 border-b space-y-2">
              {!manualMode ? (
                <>
                  <div className="relative">
                    <Search
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 "
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setCatalogPage(0);
                      }}
                      aria-label="Tìm giọng theo tên hoặc ID"
                      placeholder="Tìm voice theo tên hoặc ID..."
                      className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-gray-200  text-sm outline-none focus:border-accent transition-colors"
                      autoFocus
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setManualMode(true)}
                    className="text-sm text-accent  font-semibold"
                  >
                    Nhập voice_id thủ công →
                  </button>
                  {/^[A-Za-z0-9]{20}$/.test(searchQuery.trim()) && (
                    <button
                      type="button"
                      onClick={() => {
                        setManualVoiceId(searchQuery.trim());
                        setManualName("");
                        setManualMode(true);
                      }}
                      className="min-h-11 px-3 rounded-xl border border-current text-accent  text-sm"
                    >
                      Tra cứu chính xác ID này
                    </button>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={manualVoiceId}
                      onChange={(e) => {
                        setManualVoiceId(e.target.value);
                        setManualName("");
                        setManualLanguages([]);
                        setManualConfirmed(false);
                        setLookupError(null);
                      }}
                      aria-label="Voice ID"
                      placeholder="Voice ID (vd: pNInz6obpgDQGcFmaJgB hoặc fish:<id>)"
                      className="flex-1 px-3.5 py-2.5 rounded-xl border border-gray-200  text-sm font-mono outline-none focus:border-accent transition-colors"
                      autoFocus
                    />
                    <button
                      type="button"
                      aria-label="Tra cứu Voice ID"
                      onClick={handleLookupVoice}
                      disabled={lookingUp || !manualVoiceId.trim()}
                      className="px-3 py-2.5 rounded-xl border border-gray-200  text-accent  text-sm font-bold hover:bg-accent/5 disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      {lookingUp ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Search size={14} />
                      )}
                    </button>
                  </div>
                  {manualVoiceId.trim() && (
                    <VoicePreviewButton
                      preview={preview}
                      voiceId={manualVoiceId.trim()}
                      name={manualName.trim() || manualVoiceId.trim()}
                      language={addingForLang}
                    />
                  )}
                  <p className="text-sm text-txt-secondary ">
                    Ngôn ngữ từ provider:{" "}
                    {manualLanguages.join(", ") || "chưa xác định"}. ID không
                    khả dụng: thêm vào My Voices của tài khoản có key trước.
                  </p>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={manualConfirmed}
                      onChange={(e) => setManualConfirmed(e.target.checked)}
                    />{" "}
                    Tôi đã nghe thử và xác nhận giọng phù hợp ngôn ngữ này
                  </label>
                  {lookupError && (
                    <p className="text-sm text-red-700  font-medium flex items-center gap-1">
                      <AlertCircle size={11} /> {lookupError}
                    </p>
                  )}
                  <input
                    type="text"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    aria-label="Tên giọng"
                    placeholder={
                      lookingUp
                        ? "Đang tìm..."
                        : "Tên hiển thị (nhập ID rồi nhấn 🔍)"
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200  text-sm outline-none focus:border-accent transition-colors"
                  />
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setManualMode(false);
                        setLookupError(null);
                      }}
                      className="text-sm text-accent  font-semibold"
                    >
                      ← Chọn từ danh sách
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddManual(addingForLang)}
                      disabled={
                        submitting ||
                        !manualVoiceId.trim() ||
                        !manualName.trim()
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white   text-sm font-bold disabled:opacity-50"
                    >
                      {submitting ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Plus size={12} />
                      )}
                      Thêm
                    </button>
                  </div>
                  <a
                    href={`https://elevenlabs.io/community?language=${addingForLang}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-accent  text-sm font-semibold"
                  >
                    Tìm voice trên ElevenLabs <ExternalLink size={11} />
                  </a>
                </div>
              )}
            </div>

            {preview.error && (
              <p role="alert" className="px-4 py-2 text-[14px] text-red-700 ">
                {preview.error}
              </p>
            )}
            {catalogLoading && (
              <p role="status" className="px-4 py-3 text-[14px]">
                Đang tải giọng theo ngôn ngữ…
              </p>
            )}
            {catalogWarnings.map((w) => (
              <p
                key={w}
                role="status"
                className="px-4 py-2 text-[14px] text-amber-800 "
              >
                {w}
              </p>
            ))}
            {managerError && (
              <p role="alert" className="px-4 py-2 text-[14px] text-red-700 ">
                {managerError}
              </p>
            )}
            {!manualMode && (
              <p className="px-4 py-2 text-sm text-txt-secondary ">
                Mặc định chỉ hiện giọng bản ngữ. Giọng được kiểm chứng thêm ngôn
                ngữ có thể vẫn mang giọng nước ngoài; nên nghe thử trước.
              </p>
            )}
            {!manualMode && (
              <label className="flex min-h-11 items-center gap-2 px-4 text-[14px]">
                <input
                  type="checkbox"
                  checked={showVerified}
                  onChange={(e) => setShowVerified(e.target.checked)}
                />{" "}
                Hiện giọng được kiểm chứng thêm ngôn ngữ này
              </label>
            )}
            {!manualMode && (
              <label className="flex min-h-11 items-center gap-2 px-4 text-[14px]">
                <input
                  type="checkbox"
                  checked={showUnknown}
                  onChange={(e) => setShowUnknown(e.target.checked)}
                />{" "}
                Hiện giọng chưa có nhãn ngôn ngữ
              </label>
            )}
            {/* Voice list (scrollable) */}
            {!manualMode && (
              <div className="flex-1 overflow-y-auto divide-y divide-gray-100 ">
                {hasMore && (
                  <button
                    type="button"
                    onClick={() => setCatalogPage((p) => p + 1)}
                    disabled={catalogLoading}
                    className="m-4 min-h-11 px-4 rounded-xl border border-current text-accent "
                  >
                    Tải thêm giọng
                  </button>
                )}
                {/* Library voices for this language */}
                {libraryForLang.length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-amber-50 text-sm font-bold text-amber-700 uppercase tracking-wider sticky top-0">
                      ⭐ Thư viện ·{" "}
                      {LANGUAGES.find((l) => l.code === addingForLang)?.label}
                    </div>
                    {libraryForLang.map((v) => (
                      <VoiceRow
                        key={v.voice_id}
                        voice={v}
                        preview={preview}
                        language={addingForLang}
                        onAdd={() => handleAddVoice(v, addingForLang)}
                        submitting={submitting}
                        alreadyAdded={defaultVoices.some(
                          (d) =>
                            d.voice_id === v.voice_id &&
                            d.language === addingForLang,
                        )}
                      />
                    ))}
                  </div>
                )}

                {/* User's cloned voices */}
                {ownCloned.length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-purple-50 text-sm font-bold text-purple-700 uppercase tracking-wider sticky top-0">
                      🎙️ Voice clone
                    </div>
                    {ownCloned.map((v) => (
                      <VoiceRow
                        key={v.voice_id}
                        voice={v}
                        preview={preview}
                        language={addingForLang}
                        onAdd={() => handleAddVoice(v, addingForLang)}
                        submitting={submitting}
                        alreadyAdded={defaultVoices.some(
                          (d) =>
                            d.voice_id === v.voice_id &&
                            d.language === addingForLang,
                        )}
                      />
                    ))}
                  </div>
                )}

                {/* Premade voices */}
                {ownPremade.length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-gray-50  text-sm font-bold text-gray-500  uppercase tracking-wider sticky top-0">
                      🌐 Giọng trong tài khoản
                    </div>
                    {ownPremade.map((v) => (
                      <VoiceRow
                        key={v.voice_id}
                        voice={v}
                        preview={preview}
                        language={addingForLang}
                        onAdd={() => handleAddVoice(v, addingForLang)}
                        submitting={submitting}
                        alreadyAdded={defaultVoices.some(
                          (d) =>
                            d.voice_id === v.voice_id &&
                            d.language === addingForLang,
                        )}
                      />
                    ))}
                  </div>
                )}

                {unknownVoices.length > 0 && (
                  <div>
                    <p className="px-4 py-2 text-[14px] text-ink-2 ">
                      Chưa có nhãn ngôn ngữ — hãy thử giọng trước khi gán.
                    </p>
                    {unknownVoices.map((v) => (
                      <VoiceRow
                        key={v.voice_id}
                        voice={v}
                        preview={preview}
                        language={addingForLang}
                        onAdd={() => handleAddVoice(v, addingForLang)}
                        submitting={submitting}
                        alreadyAdded={defaultVoices.some(
                          (d) =>
                            d.voice_id === v.voice_id &&
                            d.language === addingForLang,
                        )}
                      />
                    ))}
                  </div>
                )}
                {matches.length + unknownVoices.length === 0 &&
                  !catalogLoading && (
                    <div className="px-4 py-8 text-center text-sm text-txt-secondary ">
                      Không có giọng khớp bộ lọc. ID ngoài danh sách: dùng “Nhập
                      voice_id thủ công” để tra cứu với các key đã lưu.
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function VoiceRow({
  voice,
  preview,
  language,
  onAdd,
  submitting,
  alreadyAdded,
}: {
  voice: VoiceOption;
  preview: VoicePreview;
  language: string;
  onAdd: () => void;
  submitting: boolean;
  alreadyAdded: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50   transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{voice.name}</p>
        <p className="text-sm text-txt-secondary ">
          {voice.category} · Bản ngữ:{" "}
          {LANGUAGES.find((l) => l.code === nativeVoiceLanguage(voice))
            ?.label ||
            nativeVoiceLanguage(voice) ||
            "chưa xác định"}
          {nativeVoiceLanguage(voice) !== language &&
            voiceMatchesLanguage(voice, language) && (
              <span>
                {" "}
                · Kiểm chứng thêm{" "}
                {LANGUAGES.find((l) => l.code === language)?.label}
              </span>
            )}
        </p>
      </div>
      <VoicePreviewButton
        preview={preview}
        voiceId={voice.voice_id}
        name={voice.name}
        language={language}
        compact
      />
      {alreadyAdded ? (
        <span className="text-sm text-emerald-800 font-semibold">
          ✓ Đã thêm
        </span>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          disabled={submitting}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent/10 text-accent    text-sm font-bold hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Plus size={11} />
          )}
          Thêm
        </button>
      )}
    </div>
  );
}

/* ──────────────── main component ──────────────── */
