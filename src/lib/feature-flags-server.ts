import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseFeatureFlags,
  API_FEATURE,
  SCREEN_FEATURE,
  type FeatureKey,
  type FeatureFlags,
} from "@/lib/feature-flags";
import { hasPermission } from "@/lib/admin-permissions";
import type { Screen } from "@/lib/types";
export async function readFeatureFlags(
  db: SupabaseClient,
): Promise<FeatureFlags> {
  const { data, error } = await db.rpc("public_feature_flags");
  if (error || !data || typeof data !== "object")
    throw Error("Feature flags unavailable");
  return parseFeatureFlags(data);
}
export async function guardFeature(db: SupabaseClient, key: FeatureKey) {
  try {
    const flags = await readFeatureFlags(db);
    if (!flags[key])
      return Response.json({ error: "Not found" }, { status: 404 });
  } catch {
    return Response.json(
      { error: "Không kiểm tra được tính năng; vui lòng thử lại" },
      { status: 503 },
    );
  }
  return null;
}
export async function canOpenServerFeatureScreen(
  db: SupabaseClient,
  screen: Screen,
) {
  const key = SCREEN_FEATURE[screen];
  if (!key) return false;
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return false;
  try {
    const flags = await readFeatureFlags(db);
    return (
      flags[key] &&
      (key !== "advanced_authoring" ||
        (await hasPermission(db, "stories.write")))
    );
  } catch {
    return false;
  }
}
/** Gate before quota/meter/provider spend; bypassing the client UI never enables a switch. */
export async function guardMeasuredFeature(
  db: SupabaseClient,
  feature: string,
  body: unknown,
) {
  const key = API_FEATURE[feature];
  if (key) {
    const denied = await guardFeature(db, key);
    if (denied) return denied;
  }
  const b =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  // Direct translate is wholly optional. Every other paid caller explicitly declaring non-vi is gated too.
  const locale = b.language;
  // Admin auditions must remain usable while the family multilingual switch is off. No other paid work bypasses flags.
  if (feature === "voice.preview" && await hasPermission(db,"voices.manage")) return null;
  if (typeof locale === "string" && locale && locale !== "vi")
    return guardFeature(db, "multilingual");
  return null;
}
