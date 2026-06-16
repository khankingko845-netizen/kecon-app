"use client";

import { useState, useRef, useCallback } from "react";
import { ChevronRight, Sparkles, Mic, BookOpen, Shield, Star } from "lucide-react";

interface OnboardingProps {
  onGetStarted: () => void;
  onLogin: () => void;
}

const steps = [
  {
    icon: <Sparkles size={40} />,
    title: "Chào mừng đến KểCon!",
    subtitle: "Nền tảng kể chuyện AI cho gia đình Việt",
    description: "Tạo câu chuyện cá nhân hóa cho bé yêu với giọng đọc của chính bạn",
    gradient: "from-amber-400 via-orange-400 to-rose-400",
    iconBg: "from-amber-200 to-orange-200",
    emoji: "🎉",
    particles: ["✨", "⭐", "💫", "🌟"],
  },
  {
    icon: <Mic size={40} />,
    title: "Clone giọng nói",
    subtitle: "Giọng đọc của ba mẹ, ông bà",
    description: "Ghi âm 30 giây → AI clone giọng nói. Bé được nghe truyện bằng giọng người thân yêu nhất",
    gradient: "from-blue-400 via-cyan-400 to-teal-400",
    iconBg: "from-blue-200 to-cyan-200",
    emoji: "🎤",
    particles: ["🎵", "🎶", "🎤", "🔊"],
  },
  {
    icon: <BookOpen size={40} />,
    title: "Tạo truyện bằng AI",
    subtitle: "Vô vàn câu chuyện sáng tạo",
    description: "Mô tả → AI viết truyện + minh họa + đọc bằng giọng bạn chọn. Có chuyên gia trẻ em hỗ trợ",
    gradient: "from-emerald-400 via-green-400 to-teal-400",
    iconBg: "from-emerald-200 to-green-200",
    emoji: "✍️",
    particles: ["📖", "📚", "✏️", "🦋"],
  },
  {
    icon: <Shield size={40} />,
    title: "An toàn cho bé",
    subtitle: "Kiểm soát hoàn toàn",
    description: "Giới hạn thời gian, giờ ngủ, chặn nội dung. COPPA/GDPR — dữ liệu bé luôn an toàn",
    gradient: "from-violet-400 via-purple-400 to-fuchsia-400",
    iconBg: "from-violet-200 to-purple-200",
    emoji: "🛡️",
    particles: ["🔒", "🛡️", "💜", "✅"],
  },
  {
    icon: <Star size={40} />,
    title: "Sẵn sàng rồi!",
    subtitle: "Hãy bắt đầu hành trình",
    description: "Clone giọng đọc đầu tiên hoặc tạo ngay câu chuyện AI cho bé nào!",
    gradient: "from-yellow-400 via-amber-400 to-orange-400",
    iconBg: "from-yellow-200 to-amber-200",
    emoji: "⭐",
    particles: ["🎉", "🚀", "🌈", "⭐"],
  },
];

export default function Onboarding({ onGetStarted, onLogin }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [animating, setAnimating] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const current = steps[step];
  const isLast = step === steps.length - 1;

  const transition = useCallback((newStep: number) => {
    if (animating) return;
    setDirection(newStep > step ? "next" : "prev");
    setAnimating(true);
    setTimeout(() => {
      setStep(newStep);
      setAnimating(false);
    }, 250);
  }, [step, animating]);

  const handleNext = () => {
    if (isLast) onGetStarted();
    else transition(step + 1);
  };

  // Swipe support
  const touchRef = useRef({ x: 0, y: 0 });
  const onTouchStart = (e: React.TouchEvent) => {
    touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchRef.current.x;
    const dy = e.changedTouches[0].clientY - touchRef.current.y;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0 && step < steps.length - 1) transition(step + 1);
      if (dx > 0 && step > 0) transition(step - 1);
    }
  };

  return (
    <div
      className={`min-h-screen bg-gradient-to-b ${current.gradient} flex flex-col overflow-hidden transition-all duration-500`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Floating particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {current.particles.map((p, i) => (
          <div
            key={`${step}-${i}`}
            className="absolute text-2xl opacity-20 animate-[float_6s_ease-in-out_infinite]"
            style={{
              left: `${15 + i * 22}%`,
              top: `${10 + (i % 3) * 20}%`,
              animationDelay: `${i * 1.5}s`,
              animationDuration: `${5 + i}s`,
            }}
          >
            {p}
          </div>
        ))}
      </div>

      {/* Skip button */}
      <div className="px-5 pt-14 flex justify-end relative z-10">
        <button
          onClick={onGetStarted}
          className="text-[13px] text-white/70 font-semibold px-3 py-1.5 rounded-full bg-white dark:bg-white/[0.04]/10 backdrop-blur-sm"
        >
          Bỏ qua
        </button>
      </div>

      {/* Content */}
      <div
        ref={contentRef}
        className={`flex-1 flex flex-col items-center justify-center px-8 -mt-8 relative z-10 transition-all duration-250 ${
          animating
            ? direction === "next"
              ? "opacity-0 translate-x-8"
              : "opacity-0 -translate-x-8"
            : "opacity-100 translate-x-0"
        }`}
      >
        {/* Icon container */}
        <div className={`w-32 h-32 rounded-[36px] bg-gradient-to-br ${current.iconBg} flex items-center justify-center mb-8 shadow-2xl shadow-black/10 text-gray-800 dark:text-white/80`}>
          <div className="animate-[scaleIn_0.5s_ease]">
            {current.icon}
          </div>
        </div>

        <div className="text-center">
          <h1 className="text-[26px] font-black text-white tracking-tight mb-1 drop-shadow-sm">
            {current.title} {current.emoji}
          </h1>
          <p className="text-[15px] font-bold text-white/80 mb-3">
            {current.subtitle}
          </p>
          <p className="text-[14px] text-white/60 leading-relaxed max-w-xs mx-auto">
            {current.description}
          </p>
        </div>
      </div>

      {/* Bottom */}
      <div className="px-8 pb-12 relative z-10">
        {/* Dots */}
        <div className="flex justify-center gap-2 mb-6">
          {steps.map((_, i) => (
            <button
              key={i}
              onClick={() => transition(i)}
              className={`h-2.5 rounded-full transition-all duration-300 ${
                i === step ? "w-8 bg-white dark:bg-white/[0.04]" : "w-2.5 bg-white dark:bg-white/[0.04]/30"
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        {isLast ? (
          <div className="space-y-2.5">
            <button
              onClick={onGetStarted}
              className="w-full py-4 rounded-2xl bg-white dark:bg-white/[0.04] text-gray-900 dark:text-white/90 text-[15px] font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-xl"
            >
              <Sparkles size={18} /> Bắt Đầu Ngay
            </button>
            <button
              onClick={onLogin}
              className="w-full py-4 rounded-2xl bg-white dark:bg-white/[0.04]/15 backdrop-blur-sm text-white text-[15px] font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform border border-white/20"
            >
              Đã có tài khoản? Đăng nhập
            </button>
          </div>
        ) : (
          <button
            onClick={handleNext}
            className="w-full py-4 rounded-2xl bg-white dark:bg-white/[0.04] text-gray-900 dark:text-white/90 text-[15px] font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-xl"
          >
            Tiếp tục <ChevronRight size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
