"use client";

/**
 * T10 · Hồ sơ bé (docs/child-profiles.md): 1–5 children per household — tên gọi,
 * năm sinh (no full date of birth), sở thích. The child chosen here ("Đang nghe")
 * drives the greeting, the kid UI age band, suggestions and story creation on this device.
 */
import { useState } from "react";
import ParentHeader from "@/components/parent/ParentHeader";
import { CARD_SHADOW } from "@/components/ui/kit";
import { useToast } from "@/components/ui/Toast";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "@/components/ui/icons";
import { useChildProfiles } from "@/lib/child-profiles-context";
import { ageUiFor } from "@/lib/age-ui";
import {
  INTEREST_SUGGESTIONS,
  MAX_CHILD_INTERESTS,
  MAX_CHILD_NAME_LENGTH,
  MAX_CHILD_PROFILES,
  MAX_INTEREST_LENGTH,
  ageLabel,
  birthYearOptions,
  childAge,
  childInitial,
  normalizeInterests,
  type ChildProfile,
} from "@/lib/child-profiles";
import type { Screen } from "@/lib/types";

interface ChildProfilesProps {
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
  onBack: () => void;
}

type Mode = { kind: "list" } | { kind: "add" } | { kind: "edit"; child: ChildProfile };

const INITIAL_COLORS = ["bg-brand-soft text-brand-ink", "bg-glow-soft text-[#7A4A00]", "bg-success-soft text-success", "bg-[#FDE7DF] text-cta-press"];

function bandText(birthYear: number | null): string | null {
  const age = childAge(birthYear);
  if (age === null) return null;
  const ui = ageUiFor(Math.max(age, 1));
  return `${ui.short} · ${ui.label}`;
}

export default function ChildProfiles({ onBack }: ChildProfilesProps) {
  const { kids, loaded, loadError, activeChild, setActiveChild, removeChild, reload } = useChildProfiles();
  const { toast, showConfirm } = useToast();
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const full = kids.length >= MAX_CHILD_PROFILES;

  const choose = (child: ChildProfile) => {
    setActiveChild(child.id);
    toast("success", `Đã chọn bé ${child.display_name} trên thiết bị này.`);
  };

  const remove = async (child: ChildProfile) => {
    const ok = await showConfirm(
      `Xoá hồ sơ bé ${child.display_name}?`,
      "Tên, năm sinh và sở thích của bé sẽ bị xoá. Truyện đã tạo vẫn được giữ trong thư viện.",
    );
    if (!ok) return;
    setBusyId(child.id);
    const res = await removeChild(child.id);
    setBusyId(null);
    if (res.ok) toast("success", `Đã xoá hồ sơ bé ${child.display_name}.`);
    else toast("error", res.message);
  };

  if (mode.kind !== "list") {
    return (
      <div className="min-h-screen bg-surface pb-24 dark:bg-[#0A0A0F]">
        <ParentHeader title={mode.kind === "add" ? "Thêm bé" : `Sửa hồ sơ ${mode.child.display_name}`} onBack={() => setMode({ kind: "list" })} />
        <div className="px-5 pt-2">
          <ChildForm
            key={mode.kind === "edit" ? mode.child.id : "new"}
            child={mode.kind === "edit" ? mode.child : null}
            onDone={(saved) => {
              setMode({ kind: "list" });
              if (saved) toast("success", mode.kind === "add" ? `Đã thêm bé ${saved.display_name}.` : `Đã lưu hồ sơ bé ${saved.display_name}.`);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface pb-24 dark:bg-[#0A0A0F]">
      <ParentHeader title="Hồ sơ bé" onBack={onBack} subtitle={`Tối đa ${MAX_CHILD_PROFILES} bé mỗi gia đình · chỉ người trong gia đình xem và sửa được`} />
      <div className="px-5 pt-2">
        {!loaded && (
          <div aria-busy="true" aria-label="Đang tải hồ sơ bé" className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className={`h-[104px] animate-pulse rounded-[20px] bg-white dark:bg-white/[0.05] ${CARD_SHADOW}`} />
            ))}
          </div>
        )}

        {loaded && loadError && (
          <div role="alert" className="mb-3 rounded-2xl bg-red-50 px-4 py-3 font-parent text-[14px] font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">
            Chưa tải được hồ sơ bé.{" "}
            <button type="button" onClick={() => void reload()} className="min-h-11 px-1 font-bold underline">
              Thử lại
            </button>
          </div>
        )}

        {loaded && !loadError && kids.length === 0 && (
          <div className={`rounded-[20px] bg-white p-5 text-center dark:bg-white/[0.05] ${CARD_SHADOW}`}>
            <p className="font-parent text-[16px] font-bold text-ink dark:text-white">Chưa có hồ sơ bé nào</p>
            <p className="mt-1 font-parent text-[14px] text-ink-2 dark:text-white/65">
              Thêm tên gọi và năm sinh để Đóm chào bé, chọn cỡ chữ và gợi ý truyện hợp tuổi.
            </p>
          </div>
        )}

        <ul className="space-y-3" aria-label="Danh sách hồ sơ bé">
          {kids.map((child, i) => {
            const active = activeChild?.id === child.id;
            const band = bandText(child.birth_year);
            return (
              <li key={child.id}>
                <article
                  aria-label={`Hồ sơ bé ${child.display_name}`}
                  data-testid="child-card"
                  data-active={active || undefined}
                  className={`rounded-[20px] bg-white p-4 dark:bg-white/[0.05] ${CARD_SHADOW} ${active ? "ring-2 ring-brand" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-display text-[22px] font-bold ${INITIAL_COLORS[i % INITIAL_COLORS.length]}`}
                    >
                      {childInitial(child.display_name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate font-parent text-[17px] font-bold text-ink dark:text-white">{child.display_name}</h2>
                        {active && (
                          <span className="shrink-0 rounded-lg bg-brand px-2 py-0.5 font-parent text-[12px] font-bold text-white">Đang nghe</span>
                        )}
                      </div>
                      <p className="font-parent text-[14px] text-ink-2 dark:text-white/65">
                        {ageLabel(child.birth_year)}
                        {band ? ` · ${band}` : ""}
                      </p>
                      {child.interests.length > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`Sở thích của ${child.display_name}`}>
                          {child.interests.map((tag) => (
                            <li key={tag} className="rounded-xl bg-brand-soft px-2.5 py-1 font-parent text-[13px] font-semibold text-brand-ink">
                              {tag}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!active && (
                      <button
                        type="button"
                        onClick={() => choose(child)}
                        className="min-h-11 flex-1 rounded-xl bg-brand px-3 font-parent text-[14px] font-bold text-white"
                      >
                        Chọn bé này
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setMode({ kind: "edit", child })}
                      aria-label={`Sửa hồ sơ ${child.display_name}`}
                      className="flex min-h-11 items-center gap-1.5 rounded-xl bg-surface px-3 font-parent text-[14px] font-bold text-ink dark:bg-white/[0.06] dark:text-white"
                    >
                      <Pencil size={16} aria-hidden /> Sửa
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(child)}
                      disabled={busyId === child.id}
                      aria-label={`Xoá hồ sơ ${child.display_name}`}
                      className="flex min-h-11 items-center gap-1.5 rounded-xl bg-[#FDE7DF] px-3 font-parent text-[14px] font-bold text-cta-press disabled:opacity-60 dark:bg-cta/20 dark:text-cta-ink"
                    >
                      {busyId === child.id ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Trash2 size={16} aria-hidden />} Xoá
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>

        {loaded && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setMode({ kind: "add" })}
              disabled={full || loadError}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-brand font-parent text-[16px] font-bold text-white disabled:opacity-50"
            >
              <Plus size={18} aria-hidden /> Thêm bé
            </button>
            {full && (
              <p className="mt-2 font-parent text-[14px] text-ink-2 dark:text-white/65">
                Đã đủ {MAX_CHILD_PROFILES} hồ sơ bé. Xoá bớt một hồ sơ để thêm bé khác.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChildForm({ child, onDone }: { child: ChildProfile | null; onDone: (saved: ChildProfile | null) => void }) {
  const { addChild, updateChild } = useChildProfiles();
  const [name, setName] = useState(child?.display_name ?? "");
  const [birthYear, setBirthYear] = useState<number | null>(child?.birth_year ?? null);
  const [interests, setInterests] = useState<string[]>(child?.interests ?? []);
  const [custom, setCustom] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);

  const options = birthYearOptions();
  // A legacy child older than the picker (13–18) keeps their year as an option.
  if (child?.birth_year && !options.some((o) => o.year === child.birth_year)) {
    options.push({ year: child.birth_year, age: childAge(child.birth_year) ?? 0 });
  }
  const age = childAge(birthYear);
  const ui = age === null ? null : ageUiFor(Math.max(age, 1));
  const fullInterests = interests.length >= MAX_CHILD_INTERESTS;
  const has = (tag: string) => interests.some((t) => t.toLocaleLowerCase("vi") === tag.toLocaleLowerCase("vi"));

  const toggle = (tag: string) => {
    setError(null);
    setInterests((prev) => (has(tag) ? prev.filter((t) => t.toLocaleLowerCase("vi") !== tag.toLocaleLowerCase("vi")) : prev.length >= MAX_CHILD_INTERESTS ? prev : [...prev, tag]));
  };

  const addCustom = () => {
    const tag = normalizeInterests([custom])[0];
    if (!tag) return;
    if (tag.length > MAX_INTEREST_LENGTH) {
      setError({ field: "interests", message: `Mỗi sở thích tối đa ${MAX_INTEREST_LENGTH} ký tự.` });
      return;
    }
    if (!has(tag) && !fullInterests) setInterests((prev) => [...prev, tag]);
    setCustom("");
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const draft = { displayName: name, birthYear, interests };
    const res = child ? await updateChild(child.id, draft) : await addChild(draft);
    setSaving(false);
    if (res.ok) onDone(res.child);
    else setError({ field: res.field, message: res.message });
  };

  const fieldError = (field: string) =>
    error && error.field === field ? (
      <p role="alert" className="mt-2 font-parent text-[14px] font-semibold text-red-700 dark:text-red-300">
        {error.message}
      </p>
    ) : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="space-y-4"
      aria-label={child ? `Sửa hồ sơ ${child.display_name}` : "Thêm hồ sơ bé"}
    >
      <div className={`rounded-[20px] bg-white p-5 dark:bg-white/[0.05] ${CARD_SHADOW}`}>
        <label htmlFor="child-display-name" className="mb-2 block font-parent text-[14px] font-bold text-ink dark:text-white">
          Tên gọi
        </label>
        <input
          id="child-display-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          maxLength={MAX_CHILD_NAME_LENGTH}
          autoComplete="off"
          placeholder="VD: Bin, Na, Mít…"
          aria-invalid={error?.field === "name" || undefined}
          className="h-12 w-full rounded-xl border border-gray-200 bg-surface px-4 font-parent text-[16px] font-semibold text-ink outline-none focus:border-brand dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
        />
        <p className="mt-2 font-parent text-[13px] text-ink-2 dark:text-white/65">Tên Đóm dùng để chào bé và đưa bé vào truyện.</p>
        {fieldError("name")}
      </div>

      <div className={`rounded-[20px] bg-white p-5 dark:bg-white/[0.05] ${CARD_SHADOW}`}>
        <label htmlFor="child-birth-year" className="mb-2 block font-parent text-[14px] font-bold text-ink dark:text-white">
          Năm sinh
        </label>
        <select
          id="child-birth-year"
          value={birthYear ?? ""}
          onChange={(e) => {
            setBirthYear(e.target.value ? Number(e.target.value) : null);
            setError(null);
          }}
          aria-invalid={error?.field === "birthYear" || undefined}
          className="h-12 w-full rounded-xl border border-gray-200 bg-surface px-3 font-parent text-[16px] font-semibold text-ink outline-none focus:border-brand dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
        >
          <option value="" disabled>
            Chọn năm sinh
          </option>
          {options.map((o) => (
            <option key={o.year} value={o.year}>
              {o.year} · {o.age === 0 ? "dưới 1 tuổi" : `${o.age} tuổi`}
            </option>
          ))}
        </select>
        <p className="mt-2 font-parent text-[13px] text-ink-2 dark:text-white/65">Chỉ lưu năm sinh, không lưu ngày sinh đầy đủ.</p>
        {ui && (
          <p
            data-testid="age-band-summary"
            data-band={ui.band}
            className="mt-3 rounded-xl bg-accent/10 px-3 py-2.5 font-parent text-[13px] font-semibold leading-snug text-txt dark:text-white"
          >
            Nhóm <b>{ui.short} · {ui.label}</b>: {ui.summary}.
          </p>
        )}
        {fieldError("birthYear")}
      </div>

      <div className={`rounded-[20px] bg-white p-5 dark:bg-white/[0.05] ${CARD_SHADOW}`}>
        <div className="mb-2 flex items-baseline justify-between">
          <span id="child-interests-label" className="font-parent text-[14px] font-bold text-ink dark:text-white">
            Sở thích <small className="font-semibold text-ink-2 dark:text-white/65">(không bắt buộc)</small>
          </span>
          <span className="font-parent text-[13px] font-semibold text-ink-2 dark:text-white/65" aria-live="polite">
            {interests.length}/{MAX_CHILD_INTERESTS}
          </span>
        </div>
        <div role="group" aria-labelledby="child-interests-label" className="flex flex-wrap gap-2">
          {[...INTEREST_SUGGESTIONS, ...interests.filter((t) => !INTEREST_SUGGESTIONS.some((s) => s.toLocaleLowerCase("vi") === t.toLocaleLowerCase("vi")))].map((tag) => {
            const on = has(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={on}
                disabled={!on && fullInterests}
                onClick={() => toggle(tag)}
                className={`flex min-h-11 items-center gap-1 rounded-xl px-3 font-parent text-[14px] font-semibold transition-colors disabled:opacity-40 ${
                  on ? "bg-brand text-white" : "bg-surface text-ink dark:bg-white/[0.06] dark:text-white"
                }`}
              >
                {on && <Check size={14} aria-hidden />}
                {tag}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            aria-label="Sở thích khác"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
            maxLength={MAX_INTEREST_LENGTH}
            disabled={fullInterests}
            placeholder="Sở thích khác, VD: Làm bánh"
            className="h-11 min-w-0 flex-1 rounded-xl border border-gray-200 bg-surface px-3 font-parent text-[15px] text-ink outline-none focus:border-brand disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
          />
          <button
            type="button"
            onClick={addCustom}
            disabled={fullInterests || !custom.trim()}
            className="min-h-11 rounded-xl bg-brand-soft px-4 font-parent text-[14px] font-bold text-brand-ink disabled:opacity-50"
          >
            Thêm
          </button>
        </div>
        <p className="mt-2 font-parent text-[13px] text-ink-2 dark:text-white/65">Đóm lồng ghép nhẹ nhàng vào truyện khi hợp, không bắt buộc.</p>
        {fieldError("interests")}
      </div>

      {error && !error.field && (
        <p role="alert" data-testid="child-save-error" className="rounded-xl bg-red-50 px-4 py-3 font-parent text-[14px] font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {error.message}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onDone(null)}
          className="flex min-h-[52px] items-center gap-1.5 rounded-2xl bg-white px-4 font-parent text-[15px] font-bold text-ink dark:bg-white/[0.06] dark:text-white"
        >
          <X size={16} aria-hidden /> Huỷ
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl bg-brand font-parent text-[16px] font-bold text-white disabled:opacity-60"
        >
          {saving && <Loader2 size={16} className="animate-spin" aria-hidden />}
          {saving ? "Đang lưu…" : child ? "Lưu" : "Thêm bé"}
        </button>
      </div>
    </form>
  );
}
