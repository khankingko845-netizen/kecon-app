import type { SupabaseClient } from "@supabase/supabase-js";
import { HouseholdContextSchema } from "@/lib/household-types";
import { getServiceClient } from "@/lib/server-settings";
/** Resolve before spending quota. Only a server-returned clone ID can be bound. */
export async function voiceClaimWriter(db: SupabaseClient) {
  const service = getServiceClient();
  if (!service) return null;
  const { data, error } = await db.rpc("my_household_context");
  if (error || !HouseholdContextSchema.safeParse(data).success) return null;
  const ready = await service.rpc("voice_provider_claims_ready");
  if (ready.error || ready.data !== true) return null;
  return service;
}
export async function recordClonedVoice(
  service: SupabaseClient,
  actor: string,
  voiceId: string,
): Promise<Response | null> {
  const { data, error } = await service.rpc("record_voice_provider_claim", {
    p_user: actor,
    p_voice: voiceId,
  });
  if (error || data !== true)
    return Response.json(
      {
        error:
          "Giọng đã được tạo tại nhà cung cấp nhưng chưa gắn được vào tài khoản. Chưa lưu giọng; cần kiểm tra lại, không tự tạo thêm bản nữa.",
        code: "voice_binding_pending",
      },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  return null;
}
