"use client";

import { useMemo, useState } from "react";
import {
  TreeDeciduous, User, UserRound, Baby, Heart, BookOpen, Mic,
  ChevronLeft, Plus, Trash2, X, Loader2,
} from "lucide-react";
import { useData } from "@/lib/data-context";
import {
  createFamilyMember,
  deleteFamilyMember,
  gradientFor,
  type FamilyMemberRow,
} from "@/lib/db";

interface VoiceLegacyProps {
  onBack: () => void;
}

// Relation taxonomy → which tier of the family tree a member belongs to.
const RELATION_OPTIONS = [
  { key: "ong", label: "Ông", tier: "grandparents", gender: "male" },
  { key: "ba", label: "Bà", tier: "grandparents", gender: "female" },
  { key: "bo", label: "Bố", tier: "parents", gender: "male" },
  { key: "me", label: "Mẹ", tier: "parents", gender: "female" },
  { key: "con", label: "Con", tier: "children", gender: "child" },
  { key: "khac", label: "Khác", tier: "parents", gender: "other" },
] as const;

type Tier = "grandparents" | "parents" | "children";

function relationInfo(relation: string) {
  return (
    RELATION_OPTIONS.find((r) => r.key === relation) ?? {
      key: relation,
      label: relation,
      tier: "parents" as Tier,
      gender: "other" as const,
    }
  );
}

function AvatarIcon({ gender }: { gender: string }) {
  if (gender === "female") return <UserRound size={22} />;
  if (gender === "male") return <User size={22} />;
  return <Baby size={22} />;
}

export default function VoiceLegacy({ onBack }: VoiceLegacyProps) {
  const { familyMembers, voiceProfiles, stories, refreshFamily } = useData();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState<string>("ba");
  const [voiceProfileId, setVoiceProfileId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Number of stories linked to a member's voice profile.
  const storyCountFor = useMemo(() => {
    return (m: FamilyMemberRow) =>
      m.voice_profile_id
        ? stories.filter((s) => s.voice_id === m.voice_profile_id).length
        : 0;
  }, [stories]);

  const tiers = useMemo(() => {
    const groups: Record<Tier, FamilyMemberRow[]> = {
      grandparents: [],
      parents: [],
      children: [],
    };
    for (const m of familyMembers) {
      groups[relationInfo(m.relation).tier].push(m);
    }
    return groups;
  }, [familyMembers]);

  const totalStories = stories.length;
  const voicesWithClone = voiceProfiles.filter(
    (v) => v.elevenlabs_voice_id
  ).length;

  const handleAdd = async () => {
    if (!name.trim()) {
      setError("Nhập tên thành viên");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createFamilyMember({
        name: name.trim(),
        relation,
        voiceProfileId: voiceProfileId || null,
      });
      await refreshFamily();
      setName("");
      setVoiceProfileId("");
      setShowAdd(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Thêm thành viên thất bại");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteFamilyMember(id);
      await refreshFamily();
    } catch {
      /* ignore */
    }
  };

  const renderTier = (members: FamilyMemberRow[]) => (
    <div className="flex flex-wrap gap-5 justify-center mb-1">
      {members.map((m) => {
        const info = relationInfo(m.relation);
        const count = storyCountFor(m);
        return (
          <div key={m.id} className="flex flex-col items-center gap-1 group relative">
            <div
              className={`w-[50px] h-[50px] rounded-2xl bg-gradient-to-br ${gradientFor(
                m.id
              )} flex items-center justify-center text-white ${
                count > 0 ? "ring-[2.5px] ring-accent" : ""
              }`}
            >
              <AvatarIcon gender={info.gender} />
            </div>
            <span className="text-[11px] font-bold">{m.name}</span>
            <span className="text-[10px] text-txt-secondary dark:text-white/50">
              {count > 0 ? `${count} truyện` : info.label}
            </span>
            <button
              onClick={() => handleDelete(m.id)}
              className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label={`Xoá ${m.name}`}
            >
              <Trash2 size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen bg-white dark:bg-white/[0.04]">
      <button
        onClick={onBack}
        className="absolute left-5 top-14 w-9 h-9 rounded-xl bg-gray-100 dark:bg-white/[0.06] text-txt dark:text-white flex items-center justify-center"
        aria-label="Quay lại"
      >
        <ChevronLeft size={20} />
      </button>
      <div className="pt-14 px-5 pb-4 text-center">
        <h2 className="text-[22px] font-extrabold tracking-tight mb-1 flex items-center justify-center gap-2">
          <TreeDeciduous size={22} className="text-emerald-700" /> Cây Giọng Nói
        </h2>
        <p className="text-[13px] text-txt-secondary dark:text-white/50 font-medium">
          Lưu giữ giọng nói — di sản tình yêu
        </p>
      </div>

      {familyMembers.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
            <TreeDeciduous size={28} />
          </div>
          <p className="text-sm text-txt-secondary dark:text-white/50 mb-1 font-semibold">
            Chưa có thành viên nào
          </p>
          <p className="text-[12px] text-txt-secondary dark:text-white/50/70 mb-4">
            Thêm ông bà, bố mẹ để xây cây giọng nói gia đình.
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center px-5 pt-2">
          {tiers.grandparents.length > 0 && (
            <>
              {renderTier(tiers.grandparents)}
              <div className="w-0.5 h-5 bg-gray-200 dark:bg-white/[0.08] rounded-full" />
            </>
          )}
          {tiers.parents.length > 0 && (
            <>
              {renderTier(tiers.parents)}
              {tiers.children.length > 0 && (
                <div className="w-0.5 h-5 bg-gray-200 dark:bg-white/[0.08] rounded-full" />
              )}
            </>
          )}
          {tiers.children.length > 0 && renderTier(tiers.children)}
        </div>
      )}

      {/* Add member */}
      <div className="px-5 mt-4">
        <button
          onClick={() => setShowAdd(true)}
          className="w-full py-3 rounded-xl border-[1.5px] border-dashed border-emerald-300 text-emerald-700 text-[13px] font-bold flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
        >
          <Plus size={16} /> Thêm thành viên
        </button>
      </div>

      {/* Legacy stats (real data) */}
      <div className="px-5 pb-10 pt-5">
        <div className="bg-surface dark:bg-white/[0.04] rounded-2xl p-[18px]">
          <h4 className="text-base font-extrabold tracking-tight mb-3.5 flex items-center gap-2">
            <Heart size={18} className="text-pink-500" /> Di Sản Gia Đình
          </h4>
          <div className="flex items-center gap-3 py-2 border-b border-gray-200 dark:border-white/10">
            <div className="w-[38px] h-[38px] rounded-[10px] bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <BookOpen size={18} />
            </div>
            <div>
              <h5 className="text-sm font-bold mb-px">Tổng số truyện</h5>
              <p className="text-[11px] text-txt-secondary dark:text-white/50">
                {totalStories} truyện trong thư viện gia đình
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 py-2 border-b border-gray-200 dark:border-white/10">
            <div className="w-[38px] h-[38px] rounded-[10px] bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
              <Mic size={18} />
            </div>
            <div>
              <h5 className="text-sm font-bold mb-px">Giọng đã lưu</h5>
              <p className="text-[11px] text-txt-secondary dark:text-white/50">
                {voicesWithClone}/{voiceProfiles.length} giọng đã clone
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 py-2">
            <div className="w-[38px] h-[38px] rounded-[10px] bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <TreeDeciduous size={18} />
            </div>
            <div>
              <h5 className="text-sm font-bold mb-px">Thành viên</h5>
              <p className="text-[11px] text-txt-secondary dark:text-white/50">
                {familyMembers.length} người trong cây gia đình
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Add member modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-[430px] bg-white dark:bg-white/[0.04] rounded-t-3xl p-6 pb-9 animate-[slideUp_0.3s_ease]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[17px] font-black tracking-tight">
                Thêm thành viên
              </h3>
              <button
                onClick={() => setShowAdd(false)}
                className="w-8 h-8 rounded-full bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-txt-secondary dark:text-white/50"
              >
                <X size={16} />
              </button>
            </div>

            <label className="text-[13px] font-bold text-txt dark:text-white mb-2 block">Tên</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Bà Ngoại"
              className="w-full px-4 py-3 rounded-xl border-[1.5px] border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.04] text-[15px] font-semibold text-txt dark:text-white outline-none focus:border-accent transition-colors mb-4"
            />

            <label className="text-[13px] font-bold text-txt dark:text-white mb-2 block">Vai trò</label>
            <div className="flex flex-wrap gap-2 mb-4">
              {RELATION_OPTIONS.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRelation(r.key)}
                  className={`px-3.5 py-2 rounded-xl text-[13px] font-semibold border-[1.5px] transition-colors ${
                    relation === r.key
                      ? "border-accent bg-orange-50 text-accent"
                      : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-txt-secondary dark:text-white/50"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {voiceProfiles.length > 0 && (
              <>
                <label className="text-[13px] font-bold text-txt dark:text-white mb-2 block">
                  Liên kết giọng (tuỳ chọn)
                </label>
                <select
                  value={voiceProfileId}
                  onChange={(e) => setVoiceProfileId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border-[1.5px] border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.04] text-[15px] font-semibold text-txt dark:text-white outline-none focus:border-accent transition-colors mb-4"
                >
                  <option value="">— Không liên kết —</option>
                  {voiceProfiles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </>
            )}

            {error && (
              <p className="text-[12px] text-red-500 font-semibold mb-3">{error}</p>
            )}

            <button
              onClick={handleAdd}
              disabled={saving}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold text-base shadow-lg shadow-emerald-500/30 active:scale-[0.99] transition-transform disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
              Thêm vào cây gia đình
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
