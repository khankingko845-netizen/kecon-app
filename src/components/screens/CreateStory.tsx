"use client";

import { useState, useEffect } from "react";
import {
  Sparkles, Castle, Rocket, Moon, PawPrint, Blocks, Pencil,
  User, UserRound, Loader2, AlertCircle, Settings, Globe, Mic,
} from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import { storyThemes } from "@/lib/data";
import { useSettings } from "@/lib/settings-context";
import { useData } from "@/lib/data-context";
import { generateStoryApi } from "@/lib/api-client";
import type { Screen } from "@/lib/types";

interface DefaultVoice {
  id: string;
  voice_id: string;
  name: string;
  language: string;
}

const LANGUAGES = [
  { code: "vi", label: "🇻🇳 Tiếng Việt" },
  { code: "en", label: "🇺🇸 English" },
  { code: "ja", label: "🇯🇵 日本語" },
] as const;

interface CreateStoryProps {
  onBack: () => void;
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

const iconMap: Record<string, typeof Castle> = {
  castle: Castle,
  rocket: Rocket,
  moon: Moon,
  paw: PawPrint,
  blocks: Blocks,
  pencil: Pencil,
};

const ageOptions = ["2-3", "4-6", "7-9", "10+"];

export default function CreateStory({ onBack, onNavigate }: CreateStoryProps) {
  const { settings } = useSettings();
  const { voiceProfiles, refreshStories } = useData();
  const [selectedTheme, setSelectedTheme] = useState("cotich");
  const [selectedAge, setSelectedAge] = useState(settings.childAge || "4-6");
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [childName, setChildName] = useState(settings.childName || "Minh");
  const [extraPrompt, setExtraPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Language & narrator voice
  const [storyLocale, setStoryLocale] = useState(settings.language || "vi");
  const [defaultVoices, setDefaultVoices] = useState<DefaultVoice[]>([]);
  const [narratorVoiceId, setNarratorVoiceId] = useState<string | null>(null);

  // Fetch default voices
  useEffect(() => {
    fetch("/api/voice/defaults")
      .then((r) => r.json())
      .then((data) => {
        if (data.voices) setDefaultVoices(data.voices);
      })
      .catch(() => {});
  }, []);

  // Auto-select first default voice for locale when locale changes
  useEffect(() => {
    const forLocale = defaultVoices.filter((v) => v.language === storyLocale);
    if (forLocale.length > 0 && !narratorVoiceId) {
      setNarratorVoiceId(forLocale[0].voice_id);
    }
  }, [storyLocale, defaultVoices, narratorVoiceId]);

  const defaultVoicesForLocale = defaultVoices.filter((v) => v.language === storyLocale);

  const hasStoryKey = Boolean(
    settings.storyApiKey &&
      (settings.storyProvider !== "custom" || settings.storyBaseUrl)
  );
  const effectiveVoice =
    selectedVoice ?? (voiceProfiles.length > 0 ? voiceProfiles[0].id : null);

  const handleGenerate = async () => {
    if (!hasStoryKey) {
      onNavigate("settings");
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const story = await generateStoryApi({
        provider: settings.storyProvider,
        model: settings.storyModel,
        apiKey: settings.storyApiKey,
        baseUrl: settings.storyBaseUrl || undefined,
        theme: selectedTheme,
        childName,
        age: selectedAge,
        language: storyLocale,
        extraPrompt: extraPrompt || undefined,
        voiceId: effectiveVoice,
        narratorVoiceId: narratorVoiceId || undefined,
        narratorVoiceName: narratorVoiceId
          ? defaultVoices.find((v) => v.voice_id === narratorVoiceId)?.name
          : undefined,
        persist: true,
      });

      await refreshStories();

      if (story.storyId) {
        onNavigate("player", { storyId: story.storyId });
      } else {
        if (typeof window !== "undefined") {
          localStorage.setItem("kecon-generated-story", JSON.stringify(story));
        }
        onNavigate("player", { storyId: "__generated__" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã xảy ra lỗi");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <TopBar title="Tạo Truyện Mới" onBack={onBack} />

      <div className="px-5 pt-2 pb-10">
        {/* API Status */}
        {!hasStoryKey && (
          <button
            onClick={() => onNavigate("settings")}
            className="w-full mb-4 p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-center gap-2.5 active:scale-[0.98] transition-transform"
          >
            <AlertCircle size={18} className="text-amber-500 shrink-0" />
            <div className="flex-1 text-left">
              <p className="text-[13px] font-bold text-amber-800">
                Chưa cấu hình AI
              </p>
              <p className="text-[11px] text-amber-700">
                Nhấn để thêm API key
              </p>
            </div>
            <Settings size={16} className="text-amber-500" />
          </button>
        )}

        {/* Theme */}
        <div className="mb-5">
          <label className="text-[13px] font-bold text-txt mb-2.5 block">
            Chủ Đề
          </label>
          <div className="grid grid-cols-3 gap-2">
            {storyThemes.map((theme) => {
              const Icon = iconMap[theme.icon] || Castle;
              const selected = selectedTheme === theme.id;
              return (
                <button
                  key={theme.id}
                  onClick={() => setSelectedTheme(theme.id)}
                  className={`rounded-[14px] py-3.5 px-1.5 text-center border-2 transition-all ${
                    selected
                      ? "border-accent bg-orange-50"
                      : "border-transparent bg-surface"
                  }`}
                >
                  <Icon
                    size={24}
                    className={`mx-auto mb-1 ${
                      selected ? "text-accent" : "text-gray-500"
                    }`}
                  />
                  <div
                    className={`text-[11px] font-bold ${
                      selected ? "text-accent" : "text-txt"
                    }`}
                  >
                    {theme.name}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Child Name */}
        <div className="mb-5">
          <label className="text-[13px] font-bold text-txt mb-2.5 block">
            Tên Con
          </label>
          <input
            type="text"
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            className="w-full px-4 py-3.5 rounded-xl border-[1.5px] border-gray-200 bg-surface text-[15px] font-semibold text-txt outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* Age */}
        <div className="mb-5">
          <label className="text-[13px] font-bold text-txt mb-2.5 block">
            Độ Tuổi
          </label>
          <div className="flex gap-2">
            {ageOptions.map((age) => (
              <button
                key={age}
                onClick={() => setSelectedAge(age)}
                className={`flex-1 py-3 rounded-xl border-[1.5px] text-sm font-bold text-center transition-all ${
                  selectedAge === age
                    ? "border-accent bg-orange-50 text-accent"
                    : "border-gray-200 bg-surface text-txt-secondary"
                }`}
              >
                {age}
              </button>
            ))}
          </div>
        </div>

        {/* Language */}
        <div className="mb-5">
          <label className="text-[13px] font-bold text-txt mb-2.5 flex items-center gap-1.5">
            <Globe size={14} /> Ngôn Ngữ Truyện
          </label>
          <div className="flex gap-2">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => { setStoryLocale(lang.code); setNarratorVoiceId(null); }}
                className={`flex-1 py-3 rounded-xl border-[1.5px] text-sm font-bold text-center transition-all ${
                  storyLocale === lang.code
                    ? "border-accent bg-orange-50 text-accent"
                    : "border-gray-200 bg-surface text-txt-secondary"
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        {/* Narrator Voice */}
        <div className="mb-5">
          <label className="text-[13px] font-bold text-txt mb-2.5 flex items-center gap-1.5">
            <Mic size={14} /> Giọng Người Kể
          </label>

          {/* Default voices for this language */}
          {defaultVoicesForLocale.length > 0 || voiceProfiles.filter(v => v.elevenlabs_voice_id).length > 0 ? (
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {/* Default voices from admin */}
              {defaultVoicesForLocale.map((v) => {
                const selected = narratorVoiceId === v.voice_id;
                return (
                  <button
                    key={v.id}
                    onClick={() => { setNarratorVoiceId(v.voice_id); setSelectedVoice(null); }}
                    className={`min-w-[88px] py-3 px-2 rounded-[14px] border-2 text-center transition-all ${
                      selected
                        ? "border-accent bg-orange-50"
                        : "border-transparent bg-surface"
                    }`}
                  >
                    <div className="flex justify-center mb-1">
                      <Mic
                        size={20}
                        className={selected ? "text-accent" : "text-gray-500"}
                      />
                    </div>
                    <div className="text-xs font-bold truncate">{v.name}</div>
                    <div className="text-[10px] text-txt-secondary font-medium">⭐ Mặc định</div>
                  </button>
                );
              })}
              {/* User's cloned voices */}
              {voiceProfiles.filter(v => v.elevenlabs_voice_id).map((v) => {
                const selected = selectedVoice === v.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => { setSelectedVoice(v.id); setNarratorVoiceId(null); }}
                    className={`min-w-[88px] py-3 px-2 rounded-[14px] border-2 text-center transition-all ${
                      selected
                        ? "border-accent bg-orange-50"
                        : "border-transparent bg-surface"
                    }`}
                  >
                    <div className="flex justify-center mb-1">
                      {v.gender === "female" ? (
                        <UserRound
                          size={20}
                          className={selected ? "text-accent" : "text-gray-500"}
                        />
                      ) : (
                        <User
                          size={20}
                          className={selected ? "text-accent" : "text-gray-500"}
                        />
                      )}
                    </div>
                    <div className="text-xs font-bold truncate">{v.name}</div>
                    <div className="text-[10px] text-txt-secondary font-medium">🎙️ Clone</div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="py-3 px-3.5 rounded-[14px] bg-surface text-center">
              <p className="text-[12px] text-txt-secondary">
                Chưa có giọng nào cho ngôn ngữ này.
              </p>
              <button
                onClick={() => onNavigate("recording")}
                className="mt-1 text-[12px] text-accent font-bold"
              >
                Ghi âm giọng đọc ›
              </button>
            </div>
          )}
        </div>

        {/* Description */}
        <div className="mb-6">
          <label className="text-[13px] font-bold text-txt mb-2.5 block">
            Mô Tả Thêm
          </label>
          <textarea
            value={extraPrompt}
            onChange={(e) => setExtraPrompt(e.target.value)}
            placeholder="VD: Con thích khủng long, phép thuật..."
            className="w-full px-4 py-3.5 rounded-xl border-[1.5px] border-gray-200 bg-surface text-sm text-txt outline-none focus:border-accent transition-colors resize-none h-[72px]"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2">
            <AlertCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
            <p className="text-[13px] text-red-700">{error}</p>
          </div>
        )}

        {/* CTA */}
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="w-full py-[18px] rounded-[14px] bg-gradient-to-r from-accent to-pink-500 text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-accent/35 active:scale-[0.98] transition-transform disabled:opacity-60 disabled:active:scale-100"
        >
          {isGenerating ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              Đang tạo truyện...
            </>
          ) : (
            <>
              <Sparkles size={20} />
              {hasStoryKey ? "Tạo Truyện AI" : "Cấu Hình API Trước"}
            </>
          )}
        </button>

        {hasStoryKey && (
          <p className="text-[11px] text-txt-secondary text-center mt-2.5">
            Powered by {settings.storyProvider === "openai" ? "OpenAI" : settings.storyProvider === "gemini" ? "Google Gemini" : settings.storyProvider === "anthropic" ? "Anthropic" : "Custom"} · {settings.storyModel}
          </p>
        )}
      </div>
    </div>
  );
}
