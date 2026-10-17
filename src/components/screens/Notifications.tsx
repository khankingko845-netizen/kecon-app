"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, Check, BookOpen, Mic, Star, Loader2, Moon } from "@/components/ui/icons";
import ParentHeader from "@/components/parent/ParentHeader";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import type { Screen } from "@/lib/types";

interface NotificationsProps {
 onNavigate: (screen: Screen, data?: Record<string, string>) => void;
 onBack: () => void;
}

interface Notification {
 id: string;
 type: "story_created" | "voice_cloned" | "system" | string;
 title: string;
 body: string;
 read: boolean;
 created_at: string;
 data?: Record<string, string>;
}

const typeIcons: Record<string, React.ReactNode> = {
 story_created: <BookOpen size={18} className="text-blue-500" />,
 voice_cloned: <Mic size={18} className="text-green-500" />,
 system: <Bell size={18} className="text-gray-500 dark:text-white/40" />,
};

const typeColors: Record<string, string> = {
 story_created: "bg-blue-50",
 voice_cloned: "bg-green-50",
 system: "bg-gray-50 dark:bg-white/[0.04]",
};

/** Static advice for parents. Not notifications: no time, no unread state, nothing to tap. */
const PARENT_TIPS = [
 { icon: <Mic size={18} className="text-green-600" />, title: "Ghi giọng bố mẹ rõ hơn", body: "Ghi âm trong phòng yên tĩnh, để điện thoại cách miệng khoảng 20 cm, đọc chậm và tự nhiên." },
 { icon: <Star size={18} className="text-purple-500" />, title: "Truyện hợp lứa tuổi", body: "Khi tạo truyện, chọn đúng tuổi của bé để câu chữ ngắn và dễ hiểu." },
 { icon: <Moon size={18} className="text-indigo-500" />, title: "Giờ đi ngủ", body: "Đặt giờ đi ngủ trong Kiểm soát phụ huynh: trong khung giờ đó app của bé tự khoá." },
];

function timeAgo(dateStr: string) {
 const d = new Date(dateStr);
 const diff = Math.floor((Date.now() - d.getTime()) / 1000);
 if (diff < 60) return "Vừa xong";
 if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
 if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
 return `${Math.floor(diff / 86400)} ngày trước`;
}

export default function Notifications({ onBack, onNavigate }: NotificationsProps) {
 const { profile } = useAuth();
 const [notifications, setNotifications] = useState<Notification[]>([]);
 const [loading, setLoading] = useState(true);
 const [failed, setFailed] = useState(false);

 const profileId = profile?.id;
 const load = useCallback(async () => {
 if (!profileId) return;
 setLoading(true);
 setFailed(false);
 try {
 const supabase = createClient();
 const { data, error } = await supabase
 .from("notifications")
 .select("*")
 .eq("user_id", profileId)
 .order("created_at", { ascending: false })
 .limit(50);
 if (error) throw error;
 setNotifications((data ?? []) as Notification[]);
 } catch {
 setFailed(true);
 }
 setLoading(false);
 }, [profileId]);

 useEffect(() => { load(); }, [load]);

 const markRead = async (id: string) => {
 setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
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

 const unreadCount = notifications.filter((n) => !n.read).length;

 return (
 <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-24">
 <ParentHeader title="Thông báo" onBack={onBack} />
 <div className="px-5 pt-2">
 {!loading && unreadCount > 0 && (
 <div className="mb-3 flex items-center justify-between gap-3">
 <p className="font-parent text-[14px] font-semibold text-ink-2 dark:text-white/60">{unreadCount} thông báo chưa đọc</p>
 <button
 type="button"
 onClick={markAllRead}
 className="flex min-h-11 items-center gap-1.5 rounded-xl bg-white px-3.5 text-[14px] font-semibold text-ink shadow-sm dark:bg-white/[0.04] dark:text-white/70"
 >
 <Check size={16} /> Đánh dấu đã đọc
 </button>
 </div>
 )}

 {loading ? (
 <div className="flex justify-center py-12">
 <Loader2 size={24} className="animate-spin text-accent" />
 </div>
 ) : notifications.length === 0 ? (
 <div className="rounded-2xl bg-white px-4 py-6 text-center shadow-sm dark:bg-white/[0.04]" data-testid="notifications-empty">
 <Bell size={36} className="mx-auto mb-2 text-gray-300" />
 <p className="font-parent text-[15px] font-bold text-ink dark:text-white">{failed ? "Chưa tải được thông báo" : "Chưa có thông báo"}</p>
 <p className="mt-1 font-parent text-[13px] text-ink-2 dark:text-white/50">
 {failed ? "Kiểm tra mạng rồi mở lại màn này nhé." : "Khi có truyện mới hoặc giọng đọc xong, thông báo sẽ hiện ở đây."}
 </p>
 </div>
 ) : (
 <ul className="space-y-2">
 {notifications.map((n) => (
 <li key={n.id}>
 <button
 type="button"
 onClick={() => {
 markRead(n.id);
 if (n.data?.storyId) onNavigate("player", { storyId: n.data.storyId });
 }}
 className={`flex w-full items-start gap-3 rounded-xl p-3.5 text-left transition-all ${
 n.read ? "bg-white opacity-70 dark:bg-white/[0.04]" : "bg-white shadow-sm dark:bg-white/[0.04]"
 }`}
 >
 <div className={`mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${typeColors[n.type] || "bg-gray-50 dark:bg-white/[0.04]"}`}>
 {typeIcons[n.type] || <Bell size={18} />}
 </div>
 <div className="min-w-0 flex-1">
 <p className={`text-[14px] font-bold ${n.read ? "text-txt-secondary dark:text-white/50" : "text-txt dark:text-white"}`}>{n.title}</p>
 <p className="mt-0.5 line-clamp-2 text-[13px] text-txt-secondary dark:text-white/50">{n.body}</p>
 <p className="mt-1.5 text-[12px] text-txt-secondary dark:text-white/50">{timeAgo(n.created_at)}</p>
 </div>
 {!n.read && <span className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-accent" aria-label="Chưa đọc" role="img" />}
 </button>
 </li>
 ))}
 </ul>
 )}

 <section className="mt-6" aria-labelledby="parent-tips">
 <h2 id="parent-tips" className="mb-2 font-parent text-[16px] font-bold text-ink dark:text-white">Mẹo cho bố mẹ</h2>
 <ul className="space-y-2">
 {PARENT_TIPS.map((t) => (
 <li key={t.title} className="flex items-start gap-3 rounded-xl bg-white p-3.5 shadow-sm dark:bg-white/[0.04]">
 <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-purple-50">{t.icon}</div>
 <div className="min-w-0 flex-1">
 <p className="text-[14px] font-bold text-txt dark:text-white">{t.title}</p>
 <p className="mt-0.5 text-[13px] text-txt-secondary dark:text-white/50">{t.body}</p>
 </div>
 </li>
 ))}
 </ul>
 </section>
 </div>
 </div>
 );
}
