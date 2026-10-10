import { cookies } from "next/headers";
import AppShell from "@/components/AppShell";
import { hasAuthCookie } from "@/lib/auth-cookie";
import { EARLY_CLICK_SCRIPT } from "@/lib/early-clicks";

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SCREEN_FEATURE } from "@/lib/feature-flags";
import { canOpenServerFeatureScreen } from "@/lib/feature-flags-server";
import type { Screen } from "@/lib/types";

export default async function Page({searchParams}:{searchParams:Promise<{screen?:string}>}) {
  const {screen}=await searchParams;
  if(screen && (!Object.hasOwn(SCREEN_FEATURE,screen) || !await canOpenServerFeatureScreen(await createClient(),screen as Screen))) notFound();
  // UI-12: visitors without a session cookie always start on onboarding, so the
  // server renders it right away (LCP = first paint) instead of a splash that
  // waits for the JS bundle + auth check.
  const jar = await cookies();
  const signedOut = !hasAuthCookie(jar.getAll().map((c) => c.name));
  return (
    <>
      {/* Taps on the server-rendered onboarding before hydration are replayed (early-clicks.ts). */}
      {signedOut && <script dangerouslySetInnerHTML={{ __html: EARLY_CLICK_SCRIPT }} />}
      <AppShell signedOut={signedOut} initialScreen={screen as Screen | undefined} />
    </>
  );
}
