import { createClient } from "@/lib/supabase/server";
import {
  requirePermission,
  type AdminPermission,
} from "@/lib/admin-permissions";
import {
  AdminActionSchema,
  type AdminConfirmedAction,
} from "@/lib/admin-confirmed-actions";
import { requestIp } from "@/lib/admin-audit";
const PERMISSIONS: Record<AdminConfirmedAction, AdminPermission> = {
  "role.change": "roles.manage",
  "story.trash": "stories.write",
  "story.unpublish": "stories.write",
  "category.delete": "categories.manage",
  "template.delete": "templates.manage",
  "default_voice.delete": "voices.manage",
};
/** Audit comes from existing row triggers in the same caller/RLS transaction, once per target. */
export async function POST(request: Request) {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = AdminActionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Chọn đối tượng và nhập lý do 10–500 ký tự." },
      { status: 400 },
    );
  const { action, ids, reason, role } = parsed.data;
  const denied = await requirePermission(client, PERMISSIONS[action]);
  if (denied) return denied;
  // audit: db-trigger profiles
  // audit: db-trigger stories
  // audit: db-trigger story_categories
  // audit: db-trigger story_templates
  // audit: db-trigger default_voices
  const mutation = client.rpc("admin_confirmed_action", {
    p_action: action,
    p_ids: ids,
    p_reason: reason,
    p_role: role ?? null,
  });
  const ip = requestIp(request.headers);
  if (ip) mutation.setHeader("x-forwarded-for", ip);
  const agent = request.headers.get("user-agent");
  if (agent) mutation.setHeader("user-agent", agent.slice(0, 300));
  const { data, error } = await mutation;
  if (error)
    return Response.json(
      {
        error:
          error.code === "40001"
            ? "Đối tượng đã thay đổi hoặc không có quyền. Tải lại để thử lại."
            : "Không thực hiện được thao tác. Kiểm tra quyền, phiên và đối tượng.",
      },
      {
        status:
          error.code === "42501" ? 403 : error.code === "40001" ? 409 : 400,
      },
    );
  return Response.json({ changed: data });
}
