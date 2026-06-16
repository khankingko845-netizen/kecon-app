"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, Shield, Clock, Moon, Lock, Save, Loader2, Check } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getParentalControls, upsertParentalControls, type ParentalControls as PCType } from "@/lib/db";
import type { Screen } from "@/lib/types";

interface ParentalControlsProps {
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
  onBack: () => void;
}

const CATEGORIES = [
  { id: "fairy_tale", label: "Cổ tích", icon: "🏰" },
  { id: "adventure", label: "Phiêu lưu", icon: "🚀" },
  { id: "bedtime", label: "Ru ngủ", icon: "🌙" },
  { id: "animal", label: "Động vật", icon: "🐾" },
  { id: "educational", label: "Học chơi", icon: "📚" },
  { id: "custom", label: "Tùy chỉnh", icon: "✨" },
];

export default function ParentalControls({ onBack }: ParentalControlsProps) {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [pin, setPin] = useState("");
  const [dailyLimit, setDailyLimit] = useState(0);
  const [bedtimeStart, setBedtimeStart] = useState("");
  const [bedtimeEnd, setBedtimeEnd] = useState("");
  const [blockedCategories, setBlockedCategories] = useState<string[]>([]);
  const [maxAge, setMaxAge] = useState(99);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const controls = await getParentalControls(profile.id);
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
  }, [profile?.id]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!profile?.id) return;
    setSaving(true);
    try {
      await upsertParentalControls(profile.id, {
        is_enabled: enabled,
        pin_hash: pin ? btoa(pin) : undefined,
        daily_limit_minutes: dailyLimit,
        bedtime_start: bedtimeStart || null,
        bedtime_end: bedtimeEnd || null,
        blocked_categories: blockedCategories,
        max_age_rating: maxAge,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    }
    setSaving(false);
  };

  const toggleCategory = (cat: string) => {
    setBlockedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-24">
      <div className="px-5 pt-14">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white dark:bg-white/[0.04] flex items-center justify-center shadow-sm">
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-[24px] font-black tracking-tight">Kiểm Soát</h2>
          <Shield size={22} className="text-accent ml-1" />
        </div>

        {/* Enable Toggle */}
        <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 mb-4 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <Shield size={20} className="text-accent" />
            </div>
            <div>
              <p className="text-[14px] font-bold">Bật kiểm soát</p>
              <p className="text-[11px] text-txt-secondary dark:text-white/50">Giới hạn thời gian & nội dung cho bé</p>
            </div>
          </div>
          <button
            onClick={() => setEnabled(!enabled)}
            className={`w-12 h-7 rounded-full transition-colors ${enabled ? "bg-accent" : "bg-gray-200 dark:bg-white/[0.08]"}`}
          >
            <div className={`w-5 h-5 bg-white dark:bg-white/[0.04] rounded-full shadow-sm transform transition-transform mx-1 ${enabled ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>

        {enabled && (
          <>
            {/* PIN */}
            <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 mb-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Lock size={16} className="text-txt-secondary dark:text-white/50" />
                <p className="text-[13px] font-bold">Mã PIN (4 số)</p>
              </div>
              <input
                type="password"
                maxLength={4}
                placeholder="Nhập mã PIN để mở khóa cài đặt"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/[0.04] text-center text-[18px] tracking-[0.5em] font-bold"
              />
            </div>

            {/* Daily Time Limit */}
            <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 mb-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Clock size={16} className="text-txt-secondary dark:text-white/50" />
                <p className="text-[13px] font-bold">Giới hạn thời gian nghe / ngày</p>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[0, 15, 30, 60].map((mins) => (
                  <button
                    key={mins}
                    onClick={() => setDailyLimit(mins)}
                    className={`py-2.5 rounded-xl text-[12px] font-bold transition-all ${
                      dailyLimit === mins
                        ? "bg-accent text-white"
                        : "bg-gray-50 dark:bg-white/[0.04] text-txt-secondary dark:text-white/50"
                    }`}
                  >
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
                    onChange={(e) => setDailyLimit(Number(e.target.value))}
                    className="w-full accent-accent"
                  />
                  <p className="text-[11px] text-center text-txt-secondary dark:text-white/50 mt-1">
                    {dailyLimit} phút / ngày
                  </p>
                </div>
              )}
            </div>

            {/* Bedtime */}
            <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 mb-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Moon size={16} className="text-txt-secondary dark:text-white/50" />
                <p className="text-[13px] font-bold">Giờ ngủ (không cho nghe)</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-txt-secondary dark:text-white/50 mb-1 block">Bắt đầu</label>
                  <input
                    type="time"
                    value={bedtimeStart}
                    onChange={(e) => setBedtimeStart(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-white/[0.04] text-[13px] font-bold"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-txt-secondary dark:text-white/50 mb-1 block">Kết thúc</label>
                  <input
                    type="time"
                    value={bedtimeEnd}
                    onChange={(e) => setBedtimeEnd(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-white/[0.04] text-[13px] font-bold"
                  />
                </div>
              </div>
            </div>

            {/* Blocked Categories */}
            <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 mb-4 shadow-sm">
              <p className="text-[13px] font-bold mb-3">Chặn thể loại</p>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORIES.map((cat) => {
                  const blocked = blockedCategories.includes(cat.id);
                  return (
                    <button
                      key={cat.id}
                      onClick={() => toggleCategory(cat.id)}
                      className={`py-2.5 rounded-xl text-[11px] font-bold transition-all ${
                        blocked
                          ? "bg-red-50 text-red-600 ring-1 ring-red-200"
                          : "bg-gray-50 dark:bg-white/[0.04] text-txt-secondary dark:text-white/50"
                      }`}
                    >
                      <span className="text-lg">{cat.icon}</span>
                      <br />
                      {cat.label}
                      {blocked && " ⛔"}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Age Rating */}
            <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-4 mb-4 shadow-sm">
              <p className="text-[13px] font-bold mb-3">Độ tuổi tối đa</p>
              <div className="grid grid-cols-5 gap-2">
                {[3, 5, 7, 10, 99].map((age) => (
                  <button
                    key={age}
                    onClick={() => setMaxAge(age)}
                    className={`py-2.5 rounded-xl text-[12px] font-bold transition-all ${
                      maxAge === age ? "bg-accent text-white" : "bg-gray-50 dark:bg-white/[0.04] text-txt-secondary dark:text-white/50"
                    }`}
                  >
                    {age >= 99 ? "Tất cả" : `≤${age} tuổi`}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-4 rounded-2xl bg-accent text-white text-[15px] font-bold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : saved ? <Check size={18} /> : <Save size={18} />}
          {saving ? "Đang lưu..." : saved ? "Đã lưu!" : "Lưu cài đặt"}
        </button>
      </div>
    </div>
  );
}
