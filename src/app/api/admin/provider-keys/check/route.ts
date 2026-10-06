import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/admin-permissions";
import { auditAdmin } from "@/lib/admin-audit";
import { parseJsonBody } from "@/lib/api-validation";
import { getServiceClient, resolveFishAudioModel } from "@/lib/server-settings";
import { checkProviderKey } from "@/lib/provider-key-check";
import { voiceKeyPool } from "@/lib/key-pool";
import { VOICE_PROVIDERS, type ProviderKeyCheckResult, type ProviderKeyRow } from "@/lib/provider-keys";

const CheckBody = z
  .object({
    id: z.uuid().optional(),
    provider: z.enum(VOICE_PROVIDERS).optional(),
  })
  .refine((b) => b.id || b.provider, "Cần id hoặc provider");

/**
 * POST /api/admin/provider-keys/check — Admin v2 · A-04b.
 * Body: { id } (one key) or { provider } (every key of that pool).
 * Checks each key against its provider on the server (key from Vault via the
 * service role), stores status + credit (report_provider_key) and returns them.
 * Never returns a key; errors are scrubbed.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const denied = await requirePermission(supabase, "secrets.manage");
  if (denied) return denied;

  const parsed = await parseJsonBody(request, CheckBody);
  if (!parsed.ok) return parsed.response;
  const { id, provider } = parsed.data;

  const service = getServiceClient();
  if (!service) {
    return Response.json({ error: "Máy chủ chưa cấu hình SUPABASE_SERVICE_ROLE_KEY nên không đọc được key" }, { status: 503 });
  }

  // The admin's own session: list_provider_keys() enforces secrets.manage again in the DB.
  const { data, error } = await supabase.rpc("list_provider_keys");
  if (error) return Response.json({ error: error.message }, { status: 403 });
  const targets = ((data ?? []) as ProviderKeyRow[]).filter((r) => (id ? r.id === id : r.provider === provider)).slice(0, 50);
  if (id && !targets.length) return Response.json({ error: "Không tìm thấy key" }, { status: 404 });

  const auditFailed = await auditAdmin(supabase, request, {
    action: "provider_key.check",
    targetType: "provider_key",
    targetId: id ?? provider ?? null,
    after: { keys: targets.map((t) => `${t.provider} …${t.last4 ?? "????"}`) },
  });
  if (auditFailed) return auditFailed;

  const fishModel = await resolveFishAudioModel();
  const results: ProviderKeyCheckResult[] = [];
  const queue = [...targets];
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        const { data: secret } = await service.rpc("get_provider_key_secret", { p_id: row.id });
        if (typeof secret !== "string" || !secret) {
          results.push({ id: row.id, provider: row.provider, status: row.status, ok: false, error: "Không đọc được key trong Vault", credit: null });
          continue;
        }
        const check = await checkProviderKey(row.provider, secret, { fishModel });
        await service.rpc("report_provider_key", {
          p_id: row.id,
          p_status: check.status,
          p_error: check.error,
          p_cooldown_until: check.cooldownUntil,
          p_credit: check.credit,
        });
        results.push({
          id: row.id,
          provider: row.provider,
          status: check.status ?? row.status,
          ok: check.status === "active",
          error: check.error,
          credit: check.credit,
        });
      }
    })
  );
  voiceKeyPool.invalidate();
  results.sort((a, b) => targets.findIndex((t) => t.id === a.id) - targets.findIndex((t) => t.id === b.id));
  return Response.json({ results });
}
