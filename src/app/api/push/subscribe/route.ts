import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api-validation";

const PushSubscriptionBody = z.object({
  endpoint: z.url().max(2048).refine((u) => u.startsWith("https://"), "Endpoint phải là HTTPS"),
  expirationTime: z.number().nullish(),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
});

const PushUnsubscribeBody = z.object({ endpoint: z.string().min(1).max(2048) });


/**
 * POST /api/push/subscribe — save a push subscription for the current user.
 * DELETE /api/push/subscribe — remove a push subscription.
 *
 * Stores subscriptions in the `push_subscriptions` table (created in migration 006).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(request, PushSubscriptionBody);
  if (!parsed.ok) return parsed.response;
  const subscription = parsed.data;
  const endpoint = subscription.endpoint;

  // Upsert: if the endpoint already exists, update the keys
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      keys: subscription.keys,
      subscription_json: subscription,
      user_agent: request.headers.get("user-agent") || "",
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    console.error("Push subscribe error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(request, PushUnsubscribeBody);
  if (!parsed.ok) return parsed.response;
  const { endpoint } = parsed.data;

  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);

  return Response.json({ ok: true });
}
