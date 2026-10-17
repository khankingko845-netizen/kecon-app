"use client";
import { useFeatureFlags } from "@/lib/feature-flags-context";
import {recordMilestone} from "@/lib/measurement-client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Baby, Camera, ChevronDown, ChevronRight, FolderOpen, Heart, Palette, Play, Sparkles, Star, Upload, Wand2 } from "@/components/ui/icons";
import { useAuth } from "@/lib/auth-context";
import { useKidStories } from "@/lib/parental-controls-context";
import { filterAllowed, isCategoryAllowed } from "@/lib/content-filter";
import { useSettings } from "@/lib/settings-context";
import { getReadingStreak } from "@/lib/db";
import { getRecommendations, type ScoredStory } from "@/lib/recommendations";
import { getLastPlayed, lastPlayedProgress, LAST_PLAYED_EVENT, resumePage, type LastPlayed } from "@/lib/last-played";
import FamilyAvatar from "@/components/ui/FamilyAvatar";
import Mascot from "@/components/ui/Mascot";
import { CategoryIcon, Icon3D, type Icon3DName } from "@/components/ui/Icon3D";
import StoryThumb from "@/components/ui/StoryThumb";
import { Card, ProgressBar, SectionHeader, CARD_SHADOW } from "@/components/ui/kit";
import { Skeleton } from "@/components/ui/Skeleton";
import type { Screen } from "@/lib/types";
import { heroFor } from "@/lib/home-hero";
import { greetingMoment, type DomMoment } from "@/lib/dom-lines";
import { weekChipAria, weekChipParts } from "@/lib/missions";
import { useFeedback } from "@/lib/feedback-context";
import { useAgeUi } from "@/lib/age-ui-context";
import { exploreFor } from "@/lib/age-ui";
import { useChildProfiles } from "@/lib/child-profiles-context";
import ChildPicker from "@/components/ui/ChildPicker";

/** Đóm greets once per app session (sessionStorage), not on every return to Home. */
const GREETED_KEY = "kecon-dom-greeted";

interface HomeProps {
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

const WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
/** Last "nights this week" seen in this tab, so coming back to Home shows it at once. */
let lastNights: { uid: string; n: number } | null = null;

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
 const features = useFeatureFlags();
  const { profile, user } = useAuth();
  useEffect(()=>{if(user)recordMilestone("home_view");},[user]);
  // T19: only stories the parent allows (blocked categories / age cap removed).
 const { stories, loading, contentRules } = useKidStories();
  const { settings } = useSettings();
  const [forYou, setForYou] = useState<ScoredStory[]>([]);
  // G-02: "Tuần này N tối" (nights this week, resets quietly each Monday) — never "đêm liền".
  // null = still loading: the chip shows a placeholder instead of flashing the fallback text.
  const [nights, setNights] = useState<number | null>(() => (lastNights && lastNights.uid === user?.id ? lastNights.n : null));
  const missionsOn = features.enabled("missions");
  const [last, setLast] = useState<LastPlayed | null>(null);
  const { say, dismiss } = useFeedback();
  const ageUi = useAgeUi();
  // Đóm's bubble is fixed over every screen: what Home said (greeting, poke)
  // closes with Home so it never covers the next screen's Quay lại.
  const homeLine = useRef<{ moment: DomMoment | null }>({ moment: null });
  useEffect(() => {
    const box = homeLine.current;
    return () => {
      if (box.moment) dismiss(box.moment);
    };
  }, [dismiss]);

  const now = useMemo(() => new Date(), []);
  const hero = heroFor(now.getHours());
  const dateLine = `${WEEKDAYS[now.getDay()]} · ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  // T10: the child chosen on this device (Hồ sơ bé); siblings switch from the greeting.
  const { kids, activeChild, loaded: kidsLoaded, pendingDraft } = useChildProfiles();
  const childName = activeChild?.display_name;
  const [pickerOpen, setPickerOpen] = useState(false);
  const greeting = childName ? `Chào bé ${childName}!` : "Chào bé!";

  useEffect(() => {
    getRecommendations({ childAge: settings.childAge })
      .then((rec) => setForYou(filterAllowed(rec.forYou, contentRules, (r) => r.story)))
      .catch(() => {});
  }, [settings.childAge, stories.length, contentRules]);

  useEffect(() => {
    // The streak query is async: if the kid already left Home (opened a story),
    // Đóm does not greet over the next screen — he greets on the next visit.
    let here = true;
    const greet = (nights: number) => {
      if (!here) return;
      try {
        if (sessionStorage.getItem(GREETED_KEY)) return;
        sessionStorage.setItem(GREETED_KEY, "1");
      } catch {
        return;
      }
      homeLine.current.moment = greetingMoment(new Date().getHours(), nights);
      say(homeLine.current.moment);
    };
    getReadingStreak()
      .then((s) => greet(s?.current_streak ?? 0))
      .catch(() => greet(0));
    setLast(getLastPlayed());
    return () => {
      here = false;
    };
  }, [say]);

  useEffect(() => {
    if (!missionsOn || !user) return;
    let alive = true;
    fetch("/api/missions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { week?: { nights?: unknown } } | null) => {
        const n = typeof d?.week?.nights === "number" ? d.week.nights : 0;
        lastNights = { uid: user.id, n };
        if (alive) setNights(n);
      })
      .catch(() => {
        if (alive) setNights((v) => v ?? 0);
      });
    return () => {
      alive = false;
    };
  }, [missionsOn, user]);

  // The mini player keeps turning pages while Home is open: follow it.
  useEffect(() => {
    const sync = () => setLast(getLastPlayed());
    window.addEventListener(LAST_PLAYED_EVENT, sync);
    return () => window.removeEventListener(LAST_PLAYED_EVENT, sync);
  }, []);

  // "Nghe tiếp": last story on this device, else the newest story in the library.
  const resume = useMemo(() => {
    if (last && stories.some((s) => s.id === last.storyId)) return last;
    const s = stories[0];
    return s ? { storyId: s.id, title: s.title, page: 0, totalPages: Math.max(1, s.page_count || 1), category: s.category, voice: undefined, updatedAt: 0 } : null;
  }, [last, stories]);
  const resumeStory = resume ? stories.find((s) => s.id === resume.storyId) : undefined;
  // "Trang 3/8" on the card → the player opens on page 3, not page 1.
  const openResume = () => {
    if (!resume) return;
    onNavigate("player", resume.page > 1 ? { storyId: resume.storyId, page: String(resumePage(resume)) } : { storyId: resume.storyId });
  };

  // A poke before the (async) greeting arrives wins — the greeting must not
  // talk over the kid's own tap, so it is skipped for this session.
  const pokeDom = () => {
    try {
      sessionStorage.setItem(GREETED_KEY, "1");
    } catch {
      /* private mode: greeting may still follow */
    }
    homeLine.current.moment = "poke";
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

  const more: { label: string; screen: Screen; icon: typeof Upload }[] = [
    { label: "Yêu thích", screen: "favorites", icon: Heart },
    { label: "Chụp sách", screen: "scan-book", icon: Camera },
    { label: "Vẽ truyện", screen: "draw-story", icon: Palette },
    { label: "Bộ sưu tập", screen: "collections", icon: FolderOpen },
    { label: "Tải truyện", screen: "upload", icon: Upload },
  ];

  return (
    <div className="min-h-screen bg-cream px-5 pb-32 pt-12">
      {/* Header: avatar · greeting · week sky chip (board `.hrow`, G-02) */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onNavigate("profile-edit")}
          aria-label="Hồ sơ của bé"
          className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
        >
          <FamilyAvatar avatarUrl={profile?.avatar_url} emoji={profile?.avatar_emoji} size={52} label={null} />
        </button>
        <div className="min-w-0">
          <h1 className="truncate font-display text-[24px] font-bold leading-[1.05] text-ink">
            {kids.length >= 2 ? (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                aria-haspopup="dialog"
                data-testid="child-switch"
                className="inline-flex max-w-full min-h-11 items-center gap-1 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <span className="truncate">{greeting}</span>
                <ChevronDown size={18} className="shrink-0 text-ink-2" aria-hidden />
              </button>
            ) : (
              greeting
            )}
          </h1>
          <p data-kid-detail className="text-[14px] font-bold text-ink-2">{dateLine}</p>
        </div>
        <button
          type="button"
          hidden={!missionsOn}
          onClick={() => onNavigate("sky")}
          aria-label={weekChipAria(nights ?? 0)}
          aria-busy={nights === null || undefined}
          data-testid="week-sky-chip"
          data-loading={nights === null || undefined}
          className="ml-auto flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-2xl bg-glow-soft px-2.5 text-[#7A4A00] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Star size={20} weight="fill" className="text-[#F2A900]" aria-hidden />
          {nights === null ? (
            <span className="flex w-[58px] flex-col items-start gap-1" aria-hidden data-testid="week-sky-chip-skeleton">
              <span className="h-[10px] w-[44px] animate-pulse rounded-full bg-[#F2D48A]" />
              <span className="h-[13px] w-[56px] animate-pulse rounded-full bg-[#F2D48A]" />
            </span>
          ) : (
            <span className="flex flex-col items-start leading-none" aria-hidden>
              <span className="text-[12px] font-extrabold">{weekChipParts(nights)[0]}</span>
              <span className="mt-0.5 text-[15px] font-black">{weekChipParts(nights)[1]}</span>
            </span>
          )}
        </button>
      </div>

      {kidsLoaded && kids.length === 0 && !pendingDraft && (
        <button
          type="button"
          onClick={() => onNavigate("child-profiles")}
          data-testid="add-child-card"
          className={`mt-3 flex min-h-[60px] w-full items-center gap-3 rounded-2xl bg-white px-3.5 py-3 text-left ${CARD_SHADOW}`}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-glow-soft text-[#9A6A00]">
            <Baby size={22} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-extrabold text-ink">Thêm hồ sơ bé</span>
            <span data-kid-detail className="block text-[14px] font-bold text-ink-2">Để Đóm gọi tên bé và chọn truyện hợp tuổi</span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-ink-2" aria-hidden />
        </button>
      )}
      {pickerOpen && <ChildPicker onClose={() => setPickerOpen(false)} />}

      {/* Hero (board `.hero`) */}
      <section className="relative mt-3.5 h-[150px] overflow-hidden rounded-[28px] bg-gradient-to-br from-brand to-[#7B61FF] p-[18px] text-white" aria-label="Gợi ý của Đóm">
        <Star size={14} weight="fill" className="absolute left-[196px] top-3 text-[#FFE7A6]" />
        <Sparkles size={14} weight="fill" className="absolute left-[205px] top-[60px] text-[#FFE7A6]" />
        <h2 className="w-[200px] font-display text-[25px] font-bold leading-[1.1]">{hero.title}</h2>
        <button
          type="button"
          onClick={suggest}
          className="relative z-10 mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-2xl bg-glow px-4 text-[15px] font-black text-on-glow active:scale-95"
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
            <button type="button" onClick={openResume} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <StoryThumb
                story={resumeStory ?? { id: resume.storyId }}
                eager
                className="h-[70px] w-[70px] rounded-[18px]"
                fallback={
                  <span
                    className="flex h-[70px] w-[70px] shrink-0 items-center justify-center overflow-hidden rounded-[18px] bg-[#2A2160] bg-cover bg-[center_70%]"
                    style={{ backgroundImage: "url(/images/night-bg.webp)" }}
                  >
                    <CategoryIcon category={resume.category} size={44} className="drop-shadow" />
                  </span>
                }
              />
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
              onClick={openResume}
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
                <StoryThumb story={story} category={story.category} iconSize={64} className="h-[88px] w-full rounded-[16px]" />
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
        {exploreFor(more.filter((item) => features.canOpen(item.screen)), ageUi)
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
