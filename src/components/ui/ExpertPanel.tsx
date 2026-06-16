"use client";

import { useState } from "react";
import { Brain, Loader2, ChevronDown, ChevronUp, Star, AlertTriangle, Lightbulb, MessageSquare } from "lucide-react";
import { useSettings } from "@/lib/settings-context";

interface ExpertInfo {
  expert: {
    name: string;
    emoji: string;
    title: string;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  review: any;
  error?: string;
}

interface ExpertPanelProps {
  storyContent: string;
  storyTitle?: string;
  targetAge?: string;
  language?: string;
}

export default function ExpertPanel({ storyContent, storyTitle, targetAge, language }: ExpertPanelProps) {
  const { settings, hasStoryProvider } = useSettings();
  const [reviews, setReviews] = useState<Record<string, ExpertInfo> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedExpert, setExpandedExpert] = useState<string | null>(null);

  const requestReview = async () => {
    if (!hasStoryProvider || !storyContent.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/story/expert-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyContent,
          storyTitle,
          targetAge,
          language,
          apiKey: settings.storyApiKey || undefined,
          provider: settings.storyProvider,
          model: settings.storyModel,
          baseUrl: settings.storyBaseUrl || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Lỗi khi gọi chuyên gia");
      }
      const data = await res.json();
      setReviews(data.reviews);
      // Auto expand first expert
      const keys = Object.keys(data.reviews);
      if (keys.length > 0) setExpandedExpert(keys[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã xảy ra lỗi");
    }
    setLoading(false);
  };

  if (!hasStoryProvider) return null;

  return (
    <div className="mt-4 mb-2">
      {/* Trigger Button */}
      {!reviews && (
        <button
          onClick={requestReview}
          disabled={loading || !storyContent.trim()}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 text-[14px] font-bold text-indigo-700 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Đang phân tích với 3 chuyên gia...
            </>
          ) : (
            <>
              <Brain size={16} />
              🧠 Xin Ý Kiến Chuyên Gia AI
            </>
          )}
        </button>
      )}

      {/* Error */}
      {error && (
        <div className="mt-2 p-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {/* Results */}
      {reviews && (
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-[13px] font-black text-txt dark:text-white flex items-center gap-1.5">
              <Brain size={14} className="text-indigo-600" />
              Đánh Giá Chuyên Gia
            </h3>
            <button
              onClick={() => { setReviews(null); setExpandedExpert(null); }}
              className="text-[11px] font-bold text-indigo-600"
            >
              Đánh giá lại
            </button>
          </div>

          {Object.entries(reviews).map(([key, data]) => {
            const isExpanded = expandedExpert === key;
            const review = data.review;
            const score = review?.score;

            return (
              <div
                key={key}
                className="rounded-2xl border border-gray-100 dark:border-white/[0.06] bg-white dark:bg-white/[0.04] shadow-[0_1px_3px_rgba(0,0,0,0.03)] overflow-hidden"
              >
                {/* Header */}
                <button
                  onClick={() => setExpandedExpert(isExpanded ? null : key)}
                  className="w-full p-3 flex items-center gap-3 text-left"
                >
                  <span className="text-2xl">{data.expert.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-txt dark:text-white">{data.expert.name}</div>
                    <div className="text-[11px] text-txt-secondary dark:text-white/50">{data.expert.title}</div>
                  </div>
                  {score && (
                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-yellow-50">
                      <Star size={12} className="text-yellow-500 fill-yellow-500" />
                      <span className="text-[13px] font-black text-yellow-700">{score}/10</span>
                    </div>
                  )}
                  {isExpanded ? <ChevronUp size={16} className="text-gray-400 dark:text-white/30" /> : <ChevronDown size={16} className="text-gray-400 dark:text-white/30" />}
                </button>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="px-3 pb-3 space-y-2.5">
                    {data.error ? (
                      <p className="text-[12px] text-red-600">{data.error}</p>
                    ) : (
                      <>
                        {/* Summary */}
                        {review?.summary && (
                          <div className="p-2.5 rounded-xl bg-surface">
                            <p className="text-[12px] text-txt dark:text-white leading-relaxed">{review.summary}</p>
                          </div>
                        )}

                        {/* Strengths */}
                        {review?.strengths?.length > 0 && (
                          <div>
                            <div className="text-[11px] font-bold text-emerald-700 mb-1 flex items-center gap-1">
                              <Star size={11} /> Điểm mạnh
                            </div>
                            {review.strengths.map((s: string, i: number) => (
                              <p key={i} className="text-[12px] text-txt-secondary dark:text-white/50 ml-4 mb-0.5">• {s}</p>
                            ))}
                          </div>
                        )}

                        {/* Concerns */}
                        {review?.concerns?.length > 0 && (
                          <div>
                            <div className="text-[11px] font-bold text-amber-700 mb-1 flex items-center gap-1">
                              <AlertTriangle size={11} /> Lưu ý
                            </div>
                            {review.concerns.map((s: string, i: number) => (
                              <p key={i} className="text-[12px] text-txt-secondary dark:text-white/50 ml-4 mb-0.5">• {s}</p>
                            ))}
                          </div>
                        )}

                        {/* Suggestions */}
                        {review?.suggestions?.length > 0 && (
                          <div>
                            <div className="text-[11px] font-bold text-indigo-700 mb-1 flex items-center gap-1">
                              <Lightbulb size={11} /> Gợi ý cải thiện
                            </div>
                            {review.suggestions.map((s: string, i: number) => (
                              <p key={i} className="text-[12px] text-txt-secondary dark:text-white/50 ml-4 mb-0.5">• {s}</p>
                            ))}
                          </div>
                        )}

                        {/* Discussion Questions (educator only) */}
                        {review?.discussion_questions?.length > 0 && (
                          <div>
                            <div className="text-[11px] font-bold text-blue-700 mb-1 flex items-center gap-1">
                              <MessageSquare size={11} /> Câu hỏi cho bé
                            </div>
                            {review.discussion_questions.map((q: string, i: number) => (
                              <p key={i} className="text-[12px] text-txt-secondary dark:text-white/50 ml-4 mb-0.5">❓ {q}</p>
                            ))}
                          </div>
                        )}

                        {/* Rewrite hints (screenwriter only) */}
                        {review?.rewrite_hints?.length > 0 && (
                          <div>
                            <div className="text-[11px] font-bold text-purple-700 mb-1 flex items-center gap-1">
                              ✏️ Gợi ý viết lại
                            </div>
                            {review.rewrite_hints.map((h: string, i: number) => (
                              <p key={i} className="text-[12px] text-txt-secondary dark:text-white/50 ml-4 mb-0.5">→ {h}</p>
                            ))}
                          </div>
                        )}

                        {/* Extra fields */}
                        {review?.structure_analysis && (
                          <p className="text-[11px] text-txt-secondary dark:text-white/50 bg-surface dark:bg-white/[0.04] rounded-lg p-2">
                            📐 <b>Cấu trúc:</b> {review.structure_analysis}
                          </p>
                        )}
                        {review?.educational_value && (
                          <p className="text-[11px] text-txt-secondary dark:text-white/50 bg-surface dark:bg-white/[0.04] rounded-lg p-2">
                            🎓 <b>Giáo dục:</b> {review.educational_value}
                          </p>
                        )}
                        {review?.new_words?.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {review.new_words.map((w: string, i: number) => (
                              <span key={i} className="px-2 py-0.5 rounded-md bg-blue-50 text-[10px] font-bold text-blue-700">
                                {w}
                              </span>
                            ))}
                          </div>
                        )}
                        {review?.life_skills?.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {review.life_skills.map((s: string, i: number) => (
                              <span key={i} className="px-2 py-0.5 rounded-md bg-green-50 text-[10px] font-bold text-green-700">
                                🌱 {s}
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
