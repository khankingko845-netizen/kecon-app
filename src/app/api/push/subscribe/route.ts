import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  const subscription = await request.json();
  const endpoint = subscription.endpoint;

  if (!endpoint) {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }

  // Upsert: if the endpoint already exists, update the keys
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      keys: subscription.keys || {},
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

  const { endpoint } = await request.json();

  if (!endpoint) {
    return Response.json({ error: "Missing endpoint" }, { status: 400 });
  }

  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);

  return Response.json({ ok: true });
}
