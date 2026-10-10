"use client";
import { useToast } from "@/components/ui/Toast";

import { useState, useEffect, useCallback } from "react";
import { CategoryIcon } from "@/components/ui/Icon3D";
import { Shield, Clock, Moon, Lock, Save, Loader2, Check } from "@/components/ui/icons";
import { Button3D, Card } from "@/components/ui/kit";
import ParentHeader from "@/components/parent/ParentHeader";
import { PARENTAL_CONTROLS_EVENT } from "@/lib/parental-controls-context";
import { useAuth } from "@/lib/auth-context";
import { getParentalControls, upsertParentalControls } from "@/lib/db";
import { createClient } from "@/lib/supabase/client";
import { getParentPinStatus, pinErrorMessage, PIN_PATTERN, setParentPin, type PinStatus } from "@/lib/parent-pin";
import type { Screen } from "@/lib/types";

interface ParentalControlsProps {
 onNavigate: (screen: Screen, data?: Record<string, string>) => void;
 onBack: () => void;
}

const CATEGORIES = [
 { id: "fairy_tale", label: "Cổ tích" },
 { id: "adventure", label: "Phiêu lưu" },
 { id: "bedtime", label: "Ru ngủ" },
 { id: "animal", label: "Động vật" },
 { id: "educational", label: "Học chơi" },
 { id: "custom", label: "Tùy chỉnh" },
];

export default function ParentalControls({ onBack }: ParentalControlsProps) {
 const { profile } = useAuth();
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
 const [saved, setSaved] = useState(false);
 const { toast } = useToast();

 const [enabled, setEnabled] = useState(false);
 const [pin, setPin] = useState("");
 const [currentPin, setCurrentPin] = useState("");
 const [pinStatus, setPinStatus] = useState<PinStatus | null>(null);
 const [pinError, setPinError] = useState<string | null>(null);
 const [dailyLimit, setDailyLimit] = useState(0);
 const [bedtimeStart, setBedtimeStart] = useState("");
 const [bedtimeEnd, setBedtimeEnd] = useState("");
 const [blockedCategories, setBlockedCategories] = useState<string[]>([]);
 const [maxAge, setMaxAge] = useState(99);

 const profileId = profile?.id;
 const load = useCallback(async () => {
 if (!profileId) return;
 setLoading(true);
 try {
 const [controls, status] = await Promise.all([
 getParentalControls(profileId),
 getParentPinStatus(createClient()),
 ]);
 setPinStatus(status);
 if (controls) {
 setEnabled(controls.is_enabled);
 setDailyLimit(controls.daily_limit_minutes);
 setBedtimeStart(controls.bedtime_start || "");
 setBedtimeEnd(controls.bedtime_end || "");
 setBlockedCategories(controls.blocked_categories || []);
 setMaxAge(controls.max_age_rating);
 }
 } catch {
 // ignore
 }
 setLoading(false);
 }, [profileId]);

 useEffect(() => { load(); }, [load]);

 const handleSave = async () => {
 if (!profile?.id) return;
 setPinError(null);
 if (pin && !PIN_PATTERN.test(pin)) {
 setPinError("Mã PIN phải gồm 4–6 chữ số.");
 return;
 }
 setSaving(true);
 try {
 // PIN is hashed + verified server-side (RPC); never stored by the client.
 if (pin) {
 const supabase = createClient();
 const result = await setParentPin(supabase, pin, pinStatus?.hasPin ? currentPin : undefined);
 if (!result.ok) {
 toast("error", "Chưa đổi được mã PIN. Kiểm tra lỗi và thử lại.");
 setPinError(pinErrorMessage(result));
 setSaving(false);
 return;
 }
 setPin("");
 setCurrentPin("");
 setPinStatus(await getParentPinStatus(supabase));
 }
 await upsertParentalControls(profile.id, {
 is_enabled: enabled,
 daily_limit_minutes: dailyLimit,
 bedtime_start: bedtimeStart || null,
 bedtime_end: bedtimeEnd || null,
 blocked_categories: blockedCategories,
 max_age_rating: maxAge,
 });
 window.dispatchEvent(new Event(PARENTAL_CONTROLS_EVENT));
 toast("success", "Đã lưu cài đặt kiểm soát của bố mẹ.");
 setSaved(true);
 setTimeout(() => setSaved(false), 2000);
 } catch {
 toast("error", "Chưa lưu hết cài đặt kiểm soát. Kiểm tra trạng thái trước khi thử lại.");
 }
 setSaving(false);
 };

 const toggleCategory = (cat: string) => {
 setBlockedCategories((prev) =>
 prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
 );
 };

 const chip = (active: boolean) =>
 `min-h-[44px] rounded-2xl px-2 text-[13px] font-semibold transition-colors ${
 active ? "bg-brand text-white" : "bg-parent-bg text-ink-2 dark:text-white/60"
 }`;

 if (loading) {
 return (
 <div className="min-h-screen bg-parent-bg font-parent flex items-center justify-center" role="status" aria-label="Đang tải">
 <Loader2 size={24} className="animate-spin text-brand-ink" />
 </div>
 );
 }

 return (
 <div className="min-h-screen bg-parent-bg font-parent pb-28">
 <ParentHeader title="Kiểm soát phụ huynh" subtitle="Khoá tab Bố mẹ, giới hạn giờ và nội dung cho bé" onBack={onBack} />

 <div className="mt-2 space-y-3 px-5">
 {/* PIN — always available: it guards the whole parent area (T19) */}
 <Card className="p-4">
 <div className="mb-1 flex items-center gap-2">
 <Lock size={18} className="text-brand-ink" />
 <p className="text-[15px] font-semibold text-ink">Mã PIN phụ huynh</p>
 {pinStatus?.hasPin ? (
 <span className="ml-auto rounded-xl bg-success-soft px-2 py-1 text-[12px] font-semibold text-success">Đã đặt</span>
 ) : (
 <span className="ml-auto rounded-xl bg-glow-soft px-2 py-1 text-[12px] font-semibold text-[#7A4A00]">Chưa đặt</span>
 )}
 </div>
 <p className="mb-3 text-[13px] leading-relaxed text-ink-2">
 4–6 chữ số, dùng để mở tab Bố mẹ và cho bé thêm giờ. Chưa có PIN thì app hỏi một phép tính dành cho người lớn.
 </p>
 {pinStatus?.resetRequired && (
 <p className="mb-3 rounded-2xl bg-glow-soft px-3 py-2 text-[13px] text-[#7A4A00]">
 Mã PIN cũ đã được xoá (đặt lại hoặc nâng cấp bảo mật). Vui lòng đặt mã PIN mới.
 </p>
 )}
 {pinStatus?.hasPin && (
 <input
 type="password"
 inputMode="numeric"
 autoComplete="current-password"
 maxLength={6}
 placeholder="PIN hiện tại (để đổi PIN)"
 aria-label="PIN hiện tại"
 value={currentPin}
 onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))}
 className="mb-2 h-12 w-full rounded-2xl bg-parent-bg px-4 text-center text-[18px] font-bold tracking-[0.5em] text-ink outline-none ring-brand placeholder:text-[14px] placeholder:font-medium placeholder:tracking-normal focus:ring-2"
 />
 )}
 <input
 type="password"
 inputMode="numeric"
 autoComplete="new-password"
 maxLength={6}
 placeholder={pinStatus?.hasPin ? "PIN mới" : "Đặt mã PIN mới"}
 aria-label="PIN mới"
 value={pin}
 onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
 className="h-12 w-full rounded-2xl bg-parent-bg px-4 text-center text-[18px] font-bold tracking-[0.5em] text-ink outline-none ring-brand placeholder:text-[14px] placeholder:font-medium placeholder:tracking-normal focus:ring-2"
 />
 {pinError && (
 <p role="alert" className="mt-2 text-[13px] font-semibold text-cta-ink">
 {pinError}
 </p>
 )}
 </Card>

 {/* Enable Toggle */}
 <Card className="flex items-center gap-3 p-4">
 <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success">
 <Shield size={20} />
 </span>
 <span className="flex-1">
 <span className="block text-[15px] font-semibold text-ink">Giới hạn cho bé</span>
 <span className="block text-[12.5px] text-ink-2">Thời gian/ngày, giờ đi ngủ, thể loại và độ tuổi</span>
 </span>
 <button
 type="button"
 role="switch"
 aria-checked={enabled}
 aria-label="Bật giới hạn cho bé"
 onClick={() => setEnabled(!enabled)}
 className={`h-8 w-14 shrink-0 rounded-full p-1 transition-colors ${enabled ? "bg-success" : "bg-ink/15"}`}
 >
 <span className={`block h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-6" : "translate-x-0"}`} />
 </button>
 </Card>

 {enabled && (
 <>
 {/* Daily Time Limit */}
 <Card className="p-4">
 <div className="mb-1 flex items-center gap-2">
 <Clock size={18} className="text-brand-ink" />
 <p className="text-[15px] font-semibold text-ink">Thời gian dùng mỗi ngày</p>
 </div>
 <p className="mb-3 text-[12.5px] text-ink-2">Hết giờ, màn hình của bé khoá lại; bố mẹ nhập PIN để cho thêm 15–30 phút.</p>
 <div className="grid grid-cols-4 gap-2">
 {[0, 15, 30, 60].map((mins) => (
 <button key={mins} type="button" aria-pressed={dailyLimit === mins} onClick={() => setDailyLimit(mins)} className={chip(dailyLimit === mins)}>
 {mins === 0 ? "Không giới hạn" : `${mins} phút`}
 </button>
 ))}
 </div>
 {dailyLimit > 0 && (
 <div className="mt-3">
 <input
 type="range"
 min={5}
 max={180}
 step={5}
 value={dailyLimit}
 aria-label="Số phút mỗi ngày"
 onChange={(e) => setDailyLimit(Number(e.target.value))}
 className="w-full accent-[var(--color-brand)]"
 />
 <p className="mt-1 text-center text-[12.5px] font-medium text-ink-2">{dailyLimit} phút / ngày</p>
 </div>
 )}
 </Card>

 {/* Bedtime */}
 <Card className="p-4">
 <div className="mb-1 flex items-center gap-2">
 <Moon size={18} className="text-brand-ink" />
 <p className="text-[15px] font-semibold text-ink">Giờ đi ngủ</p>
 </div>
 <p className="mb-3 text-[12.5px] text-ink-2">Trong khung giờ này app của bé khoá lại (có thể qua nửa đêm, ví dụ 21:00–06:00).</p>
 <div className="grid grid-cols-2 gap-3">
 <label className="block">
 <span className="mb-1 block text-[12.5px] font-medium text-ink-2">Bắt đầu</span>
 <input
 type="time"
 value={bedtimeStart}
 onChange={(e) => setBedtimeStart(e.target.value)}
 className="h-12 w-full rounded-2xl bg-parent-bg px-3 text-[15px] font-semibold text-ink"
 />
 </label>
 <label className="block">
 <span className="mb-1 block text-[12.5px] font-medium text-ink-2">Kết thúc</span>
 <input
 type="time"
 value={bedtimeEnd}
 onChange={(e) => setBedtimeEnd(e.target.value)}
 className="h-12 w-full rounded-2xl bg-parent-bg px-3 text-[15px] font-semibold text-ink"
 />
 </label>
 </div>
 </Card>

 {/* Blocked Categories */}
 <Card className="p-4">
 <p className="mb-1 text-[15px] font-semibold text-ink">Chặn thể loại</p>
 <p className="mb-3 text-[12.5px] text-ink-2">Truyện bị chặn ẩn khỏi Trang chủ, Thư viện, Yêu thích, Bộ sưu tập và không mở được.</p>
 <div className="grid grid-cols-3 gap-2">
 {CATEGORIES.map((cat) => {
 const blocked = blockedCategories.includes(cat.id);
 return (
 <button
 key={cat.id}
 type="button"
 aria-pressed={blocked}
 onClick={() => toggleCategory(cat.id)}
 className={`flex flex-col items-center gap-1 rounded-2xl py-2.5 text-[12.5px] font-semibold transition-colors ${
 blocked ? "bg-[#FDE8E3] text-cta-ink ring-1 ring-cta/30" : "bg-parent-bg text-ink-2"
 }`}
 >
 <CategoryIcon category={cat.id} size={28} className="rounded-lg" />
 {cat.label}
 {blocked && <span className="text-[11px]">Đã chặn</span>}
 </button>
 );
 })}
 </div>
 </Card>

 {/* Age Rating */}
 <Card className="p-4">
 <p className="mb-1 text-[15px] font-semibold text-ink">Độ tuổi tối đa</p>
 <p className="mb-3 text-[12.5px] text-ink-2">Ẩn truyện dành cho bé lớn hơn mức này.</p>
 <div className="grid grid-cols-5 gap-2">
 {[3, 5, 7, 10, 99].map((age) => (
 <button key={age} type="button" aria-pressed={maxAge === age} onClick={() => setMaxAge(age)} className={chip(maxAge === age)}>
 {age >= 99 ? "Tất cả" : `≤${age}`}
 </button>
 ))}
 </div>
 </Card>
 </>
 )}

 <Button3D tone="brand" size="md" block onClick={handleSave} disabled={saving} className="mt-2">
 {saving ? <Loader2 size={18} className="animate-spin" /> : saved ? <Check size={18} /> : <Save size={18} />}
 {saving ? "Đang lưu..." : saved ? "Đã lưu!" : "Lưu cài đặt"}
 </Button3D>
 </div>
 </div>
 );
}
