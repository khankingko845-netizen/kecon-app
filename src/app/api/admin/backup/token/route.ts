import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/admin-permissions";
import { auditAdmin } from "@/lib/admin-audit";
import { parseJsonBody } from "@/lib/api-validation";
import { backupRpcError, checkGithubToken, REASON_MAX, REASON_MIN, REPO_FORMAT, TOKEN_FORMAT, tokenKind } from "@/lib/admin-backup";

const Body = z
  .object({
    token: z.string().trim().min(24).max(255).regex(TOKEN_FORMAT, "Token GitHub phải bắt đầu bằng github_pat_ hoặc ghp_ và không có khoảng trắng"),
    reason: z.string().trim().min(REASON_MIN).max(REASON_MAX),
  })
  .strict();

/**
 * POST /api/admin/backup/token — Admin › Sao lưu (migration 040).
 * Body: { token, reason }. Checks the token with GitHub for the repo the
 * server's backup worker reports (private, push allowed, not expired), then
 * stores it in Supabase Vault through admin_set_backup_token (write-only:
 * only kind + last 4 come back). Needs backups.manage + secrets.manage.
 * The token is never logged or returned; the worker re-checks it on its next tick.
 */
export async function POST(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Forbidden" }, { status: 403 });
  const supabase = await createClient();
  const denied = (await requirePermission(supabase, "backups.manage")) ?? (await requirePermission(supabase, "secrets.manage"));
  if (denied) return denied;

  const parsed = await parseJsonBody(request, Body);
  if (!parsed.ok) return parsed.response;
  const { token, reason } = parsed.data;

  // The repo is whatever the server backs up to (server env), never something a page sends.
  const { data: status, error } = await supabase.rpc("admin_backup_status");
  if (error || !status) return Response.json({ error: backupRpcError(error) }, { status: error?.code === "42501" ? 403 : 502 });
  const repo = (status as { worker?: { repo?: unknown } }).worker?.repo;
  if (typeof repo !== "string" || !REPO_FORMAT.test(repo)) {
    return Response.json(
      { error: "Máy chủ sao lưu chưa báo về nên chưa biết repo để kiểm tra token. Đợi vài phút rồi thử lại.", code: "worker_unknown" },
      { status: 409 },
    );
  }

  const kind = tokenKind(token);
  const auditFailed = await auditAdmin(supabase, request, {
    action: "backup.token_check",
    targetType: "backup",
    targetId: repo,
    after: { kind, last4: `…${token.slice(-4)}` },
    reason,
  });
  if (auditFailed) return auditFailed;

  const check = await checkGithubToken(token, repo);
  if (!check.ok) return Response.json({ error: check.message, code: check.code }, { status: 422 });

  // audit: db-trigger backup_settings
  const { data: saved, error: saveError } = await supabase.rpc("admin_set_backup_token", { p_token: token, p_reason: reason });
  if (saveError || !saved) {
    return Response.json({ error: backupRpcError(saveError) }, { status: saveError?.code === "42501" ? 403 : 400 });
  }
  const s = saved as { last4: string; kind: string; set_at: string };
  return Response.json({ ok: true, last4: s.last4, kind: s.kind, set_at: s.set_at, expires_at: check.expiresAt, warnings: check.warnings });
}
