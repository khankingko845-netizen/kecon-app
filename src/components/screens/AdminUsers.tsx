"use client";
import { useToast } from "@/components/ui/Toast";
import { useCallback, useEffect, useState } from "react";
import {
  AdminHeader,
  AdminTable,
  AdminDrawer,
  AdminFilters,
} from "@/components/admin/AdminUi";
import { useAdminConfirm } from "@/components/admin/AdminConfirm";
import { confirmedAdminAction } from "@/lib/admin-confirmed-actions";
import { getAdminUsers, type AdminUserRow } from "@/lib/db";
import { useAuth } from "@/lib/auth-context";
import {
  ROLE_LABELS,
  STAFF_ROLES,
  type UserRole,
} from "@/lib/admin-permissions";
const OPTIONS: UserRole[] = ["user", ...STAFF_ROLES];
export default function AdminUsers({
  onBack,
  canManageRoles,
}: {
  onBack: () => void;
  canManageRoles?: boolean;
}) {
  const { profile } = useAuth();
  const confirm = useAdminConfirm();
 const { toast } = useToast();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const canEdit = canManageRoles ?? profile?.role === "super_admin";
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await getAdminUsers());
    } catch {
      setError("Không tải được người dùng. Bấm Thử lại.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function changeRole(u: AdminUserRow, role: UserRole) {
    if (role === u.role || working) return;
    const name = u.family_name || u.display_name || "Người dùng";
    const reason = await confirm({
      title: `Đổi vai trò của ${name}?`,
      description: `${ROLE_LABELS[u.role as UserRole] || u.role} → ${ROLE_LABELS[role]}. Quyền truy cập thay đổi ngay sau khi xác nhận.`,
      confirmLabel: "Đổi vai trò",
    });
    if (!reason) return;
    setWorking(u.id);
    setError(null);
    try {
      await confirmedAdminAction("role.change", [u.id], reason, role);
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role } : x)));
      toast("success", "Đã đổi vai trò người dùng.");
    } catch (e) {
      toast("error", "Chưa đổi được vai trò. Kiểm tra lỗi và thử lại.");
      setError(e instanceof Error ? e.message : "Không đổi được vai trò");
    } finally {
      setWorking(null);
    }
  }
  const rows = users.filter(
    (u) =>
      (!roleFilter || u.role === roleFilter) &&
      ((u.family_name || "") + " " + (u.display_name || ""))
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <div className="min-h-screen bg-parent-bg pb-10">
      <AdminHeader title="Người dùng" onBack={onBack} />
      <div className="space-y-5 p-5">
        <AdminFilters label="Bộ lọc người dùng">
          <label className="min-w-0 flex-1 text-sm font-semibold">
            Tìm người dùng
            <input
              aria-label="Tìm người dùng"
              placeholder="Tìm theo tên..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="admin-input mt-2 w-full"
            />
          </label>
          <label className="text-sm font-semibold">
            Lọc vai trò
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="admin-input mt-2 block"
            >
              <option value="">Tất cả</option>
              {OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
        </AdminFilters>
        {!canEdit && (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-ink-2">
            Chỉ Super Admin mới có thể thay đổi quyền người dùng.
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
            <button className="admin-button ml-3" onClick={load}>
              Thử lại
            </button>
          </div>
        )}
        {loading ? (
          <p role="status">Đang tải người dùng…</p>
        ) : rows.length === 0 ? (
          <p className="rounded-xl bg-white p-6 text-sm text-ink-2">
            Không tìm thấy người dùng
          </p>
        ) : (
          <AdminTable
            caption="Danh sách người dùng"
            headers={[
              "Gia đình / tên hiển thị",
              "Vai trò",
              "Truyện / giọng",
              "Thao tác",
            ]}
          >
            {rows.map((u) => {
              const name = u.family_name || u.display_name || "Người dùng";
              const self = u.id === profile?.id;
              return (
                <tr key={u.id}>
                  <td className="min-w-40 font-semibold">
                    {name}
                    {self && <span className="ml-2 text-ink-2">(bạn)</span>}
                  </td>
                  <td>
                    <span className="inline-flex rounded-lg bg-brand-soft px-2 py-1 font-medium text-brand-ink">
                      {ROLE_LABELS[u.role as UserRole] || u.role}
                    </span>
                    {canEdit && !self && (
                      <select
                        aria-label={`Vai trò của ${name}`}
                        value={u.role}
                        disabled={working !== null}
                        onChange={(e) =>
                          void changeRole(u, e.target.value as UserRole)
                        }
                        className="admin-input mt-2 block min-w-36"
                      >
                        {OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    {u.storyCount} truyện
                    <br />
                    {u.voiceCount} giọng
                  </td>
                  <td>
                    <button
                      className="admin-button"
                      onClick={() => setSelected(u)}
                      aria-label={`Chi tiết ${name}`}
                    >
                      Chi tiết
                    </button>
                  </td>
                </tr>
              );
            })}
          </AdminTable>
        )}
        <p className="text-sm text-ink-2">
          {rows.length} người dùng trong danh sách đã tải. Đây chưa phải tra cứu
          hộ gia đình A-12.
        </p>
      </div>
      <AdminDrawer
        title="Chi tiết người dùng"
        open={!!selected}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-ink-2">Tên hiển thị</dt>
              <dd className="mt-1 font-semibold">
                {selected.display_name || "Chưa đặt"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-2">Tên gia đình</dt>
              <dd className="mt-1 font-semibold">
                {selected.family_name || "Chưa đặt"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-2">Vai trò</dt>
              <dd className="mt-1">
                {ROLE_LABELS[selected.role as UserRole] || selected.role}
              </dd>
            </div>
            <div>
              <dt className="text-ink-2">Nội dung</dt>
              <dd className="mt-1">
                {selected.storyCount} truyện · {selected.voiceCount} giọng
              </dd>
            </div>
          </dl>
        )}
      </AdminDrawer>
    </div>
  );
}
