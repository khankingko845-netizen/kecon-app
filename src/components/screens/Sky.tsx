"use client";
/**
 * "Bầu trời của Đóm" (G-02…G-05, docs/missions-mvp.md): today's two listening
 * missions, this week's night sky (one star per night a story was finished,
 * resets quietly each Monday) and the album of characters met in library
 * stories. Everything shown was recorded by the server; nothing can be
 * bought, lost or expire. Flag `missions` (route guarded on the server).
 */
import { useEffect, useState } from "react";
import { BookOpen, Castle, CheckCircle, Heart, Leaf, PawPrint, Sparkles, Star, Users, type IconComponent } from "@/components/ui/icons";
import { Button3D, Card, KidHeader, SectionHeader } from "@/components/ui/kit";
import { KidError, KidLoading } from "@/components/ui/states";
import Mascot from "@/components/ui/Mascot";
import {
  ALL_DONE_LINE,
  WEEKDAY_LABELS,
  WEEKDAY_NAMES,
  familySkyLine,
  missionCopy,
  weekGoalLine,
  type MissionIcon,
  type MissionsAlbum,
  type MissionsToday,
} from "@/lib/missions";
import type { Screen } from "@/lib/types";

const ICONS: Record<MissionIcon, IconComponent> = { book: BookOpen, castle: Castle, leaf: Leaf, paw: PawPrint, sparkles: Sparkles };

interface SkyProps {
  onBack: () => void;
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
}

export default function Sky({ onBack, onNavigate }: SkyProps) {
  const [today, setToday] = useState<MissionsToday | null>(null);
  const [album, setAlbum] = useState<MissionsAlbum | null>(null);
  const [failed, setFailed] = useState(false);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([fetch("/api/missions", { cache: "no-store" }), fetch("/api/missions/album", { cache: "no-store" })])
      .then(async ([t, a]) => {
        if (!t.ok || !a.ok) throw new Error("missions unavailable");
        const [nextToday, nextAlbum] = [(await t.json()) as MissionsToday, (await a.json()) as MissionsAlbum];
        if (!alive) return;
        setToday(nextToday);
        setAlbum(nextAlbum);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const retry = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
  };

  if (failed)
    return (
      <div className="min-h-screen bg-cream px-5 pb-32 pt-12">
        <KidHeader title="Bầu trời của Đóm" onBack={onBack} />
        <KidError onRetry={retry} />
      </div>
    );
  if (!today || !album)
    return (
      <div className="min-h-screen bg-cream px-5 pb-32 pt-12">
        <KidHeader title="Bầu trời của Đóm" onBack={onBack} />
        <KidLoading title="Đóm đang thắp sao…" />
      </div>
    );

  const { week } = today;
  const fam = today.family;
  const allDone = today.missions.length > 0 && today.missions.every((m) => m.done);

  return (
    <div className="min-h-screen bg-cream px-5 pb-32 pt-12">
      <KidHeader title="Bầu trời của Đóm" onBack={onBack} />

      {/* G-02: this week's sky — nights listened, not days in a row. */}
      <section
        aria-labelledby="sky-week-title"
        className="relative mt-3 overflow-hidden rounded-[28px] bg-gradient-to-br from-[#2B2350] to-[#4A3F8F] p-[18px] text-white"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="sky-week-title" className="font-display text-[22px] font-bold leading-tight">
              Tuần này {week.nights} tối
            </h2>
            <p className="mt-1 text-[15px] font-bold text-[#E6DEFF]">{weekGoalLine(week.nights, week.goal)}</p>
          </div>
          <Mascot state={week.nights >= week.goal ? "celebrate" : "story"} size={72} label={null} still />
        </div>
        <ol className="mt-3 grid grid-cols-7 gap-1" aria-label="Các tối trong tuần">
          {week.days.map((d, i) => {
            const isToday = d.date === today.date;
            const label = `${WEEKDAY_NAMES[i]}${isToday ? " (hôm nay)" : ""}: ${d.listened ? `đã nghe truyện${d.stars ? `, ${d.stars} sao` : ""}` : "chưa có truyện"}`;
            return (
              <li
                key={d.date}
                aria-label={label}
                className={`flex flex-col items-center gap-1 rounded-2xl py-2 ${isToday ? "bg-white/15 ring-2 ring-[#FFE7A6]" : ""}`}
              >
                <Star
                  size={26}
                  weight={d.listened ? "fill" : "regular"}
                  className={d.listened ? "text-[#FFC94D]" : "text-white/40"}
                  aria-hidden
                />
                <span className="text-[13px] font-extrabold" aria-hidden>
                  {WEEKDAY_LABELS[i]}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {/* G-03: two missions a day, completed by finishing stories. */}
      <SectionHeader title="Nhiệm vụ hôm nay" />
      <ul className="space-y-2.5">
        {today.missions.map((m) => {
          const copy = missionCopy(m.id);
          const Icon = ICONS[copy.icon];
          return (
            <li key={m.id}>
              <Card className="flex items-center gap-3 p-3.5">
                <span
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${m.done ? "bg-success-soft text-success" : "bg-brand-soft text-brand-ink"}`}
                  aria-hidden
                >
                  <Icon size={26} weight="fill" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-extrabold text-ink">{copy.title}</p>
                  <p className="text-[14px] font-bold text-ink-2">{m.done ? "Đã xong, thêm một ngôi sao!" : copy.hint}</p>
                </div>
                {m.done ? (
                  <span className="flex shrink-0 items-center gap-1 text-[14px] font-black text-success">
                    <CheckCircle size={24} weight="fill" aria-hidden /> Xong
                  </span>
                ) : (
                  <Button3D
                    tone="brand"
                    size="sm"
                    onClick={() => onNavigate("library")}
                    className="shrink-0 px-3"
                    aria-label={`Chọn truyện cho nhiệm vụ: ${copy.title}`}
                  >
                    Chọn truyện
                  </Button3D>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
      {allDone && (
        <p role="status" className="mt-3 rounded-2xl bg-glow-soft px-4 py-3 text-[15px] font-extrabold text-[#7A4A00]">
          {ALL_DONE_LINE}
        </p>
      )}

      {/* G-06: what a parent saw today — a habit adds a star, a good deed gets a thank-you only. */}
      {today.habits.length > 0 && (
        <>
          <SectionHeader title="Bố mẹ đã thấy hôm nay" />
          <ul className="space-y-2.5" data-testid="sky-habits">
            {today.habits.map((h) => (
              <li key={h.id}>
                <Card className="flex items-center gap-3 p-3.5">
                  <span
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${h.kind === "kindness" ? "bg-[#FDE8E3] text-cta-ink" : "bg-glow-soft text-[#B07A00]"}`}
                    aria-hidden
                  >
                    {h.kind === "kindness" ? <Heart size={26} weight="fill" /> : <Star size={26} weight="fill" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[16px] font-extrabold text-ink">{h.title}</p>
                    <p className="text-[14px] font-bold text-ink-2">{h.line}</p>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* G-07: the family constellation — stories a parent marked as read together. */}
      {fam && (
        <section aria-labelledby="sky-family-title" className="mt-5 rounded-[24px] bg-[#2B2350] p-4 text-white" data-testid="sky-family">
          <div className="flex items-center gap-2">
            <Users size={22} weight="fill" className="text-[#FFE7A6]" aria-hidden />
            <h2 id="sky-family-title" className="font-display text-[18px] font-bold">
              Chòm sao của nhà mình
            </h2>
          </div>
          <p className="mt-1 text-[14px] font-bold text-[#E6DEFF]">{familySkyLine(fam.progress, fam.target)}</p>
          <div className="mt-2 flex gap-2" aria-hidden>
            {Array.from({ length: fam.target }, (_, i) => (
              <Star key={i} size={30} weight={i < fam.progress ? "fill" : "regular"} className={i < fam.progress ? "text-[#FFC94D]" : "text-white/35"} />
            ))}
          </div>
          {album.constellations.length > 0 && (
            <p className="mt-2 text-[13px] font-bold text-[#E6DEFF]">Nhà mình đã thắp {album.constellations.length} chòm sao.</p>
          )}
        </section>
      )}

      {/* G-05: characters met in finished library stories (earned only — no locked slots). */}
      <SectionHeader title="Album nhân vật" />
      {album.stickers.length === 0 ? (
        <Card className="p-4">
          <p className="text-[15px] font-bold text-ink-2">
            Nghe hết một truyện trong Thư viện, Đóm sẽ dán nhân vật vào đây nhé.
          </p>
        </Card>
      ) : (
        <ul className="grid grid-cols-3 gap-3" aria-label={`Album có ${album.stickers.length} nhân vật`}>
          {album.stickers.map((s) => (
            <li key={s.story_id} className="flex flex-col items-center text-center">
              {s.cover_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={s.cover_image_url}
                  alt=""
                  loading="lazy"
                  className="h-[88px] w-[88px] rounded-full border-4 border-white object-cover shadow-[0_4px_14px_rgba(43,35,80,0.12)]"
                />
              ) : (
                <span className="flex h-[88px] w-[88px] items-center justify-center rounded-full border-4 border-white bg-brand-soft text-brand-ink" aria-hidden>
                  <Sparkles size={32} weight="fill" />
                </span>
              )}
              <span className="mt-1.5 line-clamp-2 text-[13px] font-extrabold leading-tight text-ink">
                {s.title ?? "Bạn trong truyện"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {album.milestones.length > 0 && (
        <>
          <SectionHeader title="Cột mốc" />
          <ul className="flex flex-wrap gap-2" aria-label="Cột mốc đã đạt">
            {album.milestones.map((m) => (
              <li key={m} className="flex min-h-[40px] items-center gap-1.5 rounded-2xl bg-glow-soft px-3 text-[14px] font-black text-[#7A4A00]">
                <Star size={18} weight="fill" className="text-[#F2A900]" aria-hidden /> {m} truyện
              </li>
            ))}
          </ul>
        </>
      )}

      <p data-kid-detail className="mt-6 text-[13px] font-bold leading-snug text-ink-2">
        Bố mẹ ơi: sao được ghi khi bé nghe hết truyện. Không mua, không mất, không phạt khi nghỉ. Tuần mới bắt đầu từ thứ Hai.
      </p>
    </div>
  );
}
