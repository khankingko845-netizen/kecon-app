"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Search, BookOpen, Mic } from "@/components/ui/icons";
import TopBar from "@/components/ui/TopBar";
import { useAuth } from "@/lib/auth-context";
import {
 getAdminUsers,
 updateUserRole,
 type AdminUserRow,
} from "@/lib/db";
import { ROLE_LABELS, STAFF_ROLES, type UserRole } from "@/lib/admin-permissions";

interface AdminUsersProps {
 onBack: () => void;
 /** A-02: `roles.manage` (super admin). Defaults to the legacy check on the caller's role. */
 canManageRoles?: boolean;
}

const roleLabels: Record<string, string> = ROLE_LABELS;
const ROLE_OPTIONS: UserRole[] = ["user", ...STAFF_ROLES];

function roleBadge(role: string) {
 if (role === "super_admin") return "bg-violet-100 text-violet-700";
 if (role === "admin") return "bg-accent/10 text-accent";
 if (role !== "user") return "bg-blue-50 text-blue-700";
 return "bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-white/40";
}

export default function AdminUsers({ onBack, canManageRoles }: AdminUsersProps) {
 const { profile } = useAuth();
 const [users, setUsers] = useState<AdminUserRow[]>([]);
 const [loading, setLoading] = useState(true);
 const [search, setSearch] = useState("");
 const [working, setWorking] = useState<string | null>(null);
 const [roleError, setRoleError] = useState<string | null>(null);

 const isSuperAdmin = canManageRoles ?? profile?.role === "super_admin";

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

 const changeRole = async (u: AdminUserRow, role: UserRole) => {
 if (role === u.role) return;
 setWorking(u.id);
 setRoleError(null);
 try {
 await updateUserRole(u.id, role);
 setUsers((prev) =>
 prev.map((x) => (x.id === u.id ? { ...x, role } : x))
 );
 } catch (err) {
 setRoleError(err instanceof Error && err.message ? err.message : "Không đổi được vai trò");
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
 {roleError && (
 <div role="alert" className="bg-red-50 text-red-700 rounded-xl p-3 text-[12px] font-medium mb-3">
 {roleError}
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
 <label className="mt-2.5 flex items-center gap-2 text-[12px] font-bold text-txt-secondary dark:text-white/50">
 Vai trò
 <select
 value={u.role}
 disabled={working === u.id}
 onChange={(e) => changeRole(u, e.target.value as UserRole)}
 aria-label={`Vai trò của ${name}`}
 className="flex-1 min-h-[36px] rounded-lg border border-gray-200 bg-white px-2 text-[13px] font-bold text-txt disabled:opacity-60"
 >
 {ROLE_OPTIONS.map((r) => (
 <option key={r} value={r}>
 {ROLE_LABELS[r]}
 </option>
 ))}
 </select>
 </label>
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
