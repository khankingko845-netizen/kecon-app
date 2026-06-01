"use client";

import { useState } from "react";
import { Leaf, Mountain, Waves, TreeDeciduous, Castle } from "lucide-react";
import TopBar from "@/components/ui/TopBar";

interface AdventureProps {
  onBack: () => void;
}

const choices = [
  {
    id: "mountain",
    icon: Mountain,
    title: "Đi lên ngọn núi",
    desc: "Khám phá lâu đài trên mây",
  },
  {
    id: "river",
    icon: Waves,
    title: "Đi xuống dòng suối",
    desc: "Gặp chú Cá Thần bí ẩn",
  },
];

export default function Adventure({ onBack }: AdventureProps) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <TopBar
        title=""
        onBack={onBack}
        rightElement={
          <span className="text-[15px] font-bold text-emerald-700 flex items-center gap-1.5">
            <Leaf size={18} /> Phiêu Lưu Của Minh
          </span>
        }
      />

      {/* Scene */}
      <div className="h-44 bg-gradient-to-b from-emerald-100 to-emerald-200 flex items-center justify-center gap-4 text-emerald-700">
        <TreeDeciduous size={48} />
        <Castle size={48} />
        <TreeDeciduous size={48} />
      </div>

      {/* Story */}
      <div className="flex-1 px-6 pt-5 pb-10">
        <p className="text-[15px] leading-[1.8] text-txt mb-5">
          &ldquo;Minh đi sâu vào khu rừng. Trước mặt em hiện ra hai con
          đường...&rdquo;
        </p>

        <h3 className="text-lg font-extrabold text-center text-emerald-700 mb-3.5 tracking-tight">
          Con muốn Minh đi đâu?
        </h3>

        {choices.map((c) => {
          const Icon = c.icon;
          const isSelected = selected === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setSelected(c.id)}
              className={`w-full p-4 rounded-[14px] flex items-center gap-3.5 mb-2.5 border-2 transition-all active:scale-[0.98] ${
                isSelected
                  ? "border-emerald-400 bg-emerald-50"
                  : "border-transparent bg-surface hover:border-emerald-300 hover:bg-emerald-50"
              }`}
            >
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                <Icon size={20} />
              </div>
              <div className="text-left">
                <strong className="text-[15px] font-bold block mb-0.5">
                  {c.title}
                </strong>
                <span className="text-xs text-txt-secondary">{c.desc}</span>
              </div>
            </button>
          );
        })}

        {selected && (
          <button className="w-full mt-4 py-4 rounded-[14px] bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold text-base shadow-lg shadow-emerald-500/30 active:scale-[0.98] transition-transform">
            Tiếp Tục Câu Chuyện
          </button>
        )}
      </div>
    </div>
  );
}
