/**
 * Admin v2 · A-01 — server-side gate for `/admin`. Runs in the server component
 * before anything admin-related is rendered: visitors and ordinary families get
 * the regular 404 (`notFound()`), so the route doesn't even reveal it exists.
 * The client-side checks and RLS `is_admin()` stay as defense in depth.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasAuthCookie } from "@/lib/auth-cookie";
import { ADMIN_ROLES } from "@/lib/byo-key";
import { createClient } from "@/lib/supabase/server";

export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface AdminViewer {
  id: string;
  email: string | null;
  role: AdminRole;
}

export function isAdminRole(role: unknown): role is AdminRole {
  return typeof role === "string" && (ADMIN_ROLES as readonly string[]).includes(role);
}

/** Verified user (GoTrue `getUser`, not the unverified cookie) + role from `profiles`. */
export async function resolveAdminViewer(supabase: SupabaseClient): Promise<AdminViewer | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile || !isAdminRole(profile.role)) return null;
  return { id: user.id, email: user.email ?? null, role: profile.role };
}

/** Cached per request, so `generateMetadata` and the page share one lookup. */
export const getAdminViewer = cache(async (): Promise<AdminViewer | null> => {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  const jar = await cookies();
  // No session cookie → no network round trip at all.
  if (!hasAuthCookie(jar.getAll().map((c) => c.name))) return null;
  try {
    return await resolveAdminViewer(await createClient());
  } catch {
    return null;
  }
});
