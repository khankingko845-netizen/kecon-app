"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Search, Shield, ShieldCheck, User as UserIcon, BookOpen, Mic } from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import { useAuth } from "@/lib/auth-context";
import {
 getAdminUsers,
 updateUserRole,
 type AdminUserRow,
} from "@/lib/db";

interface AdminUsersProps {
 onBack: () => void;
}

const roleLabels: Record<string, string> = {
 user: "Người dùng",
 admin: "Admin",
 super_admin: "Super Admin",
};

function roleBadge(role: string) {
 if (role === "super_admin") return "bg-violet-100 text-violet-700";
 if (role === "admin") return "bg-accent/10 text-accent";
 return "bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-white/40";
}

export default function AdminUsers({ onBack }: AdminUsersProps) {
 const { profile } = useAuth();
 const [users, setUsers] = useState<AdminUserRow[]>([]);
 const [loading, setLoading] = useState(true);
 const [search, setSearch] = useState("");
 const [working, setWorking] = useState<string | null>(null);

 const isSuperAdmin = profile?.role === "super_admin";

 const load = useCallback(async () => {
 setLoading(true);
 try {
 setUsers(await getAdminUsers());
 } catch {
 /* ignore */
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 load();
 }, [load]);

 const changeRole = async (
 u: AdminUserRow,
 role: "user" | "admin" | "super_admin"
 ) => {
 setWorking(u.id);
 try {
 await updateUserRole(u.id, role);
 setUsers((prev) =>
 prev.map((x) => (x.id === u.id ? { ...x, role } : x))
 );
 } catch {
 /* ignore */
 } finally {
 setWorking(null);
 }
 };

 const filtered = users.filter((u) => {
 if (!search.trim()) return true;
 const q = search.toLowerCase();
 return (
 (u.display_name || "").toLowerCase().includes(q) ||
 (u.family_name || "").toLowerCase().includes(q)
 );
 });

 return (
 <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-10">
 <TopBar title="Người dùng" onBack={onBack} />

 <div className="px-5 pt-1">
 <div className="bg-white dark:bg-white/[0.04] rounded-[14px] px-4 py-3 flex items-center gap-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none mb-3">
 <Search size={18} className="text-gray-400 dark:text-white/30" />
 <input
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder="Tìm theo tên..."
 className="flex-1 text-sm outline-none bg-transparent"
 />
 </div>

 {!isSuperAdmin && (
 <div className="bg-amber-50 text-amber-700 rounded-xl p-3 text-[12px] font-medium mb-3">
 Chỉ Super Admin mới có thể thay đổi quyền người dùng.
 </div>
 )}

 {loading ? (
 <div className="flex justify-center pt-16">
 <Loader2 size={24} className="animate-spin text-accent" />
 </div>
 ) : filtered.length === 0 ? (
 <div className="bg-white dark:bg-white/[0.04] rounded-2xl p-6 text-center text-[13px] text-txt-secondary dark:text-white/50">
 Không tìm thấy người dùng
 </div>
 ) : (
 <div className="space-y-2">
 {filtered.map((u) => {
 const name = u.family_name || u.display_name || "Người dùng";
 const isSelf = u.id === profile?.id;
 return (
 <div
 key={u.id}
 className="bg-white dark:bg-white/[0.04] rounded-2xl p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]"
 >
 <div className="flex items-center gap-3">
 <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-accent to-amber-400 flex items-center justify-center text-white font-bold text-lg">
 {name[0]?.toUpperCase() || "?"}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-1.5">
 <p className="text-[14px] font-bold truncate">{name}</p>
 {isSelf && (
 <span className="text-[10px] text-txt-secondary dark:text-white/50">(bạn)</span>
 )}
 </div>
 <div className="flex items-center gap-2.5 mt-0.5 text-[11px] text-txt-secondary dark:text-white/50">
 <span className="flex items-center gap-0.5">
 <BookOpen size={11} /> {u.storyCount}
 </span>
 <span className="flex items-center gap-0.5">
 <Mic size={11} /> {u.voiceCount}
 </span>
 {u.child_name && <span>Bé {u.child_name}</span>}
 </div>
 </div>
 <span className={`text-[10px] font-black px-2 py-1 rounded-md ${roleBadge(u.role)}`}>
 {roleLabels[u.role] || u.role}
 </span>
 </div>

 {isSuperAdmin && !isSelf && (
 <div className="flex gap-1.5 mt-2.5">
 <button
 onClick={() => changeRole(u, "user")}
 disabled={working === u.id || u.role === "user"}
 className="flex-1 py-1.5 rounded-lg bg-gray-100 dark:bg-white/[0.06] text-txt dark:text-white text-[12px] font-bold flex items-center justify-center gap-1 disabled:opacity-40"
 >
 <UserIcon size={12} /> User
 </button>
 <button
 onClick={() => changeRole(u, "admin")}
 disabled={working === u.id || u.role === "admin"}
 className="flex-1 py-1.5 rounded-lg bg-accent/10 text-accent text-[12px] font-bold flex items-center justify-center gap-1 disabled:opacity-40"
 >
 <Shield size={12} /> Admin
 </button>
 <button
 onClick={() => changeRole(u, "super_admin")}
 disabled={working === u.id || u.role === "super_admin"}
 className="flex-1 py-1.5 rounded-lg bg-violet-100 text-violet-700 text-[12px] font-bold flex items-center justify-center gap-1 disabled:opacity-40"
 >
 <ShieldCheck size={12} /> Super
 </button>
 </div>
 )}
 </div>
 );
 })}
 </div>
 )}
 </div>
 </div>
 );
}
