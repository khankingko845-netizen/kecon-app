"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, Flame, FolderOpen, Heart, LayoutDashboard, Palette, Play, Sparkles, Star, Upload, Wand2 } from "@/components/ui/icons";
import { useAuth } from "@/lib/auth-context";
import { useKidStories } from "@/lib/parental-controls-context";
import { filterAllowed, isCategoryAllowed } from "@/lib/content-filter";
import { useSettings } from "@/lib/settings-context";
import { getReadingStreak } from "@/lib/db";
import { getRecommendations, type ScoredStory } from "@/lib/recommendations";
import { getLastPlayed, lastPlayedProgress, type LastPlayed } from "@/lib/last-played";
import Mascot from "@/components/ui/Mascot";
import { CategoryIcon, Icon3D, type Icon3DName } from "@/components/ui/Icon3D";
import { Card, ProgressBar, SectionHeader, CARD_SHADOW } from "@/components/ui/kit";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Screen } from "@/lib/types";
import { heroFor } from "@/lib/home-hero";
import { greetingMoment } from "@/lib/dom-lines";
import { useFeedback } from "@/lib/feedback-context";
import { useAgeUi } from "@/lib/age-ui-context";
import { exploreFor } from "@/lib/age-ui";

/** Đóm greets once per app session (sessionStorage), not on every return to Home. */
const GREETED_KEY = "kecon-dom-greeted";

interface HomeProps {
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

const WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

/** Concept board screen 2 — the hero copy follows the child's day. */
const TOPICS: { id: string; label: string; icon: Icon3DName }[] = [
  { id: "fairy_tale", label: "Cổ tích", icon: "castle" },
  { id: "adventure", label: "Phiêu lưu", icon: "rocket" },
  { id: "bedtime", label: "Ru ngủ", icon: "moon" },
  { id: "animal", label: "Động vật", icon: "paw" },
  { id: "educational", label: "Học chơi", icon: "book" },
  { id: "folk", label: "Dân gian", icon: "lotus" },
];

export default function Home({ onNavigate }: HomeProps) {
  const { isAdmin, profile } = useAuth();
  // T19: only stories the parent allows (blocked categories / age cap removed).
 const { stories, loading, contentRules } = useKidStories();
  const { settings } = useSettings();
  const [forYou, setForYou] = useState<ScoredStory[]>([]);
  const [streak, setStreak] = useState(0);
  const [last, setLast] = useState<LastPlayed | null>(null);
  const { say } = useFeedback();
  const ageUi = useAgeUi();

  const now = useMemo(() => new Date(), []);
  const hero = heroFor(now.getHours());
  const dateLine = `${WEEKDAYS[now.getDay()]} · ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const childName = settings.childName?.trim() || profile?.child_name?.trim();

  useEffect(() => {
    getRecommendations({ childAge: settings.childAge })
      .then((rec) => setForYou(filterAllowed(rec.forYou, contentRules, (r) => r.story)))
      .catch(() => {});
  }, [settings.childAge, stories.length, contentRules]);

  useEffect(() => {
    const greet = (nights: number) => {
      try {
        if (sessionStorage.getItem(GREETED_KEY)) return;
        sessionStorage.setItem(GREETED_KEY, "1");
      } catch {
        return;
      }
      say(greetingMoment(new Date().getHours(), nights));
    };
    getReadingStreak()
      .then((s) => {
        setStreak(s?.current_streak ?? 0);
        greet(s?.current_streak ?? 0);
      })
      .catch(() => greet(0));
    setLast(getLastPlayed());
  }, [say]);

  // "Nghe tiếp": last story on this device, else the newest story in the library.
  const resume = useMemo(() => {
    if (last && stories.some((s) => s.id === last.storyId)) return last;
    const s = stories[0];
    return s ? { storyId: s.id, title: s.title, page: 0, totalPages: Math.max(1, s.page_count || 1), category: s.category, voice: undefined, updatedAt: 0 } : null;
  }, [last, stories]);

  // A poke before the (async) greeting arrives wins — the greeting must not
  // talk over the kid's own tap, so it is skipped for this session.
  const pokeDom = () => {
    try {
      sessionStorage.setItem(GREETED_KEY, "1");
    } catch {
      /* private mode: greeting may still follow */
    }
    say("poke");
  };

  const suggest = () => {
    if (hero.lullaby) return onNavigate("lullaby");
    const pick = forYou[0]?.story ?? stories[0];
    if (pick) onNavigate("player", { storyId: pick.id });
    else onNavigate("library");
  };

  // UI-12: the hero, topics and shortcuts don't need data — render them at once
  // (fast LCP, no content → skeleton → content flash); only "Nghe tiếp" waits,
  // behind a placeholder of the same height so nothing shifts (CLS).
  const pendingStories = loading && stories.length === 0;

  const more: { label: string; screen: Screen; icon: typeof Upload; show?: boolean }[] = [
    { label: "Yêu thích", screen: "favorites", icon: Heart },
    { label: "Thử thách", screen: "daily-challenges", icon: Flame },
    { label: "Chụp sách", screen: "scan-book", icon: Camera },
    { label: "Vẽ truyện", screen: "draw-story", icon: Palette },
    { label: "Bộ sưu tập", screen: "collections", icon: FolderOpen },
    { label: "Tải truyện", screen: "upload", icon: Upload },
    { label: "Quản trị", screen: "admin", icon: LayoutDashboard, show: isAdmin },
  ];

  return (
    <div className="min-h-screen bg-cream px-5 pb-32 pt-12">
      {/* Header: avatar · greeting · streak (board `.hrow`) */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onNavigate("profile-edit")}
          aria-label="Hồ sơ của bé"
          className="flex h-[50px] w-[50px] shrink-0 items-center justify-center overflow-hidden rounded-[18px] bg-brand-soft"
        >
          <Icon3D name="paw" size={58} />
        </button>
        <div className="min-w-0">
          <h1 className="truncate font-display text-[24px] font-bold leading-[1.05] text-ink">
            {childName ? `Chào bé ${childName}!` : "Chào bé!"}
          </h1>
          <p data-kid-detail className="text-[14px] font-bold text-ink-2">{dateLine}</p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate("achievements")}
          aria-label={`${streak} đêm liền nghe truyện`}
          className="ml-auto flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-2xl bg-glow-soft px-3 text-[15px] font-black text-[#7A4A00]"
        >
          <Star size={20} weight="fill" className="text-[#F2A900]" /> {streak} đêm
        </button>
      </div>

      {/* Hero (board `.hero`) */}
      <section className="relative mt-3.5 h-[150px] overflow-hidden rounded-[28px] bg-gradient-to-br from-brand to-[#7B61FF] p-[18px] text-white" aria-label="Gợi ý của Đóm">
        <Star size={14} weight="fill" className="absolute left-[196px] top-3 text-[#FFE7A6]" />
        <Sparkles size={14} weight="fill" className="absolute left-[205px] top-[60px] text-[#FFE7A6]" />
        <h2 className="w-[200px] font-display text-[25px] font-bold leading-[1.1]">{hero.title}</h2>
        <button
          type="button"
          onClick={suggest}
          className="relative z-10 mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-2xl bg-glow px-3.5 text-[15px] font-black text-on-glow active:scale-95"
        >
          <Wand2 size={16} weight="fill" /> {hero.cta}
        </button>
        {/* UI-11: chạm Đóm → Đóm nói (bubble + giọng), có rung nhẹ */}
        <button
          type="button"
          data-sfx="pop"
          onClick={pokeDom}
          aria-label="Chạm để nghe Đóm nói"
          className="absolute -bottom-3.5 -right-1.5 flex h-[150px] w-[150px] items-end justify-end rounded-full active:scale-95"
        >
          <Mascot state={hero.mascot} size={150} priority label={null} />
        </button>
      </section>

      {/* Nghe tiếp (board `.cont`) */}
      {!resume && pendingStories && (
        <div data-testid="home-resume-pending" aria-hidden>
          <SectionHeader title="Nghe tiếp" />
          <Skeleton className="h-[95px] !rounded-[24px]" />
        </div>
      )}
      {resume && (
        <>
          <SectionHeader title="Nghe tiếp" />
          <Card className="flex items-center gap-3 p-2.5">
            <button type="button" onClick={() => onNavigate("player", { storyId: resume.storyId })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <span
                className="flex h-[70px] w-[70px] shrink-0 items-center justify-center overflow-hidden rounded-[18px] bg-[#2A2160] bg-cover bg-[center_70%]"
                style={{ backgroundImage: "url(/images/night-bg.webp)" }}
              >
                <CategoryIcon category={resume.category} size={44} className="drop-shadow" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[17px] font-black text-ink">{resume.title}</b>
                <small data-kid-detail className="block truncate text-[13.5px] font-bold text-ink-2">
                  {resume.page > 0
                    ? `${resume.voice ? `${resume.voice} · ` : ""}Trang ${resume.page}/${resume.totalPages}`
                    : `Chưa nghe · ${resume.totalPages} trang`}
                </small>
                <ProgressBar value={resume.page > 0 ? lastPlayedProgress(resume) : 0} className="mt-2" label="Tiến độ nghe" />
              </span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate("player", { storyId: resume.storyId })}
              aria-label={`Nghe tiếp ${resume.title}`}
              className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-cta text-white shadow-[0_4px_0_var(--color-cta-press)] active:translate-y-0.5"
            >
              <Play size={24} weight="fill" className="ml-0.5" />
            </button>
          </Card>
        </>
      )}

      {/* Chủ đề (board `.cats`) */}
      <SectionHeader title="Chủ đề" action="Xem tất cả" onAction={() => onNavigate("library")} />
      {/* UI-13: 3–5 → 2 cột ô to (chạm là Đóm đọc tên); 9–12 → ô gọn */}
      <div data-testid="home-topics" data-cols={ageUi.topicColumns} className={`grid gap-2.5 ${ageUi.topicColumns === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
        {TOPICS.filter((t) => isCategoryAllowed(t.id, contentRules)).map((t) => (
          <button
            key={t.id}
            type="button"
            data-say={t.label}
            onClick={() => onNavigate("library", { category: t.id })}
            className={`rounded-[22px] bg-white px-1.5 pb-2.5 pt-2 text-center active:scale-95 ${CARD_SHADOW}`}
          >
            <span className="mx-auto block overflow-hidden rounded-[20px]" style={{ width: ageUi.topicIcon, height: ageUi.topicIcon }}>
              <Icon3D name={t.icon} size={Math.round(ageUi.topicIcon * 1.19)} className="-m-[9%] max-w-none" />
            </span>
            <span className={`mt-1 block font-black text-ink ${ageUi.topicColumns === 2 ? "text-[18px]" : ageUi.density === "high" ? "text-[14px]" : "text-[15px]"}`}>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Dành cho bé */}
      {forYou.length > 0 && (
        <>
          <SectionHeader title="Dành cho bé" />
          <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1 no-scrollbar">
            {forYou.map(({ story, reason }) => (
              <button
                key={story.id}
                type="button"
                onClick={() => onNavigate("player", { storyId: story.id })}
                className={`w-[148px] shrink-0 rounded-[22px] bg-white p-2 text-left active:scale-[0.98] ${CARD_SHADOW}`}
              >
                <span className="flex h-[88px] items-center justify-center rounded-[16px] bg-brand-soft">
                  <CategoryIcon category={story.category} size={64} />
                </span>
                <b className="mt-1.5 block truncate px-1 text-[14px] font-black text-ink">{story.title}</b>
                <small data-kid-detail className="block truncate px-1 text-[12px] font-bold text-brand-ink">{reason}</small>
                {story.description && (
                  <small data-kid-extra className="line-clamp-2 px-1 pt-0.5 text-[11.5px] font-semibold leading-snug text-ink-2">{story.description}</small>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Khám phá thêm */}
      <SectionHeader title="Khám phá thêm" />
      <div data-testid="home-explore" className="grid grid-cols-2 gap-2.5">
        {exploreFor(more.filter((m) => m.show !== false), ageUi)
          .map(({ label, screen, icon: Icon }) => (
            <button
              key={screen}
              type="button"
              data-say={label}
              onClick={() => onNavigate(screen)}
              className={`flex min-h-[var(--kid-tap,56px)] items-center gap-2.5 rounded-[20px] bg-white px-3 text-left active:scale-[0.98] ${CARD_SHADOW}`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
                <Icon size={20} weight="duotone" />
              </span>
              <span className="text-[15px] font-extrabold text-ink">{label}</span>
            </button>
          ))}
      </div>
    </div>
  );
}
