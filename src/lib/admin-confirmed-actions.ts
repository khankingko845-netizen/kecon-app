import { z } from "zod";
export const ADMIN_CONFIRMED_ACTIONS = [
  "role.change",
  "story.trash",
  "story.unpublish",
  "category.delete",
  "template.delete",
  "default_voice.delete",
] as const;
export type AdminConfirmedAction = (typeof ADMIN_CONFIRMED_ACTIONS)[number];
export const AdminActionSchema = z
  .object({
    action: z.enum(ADMIN_CONFIRMED_ACTIONS),
    ids: z
      .array(z.string().min(1).max(120))
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
    reason: z.string().trim().min(10).max(500),
    role: z
      .enum([
        "user",
        "super_admin",
        "admin",
        "ops",
        "editor",
        "moderator",
        "support",
        "analyst",
      ])
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.action === "category.delete" ||
      v.ids.every((id) => z.uuid().safeParse(id).success),
    "ID không hợp lệ",
  )
  .refine(
    (v) => v.action !== "role.change" || (v.ids.length === 1 && !!v.role),
    "Vai trò không hợp lệ",
  );
export async function confirmedAdminAction(
  action: AdminConfirmedAction,
  ids: string[],
  reason: string,
  role?: string,
) {
  const res = await fetch("/api/admin/confirmed-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ids, reason, role }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      data.error || "Thao tác chưa thành công. Tải lại để thử lại.",
    );
  return data.changed as number;
}
