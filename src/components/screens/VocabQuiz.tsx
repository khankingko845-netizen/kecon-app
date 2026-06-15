"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BookOpen, CheckCircle, XCircle, Loader2, ChevronRight,
  Trophy, Star, Sparkles, ArrowLeft, Volume2,
} from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import type { Screen } from "@/lib/types";

interface VocabWord {
  word: string;
  definition: string;
  example: string;
  emoji: string;
  difficulty: "easy" | "medium" | "hard";
}

interface QuizQuestion {
  question: string;
  options: string[];
  correct: number;
  explanation: string;
  type: "content" | "vocabulary" | "moral";
}

interface VocabQuizProps {
  storyId?: string;
  storyTitle?: string;
  onBack: () => void;
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

type Phase = "loading" | "vocab" | "quiz" | "results";

export default function VocabQuiz({ storyId, storyTitle, onBack }: VocabQuizProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [vocabulary, setVocabulary] = useState<VocabWord[]>([]);
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [showExplanation, setShowExplanation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load vocabulary and quiz
  useEffect(() => {
    if (!storyId) return;
    fetch("/api/story/vocabulary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setVocabulary(data.vocabulary || []);
        setQuiz(data.quiz || []);
        setPhase("vocab");
      })
      .catch((err) => {
        setError(err.message);
        setPhase("vocab");
      });
  }, [storyId]);

  const handleAnswer = (idx: number) => {
    if (selected !== null) return;
    setSelected(idx);
    setShowExplanation(true);
    setAnswers((prev) => [...prev, idx === quiz[currentQ].correct]);
  };

  const nextQuestion = () => {
    if (currentQ < quiz.length - 1) {
      setCurrentQ((prev) => prev + 1);
      setSelected(null);
      setShowExplanation(false);
    } else {
      setPhase("results");
    }
  };

  const score = answers.filter(Boolean).length;
  const totalQ = quiz.length;

  const getStars = () => {
    const pct = totalQ > 0 ? score / totalQ : 0;
    if (pct >= 0.8) return 3;
    if (pct >= 0.6) return 2;
    if (pct >= 0.4) return 1;
    return 0;
  };

  const getMessage = () => {
    const stars = getStars();
    if (stars === 3) return "🎉 Xuất sắc! Bé giỏi lắm!";
    if (stars === 2) return "👏 Tốt lắm! Bé rất chăm chỉ!";
    if (stars === 1) return "💪 Cố gắng thêm nhé!";
    return "📚 Đọc lại truyện và thử lại nhé!";
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white">
      <TopBar
        title={phase === "vocab" ? "📚 Từ Vựng" : phase === "quiz" ? "🧩 Quiz Vui" : phase === "results" ? "🏆 Kết Quả" : "Đang tải..."}
        onBack={onBack}
      />

      <div className="px-5 pt-2 pb-10">
        {/* Loading */}
        {phase === "loading" && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 size={40} className="animate-spin text-violet-500 mb-4" />
            <p className="text-sm text-txt-secondary font-medium">
              AI đang phân tích từ vựng...
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-sm text-red-700 mb-4">
            {error}
          </div>
        )}

        {/* Vocabulary Phase */}
        {phase === "vocab" && (
          <>
            <p className="text-sm text-txt-secondary mb-4 text-center">
              Từ vựng mới trong truyện &quot;{storyTitle}&quot;
            </p>

            <div className="space-y-3 mb-6">
              {vocabulary.map((word, i) => (
                <div
                  key={i}
                  className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-2xl">{word.emoji}</span>
                    <span className="text-lg font-bold text-violet-700">{word.word}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      word.difficulty === "easy" ? "bg-green-100 text-green-700" :
                      word.difficulty === "medium" ? "bg-amber-100 text-amber-700" :
                      "bg-red-100 text-red-700"
                    }`}>
                      {word.difficulty === "easy" ? "Dễ" : word.difficulty === "medium" ? "Vừa" : "Khó"}
                    </span>
                  </div>
                  <p className="text-sm text-txt mb-1">{word.definition}</p>
                  <p className="text-xs text-txt-secondary italic">&quot;{word.example}&quot;</p>
                </div>
              ))}
            </div>

            {quiz.length > 0 && (
              <button
                onClick={() => setPhase("quiz")}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-500 to-pink-500 text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-violet-500/30 active:scale-[0.98]"
              >
                <Sparkles size={20} />
                Bắt Đầu Quiz Vui!
              </button>
            )}
          </>
        )}

        {/* Quiz Phase */}
        {phase === "quiz" && quiz.length > 0 && (
          <>
            {/* Progress */}
            <div className="flex items-center gap-2 mb-4">
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-pink-500 rounded-full transition-all"
                  style={{ width: `${((currentQ + 1) / totalQ) * 100}%` }}
                />
              </div>
              <span className="text-xs font-bold text-txt-secondary">
                {currentQ + 1}/{totalQ}
              </span>
            </div>

            {/* Question */}
            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm mb-4">
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                  quiz[currentQ].type === "content" ? "bg-blue-100 text-blue-700" :
                  quiz[currentQ].type === "vocabulary" ? "bg-violet-100 text-violet-700" :
                  "bg-amber-100 text-amber-700"
                }`}>
                  {quiz[currentQ].type === "content" ? "📖 Nội dung" :
                   quiz[currentQ].type === "vocabulary" ? "📚 Từ vựng" : "💛 Bài học"}
                </span>
              </div>
              <p className="text-base font-bold text-txt mb-4">
                {quiz[currentQ].question}
              </p>

              <div className="space-y-2.5">
                {quiz[currentQ].options.map((opt, i) => {
                  const isCorrect = i === quiz[currentQ].correct;
                  const isSelected = i === selected;
                  let bg = "bg-gray-50 border-gray-200";
                  if (selected !== null) {
                    if (isCorrect) bg = "bg-green-50 border-green-400";
                    else if (isSelected) bg = "bg-red-50 border-red-400";
                  }
                  return (
                    <button
                      key={i}
                      onClick={() => handleAnswer(i)}
                      disabled={selected !== null}
                      className={`w-full text-left p-3.5 rounded-xl border-2 ${bg} transition-all ${
                        selected === null ? "active:scale-[0.98]" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-7 h-7 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center text-xs font-bold text-gray-500 shrink-0">
                          {String.fromCharCode(65 + i)}
                        </span>
                        <span className="text-sm font-medium text-txt flex-1">{opt}</span>
                        {selected !== null && isCorrect && (
                          <CheckCircle size={20} className="text-green-500 shrink-0" />
                        )}
                        {selected !== null && isSelected && !isCorrect && (
                          <XCircle size={20} className="text-red-500 shrink-0" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Explanation */}
            {showExplanation && (
              <div className={`p-4 rounded-2xl mb-4 ${
                selected === quiz[currentQ].correct
                  ? "bg-green-50 border border-green-200"
                  : "bg-amber-50 border border-amber-200"
              }`}>
                <p className="text-sm font-bold mb-1">
                  {selected === quiz[currentQ].correct ? "🎉 Đúng rồi!" : "💪 Chưa đúng!"}
                </p>
                <p className="text-sm text-txt-secondary">{quiz[currentQ].explanation}</p>
              </div>
            )}

            {showExplanation && (
              <button
                onClick={nextQuestion}
                className="w-full py-3.5 rounded-xl bg-violet-500 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                {currentQ < totalQ - 1 ? "Câu Tiếp Theo" : "Xem Kết Quả"}
                <ChevronRight size={18} />
              </button>
            )}
          </>
        )}

        {/* Results Phase */}
        {phase === "results" && (
          <div className="flex flex-col items-center py-10">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mb-4 shadow-xl">
              <Trophy size={48} className="text-white" />
            </div>

            <h2 className="text-2xl font-bold text-txt mb-2">{getMessage()}</h2>

            <div className="flex gap-1 mb-4">
              {[1, 2, 3].map((s) => (
                <Star
                  key={s}
                  size={32}
                  className={s <= getStars() ? "text-amber-400 fill-amber-400" : "text-gray-200"}
                />
              ))}
            </div>

            <div className="bg-white rounded-2xl p-5 border border-gray-100 w-full mb-6">
              <p className="text-center text-lg font-bold text-txt">
                {score}/{totalQ} câu đúng
              </p>
              <div className="mt-3 flex gap-1.5 justify-center">
                {answers.map((correct, i) => (
                  <div
                    key={i}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                      correct ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
                    }`}
                  >
                    {correct ? "✓" : "✗"}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3 w-full">
              <button
                onClick={() => {
                  setPhase("quiz");
                  setCurrentQ(0);
                  setSelected(null);
                  setAnswers([]);
                  setShowExplanation(false);
                }}
                className="flex-1 py-3.5 rounded-xl border-2 border-violet-200 text-violet-600 font-bold text-sm active:scale-[0.98]"
              >
                Thử Lại
              </button>
              <button
                onClick={onBack}
                className="flex-1 py-3.5 rounded-xl bg-violet-500 text-white font-bold text-sm active:scale-[0.98]"
              >
                Quay Về
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
