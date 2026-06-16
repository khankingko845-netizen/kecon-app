"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, Bell, Check, Trash2, BookOpen, Mic, Trophy, Star, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import type { Screen } from "@/lib/types";

interface NotificationsProps {
  onNavigate: (screen: Screen, data?: Record<string, string>) => void;
  onBack: () => void;
}

interface Notification {
  id: string;
  type: "story_created" | "voice_cloned" | "badge_earned" | "system" | "tip";
  title: string;
  body: string;
  read: boolean;
  created_at: string;
  data?: Record<string, string>;
}

const typeIcons: Record<string, React.ReactNode> = {
  story_created: <BookOpen size={18} className="text-blue-500" />,
  voice_cloned: <Mic size={18} className="text-green-500" />,
  badge_earned: <Trophy size={18} className="text-amber-500" />,
  system: <Bell size={18} className="text-gray-500 dark:text-white/40" />,
  tip: <Star size={18} className="text-purple-500" />,
};

const typeColors: Record<string, string> = {
  story_created: "bg-blue-50",
  voice_cloned: "bg-green-50",
  badge_earned: "bg-amber-50",
  system: "bg-gray-50 dark:bg-white/[0.04]",
  tip: "bg-purple-50",
};

function timeAgo(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "Vừa xong";
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  return `${Math.floor(diff / 86400)} ngày trước`;
}

// Generate tips for new users
function generateTips(): Notification[] {
  return [
    {
      id: "tip-1",
      type: "tip",
      title: "💡 Mẹo: Clone giọng tốt hơn",
      body: "Ghi âm trong phòng yên tĩnh, giữ micro cách miệng 20cm, đọc rõ ràng và tự nhiên.",
      read: false,
      created_at: new Date().toISOString(),
    },
    {
      id: "tip-2",
      type: "tip",
      title: "💡 Mẹo: Viết truyện hay hơn",
      body: "Dùng AI Expert Panel khi tạo truyện — chuyên gia trẻ em sẽ giúp nội dung phù hợp lứa tuổi.",
      read: false,
      created_at: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: "tip-3",
      type: "tip",
      title: "💡 Mẹo: Truyện ru ngủ",
      body: "Bật chế độ Ru Ngủ — âm thanh nhẹ nhàng, tự tắt sau khi bé ngủ, có đếm ngược.",
      read: false,
      created_at: new Date(Date.now() - 7200000).toISOString(),
    },
  ];
}

export default function Notifications({ onBack, onNavigate }: NotificationsProps) {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (data && data.length > 0) {
        setNotifications(data as Notification[]);
      } else {
        // Show tips for new users
        setNotifications(generateTips());
      }
    } catch {
      setNotifications(generateTips());
    }
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => n.id === id ? { ...n, read: true } : n)
    );
    if (id.startsWith("tip-")) return;
    try {
      const supabase = createClient();
      await supabase.from("notifications").update({ read: true }).eq("id", id);
    } catch { /* ignore */ }
  };

  const markAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    if (!profile?.id) return;
    try {
      const supabase = createClient();
      await supabase.from("notifications").update({ read: true }).eq("user_id", profile.id);
    } catch { /* ignore */ }
  };

  const clearAll = () => setNotifications([]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-24">
      <div className="px-5 pt-14">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white dark:bg-white/[0.04] flex items-center justify-center shadow-sm">
            <ChevronLeft size={18} />
          </button>
          <div className="flex-1">
            <h2 className="text-[22px] font-black tracking-tight">Thông Báo</h2>
          </div>
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-accent text-white text-[11px] font-bold">
              {unreadCount}
            </span>
          )}
        </div>

        {/* Actions */}
        {notifications.length > 0 && (
          <div className="flex gap-2 mb-4">
            <button
              onClick={markAllRead}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-white/[0.04] text-[12px] font-semibold text-txt-secondary dark:text-white/50 shadow-sm"
            >
              <Check size={12} /> Đọc hết
            </button>
            <button
              onClick={clearAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-white/[0.04] text-[12px] font-semibold text-red-400 shadow-sm"
            >
              <Trash2 size={12} /> Xóa hết
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-accent" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-16">
            <Bell size={40} className="text-gray-300 mx-auto mb-3" />
            <p className="text-[14px] font-bold text-txt-secondary dark:text-white/50">Không có thông báo</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  markRead(n.id);
                  if (n.data?.storyId) onNavigate("player", { storyId: n.data.storyId });
                }}
                className={`w-full text-left rounded-xl p-3.5 flex items-start gap-3 transition-all ${
                  n.read ? "bg-white dark:bg-white/[0.04] opacity-70" : "bg-white dark:bg-white/[0.04] shadow-sm"
                }`}
              >
                <div className={`w-10 h-10 rounded-xl ${typeColors[n.type] || "bg-gray-50 dark:bg-white/[0.04]"} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                  {typeIcons[n.type] || <Bell size={18} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] font-bold ${n.read ? "text-txt-secondary dark:text-white/50" : "text-txt dark:text-white"}`}>
                    {n.title}
                  </p>
                  <p className="text-[12px] text-txt-secondary dark:text-white/50 mt-0.5 line-clamp-2">{n.body}</p>
                  <p className="text-[10px] text-txt-secondary dark:text-white/50 mt-1.5">{timeAgo(n.created_at)}</p>
                </div>
                {!n.read && (
                  <div className="w-2.5 h-2.5 rounded-full bg-accent mt-1.5 flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
