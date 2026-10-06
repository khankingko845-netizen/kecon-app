"use client";

import { useState, useRef, useCallback } from "react";
import { ChevronRight, Sparkles, ShieldCheck, Lock, Mic, BookOpen } from "@/components/ui/icons";
import Mascot, { type MascotState } from "@/components/ui/Mascot";

interface OnboardingProps {
 onGetStarted: () => void;
 onLogin: () => void;
}

/**
 * Onboarding v2 (UI-07): Đóm dẫn đường qua 5 bước, nền kem ấm, chữ ink,
 * CTA cam. Tiêu đề h1 + nhãn nút được E2E smoke test sử dụng — giữ nguyên.
 */
const steps: {
 mascot: MascotState;
 title: string;
 subtitle: string;
 description: string;
 /** Soft backdrop blob colour behind Đóm. */
 halo: string;
}[] = [
 {
 mascot: "hello",
 title: "Chào mừng đến KểCon!",
 subtitle: "Mình là Đóm — bạn kể chuyện của bé",
 description: "Truyện cá nhân hoá cho bé yêu, đọc bằng chính giọng của ba mẹ",
 halo: "from-glow-soft to-[#FFE2CC]",
 },
 {
 mascot: "listen",
 title: "Clone giọng nói",
 subtitle: "Giọng đọc của ba mẹ, ông bà",
 description: "Ghi âm khoảng 30 giây, Đóm học giọng — bé được nghe truyện bằng giọng người thân yêu nhất",
 halo: "from-brand-soft to-[#DDEBFF]",
 },
 {
 mascot: "story",
 title: "Tạo truyện bằng AI",
 subtitle: "Mỗi tối một câu chuyện mới",
 description: "Kể cho Đóm vài ý, Đóm viết truyện, vẽ minh hoạ và đọc bằng giọng bạn chọn",
 halo: "from-success-soft to-glow-soft",
 },
 {
 mascot: "happy",
 title: "An toàn cho bé",
 subtitle: "Ba mẹ kiểm soát hoàn toàn",
 description: "Giới hạn thời gian, giờ ngủ, lọc nội dung theo độ tuổi. Không quảng cáo, dữ liệu của bé luôn được bảo vệ",
 halo: "from-brand-soft to-success-soft",
 },
 {
 mascot: "celebrate",
 title: "Sẵn sàng rồi!",
 subtitle: "Cùng Đóm bắt đầu hành trình",
 description: "Tạo câu chuyện đầu tiên hoặc ghi âm giọng đọc cho bé ngay nào!",
 halo: "from-glow-soft to-[#FFD9C2]",
 },
];

const TRUST_CHIPS = [
 { icon: ShieldCheck, label: "Không quảng cáo" },
 { icon: Lock, label: "Khoá phụ huynh" },
];

const FEATURE_CHIPS = [
 { icon: Mic, label: "Giọng ba mẹ" },
 { icon: BookOpen, label: "Truyện 3–12 tuổi" },
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
 className="relative min-h-screen bg-cream text-ink flex flex-col overflow-hidden"
 onTouchStart={onTouchStart}
 onTouchEnd={onTouchEnd}
 >
 {/* Skip button */}
 <div className="px-5 pt-14 flex items-center justify-between relative z-20">
 <span className="font-display text-[20px] font-extrabold text-brand tracking-tight">KểCon</span>
 <button
 onClick={onGetStarted}
 className="min-h-tap-min text-[14px] text-ink-2 font-bold px-4 rounded-full bg-white/70 border border-ink/5 active:scale-95 transition-transform"
 >
 Bỏ qua
 </button>
 </div>

 {/* Content */}
 <div
 ref={contentRef}
 className={`flex-1 flex flex-col items-center justify-center px-7 relative z-10 transition-all duration-250 ${
 animating
 ? direction === "next"
 ? "opacity-0 translate-x-8"
 : "opacity-0 -translate-x-8"
 : "opacity-100 translate-x-0"
 }`}
 >
 {/* Đóm on a soft halo */}
 <div className="relative mb-6 flex items-end justify-center w-[240px] h-[220px]">
 <div aria-hidden className={`absolute inset-x-2 bottom-2 top-8 rounded-[999px] bg-gradient-to-br ${current.halo} opacity-90`} />
 <Mascot key={current.mascot} state={current.mascot} size={210} priority className="relative" />
 </div>

 <div className="text-center">
 <h1 className="font-display text-[28px] leading-tight font-extrabold text-ink tracking-tight mb-1.5">
 {current.title}
 </h1>
 <p className="text-[16px] font-bold text-brand mb-2.5">
 {current.subtitle}
 </p>
 <p className="text-[15px] text-ink-2 leading-relaxed max-w-xs mx-auto">
 {current.description}
 </p>
 </div>

 {step === 0 && (
 <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label="Cam kết của KểCon">
 {[...FEATURE_CHIPS, ...TRUST_CHIPS].map(({ icon: Icon, label }) => (
 <li
 key={label}
 className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[13px] font-bold text-ink shadow-sm border border-ink/5"
 >
 <Icon size={16} className="text-brand" /> {label}
 </li>
 ))}
 </ul>
 )}
 </div>

 {/* Bottom */}
 <div className="px-7 pb-12 relative z-10">
 {/* Dots */}
 <div className="flex justify-center gap-1 mb-5">
 {steps.map((s, i) => (
 <button
 key={i}
 onClick={() => transition(i)}
 aria-label={`Bước ${i + 1}: ${s.title}`}
 aria-current={i === step ? "step" : undefined}
 className="h-6 px-1 flex items-center"
 >
 <span
 className={`block h-2.5 rounded-full transition-all duration-300 ${
 i === step ? "w-8 bg-brand" : "w-2.5 bg-ink/15"
 }`}
 />
 </button>
 ))}
 </div>

 {/* Actions */}
 {isLast ? (
 <div className="space-y-2.5">
 <button
 onClick={onGetStarted}
 className="w-full min-h-tap-kid rounded-btn bg-cta text-white text-[17px] font-extrabold flex items-center justify-center gap-2 active:scale-[0.98] active:bg-cta-press transition-transform shadow-[0_6px_0_var(--color-cta-press)]"
 >
 <Sparkles size={20} weight="fill" /> Bắt đầu ngay
 </button>
 <button
 onClick={onLogin}
 className="w-full min-h-tap-min rounded-btn bg-white text-brand text-[15px] font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform border-2 border-brand-soft"
 >
 Đã có tài khoản? Đăng nhập
 </button>
 </div>
 ) : (
 <button
 onClick={handleNext}
 className="w-full min-h-tap-kid rounded-btn bg-cta text-white text-[17px] font-extrabold flex items-center justify-center gap-2 active:scale-[0.98] active:bg-cta-press transition-transform shadow-[0_6px_0_var(--color-cta-press)]"
 >
 Tiếp tục <ChevronRight size={20} />
 </button>
 )}
 </div>
 </div>
 );
}
