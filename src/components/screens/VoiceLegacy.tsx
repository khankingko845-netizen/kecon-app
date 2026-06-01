"use client";

import { TreeDeciduous, User, UserRound, Baby, Heart, Archive, Mail, BarChart3, ChevronLeft } from "lucide-react";
import { familyTree } from "@/lib/data";

interface VoiceLegacyProps {
  onBack: () => void;
}

function AvatarIcon({ gender }: { gender: string }) {
  if (gender === "female") return <UserRound size={22} />;
  if (gender === "male") return <User size={22} />;
  return <Baby size={22} />;
}

export default function VoiceLegacy({ onBack }: VoiceLegacyProps) {
  const legacyItems = [
    { icon: Archive, bg: "bg-amber-100", color: "text-amber-800", title: "Ghi âm gốc Bà Ngoại", desc: "3 đoạn · 8 phút" },
    { icon: Mail, bg: "bg-violet-100", color: "text-violet-700", title: "Lời nhắn cho cháu", desc: '"Bà yêu Minh và Mai lắm!"' },
    { icon: BarChart3, bg: "bg-emerald-100", color: "text-emerald-700", title: "Thống kê gia đình", desc: "55 truyện · 42 giờ nghe" },
  ];

  return (
    <div className="min-h-screen bg-white">
      <button
        onClick={onBack}
        className="absolute left-5 top-14 w-9 h-9 rounded-xl bg-gray-100 text-txt flex items-center justify-center"
        aria-label="Quay lại"
      >
        <ChevronLeft size={20} />
      </button>
      <div className="pt-14 px-5 pb-4 text-center">
        <h2 className="text-[22px] font-extrabold tracking-tight mb-1 flex items-center justify-center gap-2">
          <TreeDeciduous size={22} className="text-emerald-700" /> Cây Giọng Nói
        </h2>
        <p className="text-[13px] text-txt-secondary font-medium">
          Lưu giữ giọng nói — di sản tình yêu
        </p>
      </div>

      {/* Family Tree */}
      <div className="flex flex-col items-center px-5 pt-2">
        {/* Grandparents */}
        <div className="flex gap-5 mb-1">
          {familyTree.grandparents.map((m) => (
            <div key={m.id} className="flex flex-col items-center gap-1">
              <div
                className={`w-[50px] h-[50px] rounded-2xl bg-gradient-to-br ${m.gradient} flex items-center justify-center text-white ${
                  m.storyCount > 0 ? "ring-[2.5px] ring-accent" : "opacity-35"
                }`}
              >
                <AvatarIcon gender={m.gender} />
              </div>
              <span className="text-[11px] font-bold">{m.name}</span>
              <span className={`text-[10px] ${m.storyCount > 0 ? "text-txt-secondary" : "text-accent"}`}>
                {m.storyCount > 0 ? `${m.storyCount} truyện` : "+ Thêm"}
              </span>
            </div>
          ))}
        </div>

        <div className="w-0.5 h-5 bg-gray-200 rounded-full" />

        {/* Parents */}
        <div className="flex gap-5 mb-1">
          {familyTree.parents.map((m) => (
            <div key={m.id} className="flex flex-col items-center gap-1">
              <div
                className={`w-[50px] h-[50px] rounded-2xl bg-gradient-to-br ${m.gradient} flex items-center justify-center text-white ring-[2.5px] ring-accent`}
              >
                <AvatarIcon gender={m.gender} />
              </div>
              <span className="text-[11px] font-bold">{m.name}</span>
              <span className="text-[10px] text-txt-secondary">{m.storyCount} truyện</span>
            </div>
          ))}
        </div>

        <div className="w-0.5 h-5 bg-gray-200 rounded-full" />

        {/* Children */}
        <div className="flex gap-5 mb-4">
          {familyTree.children.map((c) => (
            <div key={c.id} className="flex flex-col items-center gap-1">
              <div
                className={`w-[50px] h-[50px] rounded-2xl bg-gradient-to-br ${c.gradient} flex items-center justify-center text-white`}
              >
                <Baby size={22} />
              </div>
              <span className="text-[11px] font-bold">{c.name}</span>
              <span className="text-[10px] text-txt-secondary">{c.role}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Legacy Cards */}
      <div className="px-5 pb-10">
        <div className="bg-surface rounded-2xl p-[18px]">
          <h4 className="text-base font-extrabold tracking-tight mb-3.5 flex items-center gap-2">
            <Heart size={18} className="text-pink-500" /> Di Sản Giọng Nói
          </h4>
          {legacyItems.map((item, i) => {
            const Icon = item.icon;
            return (
              <div
                key={i}
                className={`flex items-center gap-3 py-2 ${
                  i < legacyItems.length - 1 ? "border-b border-gray-200" : ""
                }`}
              >
                <div
                  className={`w-[38px] h-[38px] rounded-[10px] ${item.bg} ${item.color} flex items-center justify-center shrink-0`}
                >
                  <Icon size={18} />
                </div>
                <div>
                  <h5 className="text-sm font-bold mb-px">{item.title}</h5>
                  <p className="text-[11px] text-txt-secondary">{item.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
