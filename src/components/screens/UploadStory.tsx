"use client";

import { useState } from "react";
import {
  Upload, FileText, Loader2, Sparkles, AlertCircle, Wand2,
} from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import { useData } from "@/lib/data-context";
import {
  createBlankStory,
  createStoryPage,
  setStoryPageCount,
} from "@/lib/db";
import { extractTextFromFile, isSupportedStoryFile } from "@/lib/file-parser";
import type { Screen } from "@/lib/types";

interface UploadStoryProps {
  onBack: () => void;
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

// Split raw text into reasonable story pages (~paragraph or ~400 chars).
function splitIntoPages(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pages: string[] = [];
  let buffer = "";
  for (const para of paragraphs) {
    if ((buffer + "\n\n" + para).length > 500 && buffer) {
      pages.push(buffer.trim());
      buffer = para;
    } else {
      buffer = buffer ? `${buffer}\n\n${para}` : para;
    }
  }
  if (buffer.trim()) pages.push(buffer.trim());
  return pages.length ? pages : [text.trim()];
}

const categories = [
  { id: "fairy_tale", label: "Cổ tích" },
  { id: "adventure", label: "Phiêu lưu" },
  { id: "bedtime", label: "Ru ngủ" },
  { id: "animal", label: "Động vật" },
  { id: "educational", label: "Học chơi" },
  { id: "custom", label: "Khác" },
];

export default function UploadStory({ onBack, onNavigate }: UploadStoryProps) {
  const { refreshStories } = useData();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("fairy_tale");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pageCount = text.trim() ? splitIntoPages(text).length : 0;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (!isSupportedStoryFile(file)) {
      setError("Định dạng không hỗ trợ. Dùng .txt, .docx hoặc .pdf");
      return;
    }
    setParsing(true);
    try {
      const content = await extractTextFromFile(file);
      if (!content.trim()) {
        setError("Không trích xuất được nội dung từ tệp này.");
        return;
      }
      setText(content);
      setFileName(file.name);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đọc tệp thất bại");
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    if (!title.trim() || !text.trim()) {
      setError("Nhập tiêu đề và nội dung truyện");
      return;
    }
    setProcessing(true);
    setError(null);
    try {
      const pages = splitIntoPages(text);
      const storyId = await createBlankStory({
        title: title.trim(),
        category,
        source: "upload",
      });
      for (let i = 0; i < pages.length; i++) {
        await createStoryPage(storyId, i + 1, pages[i]);
      }
      await setStoryPageCount(storyId, pages.length);
      await refreshStories();
      onNavigate("editor", { storyId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nhập truyện thất bại");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface pb-10">
      <TopBar title="Tải Truyện Lên" onBack={onBack} />

      <div className="px-5 pt-2">
        <p className="text-[13px] text-txt-secondary mb-4">
          Dán nội dung hoặc tải tệp .txt / .docx / .pdf — hệ thống tự chia trang để bạn chỉnh sửa & minh hoạ.
        </p>

        <label className="text-[13px] font-bold text-txt mb-2 block">Tiêu đề</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="VD: Sự tích bánh chưng bánh dày"
          className="w-full px-4 py-3.5 rounded-xl border-[1.5px] border-gray-200 bg-white text-[15px] font-semibold text-txt outline-none focus:border-accent transition-colors mb-4"
        />

        <label className="text-[13px] font-bold text-txt mb-2 block">Thể loại</label>
        <div className="flex flex-wrap gap-2 mb-4">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`px-3.5 py-2 rounded-xl text-[13px] font-semibold border-[1.5px] transition-colors ${
                category === c.id
                  ? "border-accent bg-orange-50 text-accent"
                  : "border-gray-200 bg-white text-txt-secondary"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <label className="text-[13px] font-bold text-txt mb-2 block">Nội dung</label>
        <label className="w-full mb-3 p-4 rounded-2xl border-2 border-dashed border-gray-300 flex items-center justify-center gap-2 text-[13px] font-bold text-txt-secondary cursor-pointer active:scale-[0.99] transition-transform">
          {parsing ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Đang đọc tệp...
            </>
          ) : (
            <>
              <Upload size={16} />
              {fileName ? fileName : "Chọn tệp .txt, .docx hoặc .pdf"}
            </>
          )}
          <input
            type="file"
            accept=".txt,text/plain,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,application/pdf"
            onChange={handleFile}
            disabled={parsing}
            className="hidden"
          />
        </label>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="...hoặc dán toàn bộ nội dung truyện vào đây"
          className="w-full px-4 py-3.5 rounded-xl border-[1.5px] border-gray-200 bg-white text-[14px] text-txt outline-none focus:border-accent transition-colors resize-none h-44 mb-2"
        />

        {pageCount > 0 && (
          <p className="text-[12px] text-txt-secondary mb-4 flex items-center gap-1.5">
            <FileText size={13} /> Sẽ chia thành{" "}
            <span className="font-bold text-accent">{pageCount} trang</span>
          </p>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2">
            <AlertCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
            <p className="text-[13px] text-red-700">{error}</p>
          </div>
        )}

        <button
          onClick={handleImport}
          disabled={processing}
          className="w-full py-[16px] rounded-[14px] bg-gradient-to-r from-accent to-pink-500 text-white font-bold text-[15px] flex items-center justify-center gap-2 shadow-lg shadow-accent/30 active:scale-[0.98] transition-transform disabled:opacity-60"
        >
          {processing ? (
            <>
              <Loader2 size={18} className="animate-spin" /> Đang nhập...
            </>
          ) : (
            <>
              <Wand2 size={18} /> Nhập & Soạn truyện
            </>
          )}
        </button>

        <button
          onClick={() => onNavigate("create")}
          className="w-full mt-2.5 py-3 text-[13px] font-bold text-accent flex items-center justify-center gap-1.5"
        >
          <Sparkles size={14} /> Hoặc để AI tự viết truyện mới
        </button>
      </div>
    </div>
  );
}
