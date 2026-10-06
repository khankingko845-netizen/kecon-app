import { cookies } from "next/headers";
import AppShell from "@/components/AppShell";
import { hasAuthCookie } from "@/lib/auth-cookie";
import { EARLY_CLICK_SCRIPT } from "@/lib/early-clicks";

export default async function Page() {
  // UI-12: visitors without a session cookie always start on onboarding, so the
  // server renders it right away (LCP = first paint) instead of a splash that
  // waits for the JS bundle + auth check.
  const jar = await cookies();
  const signedOut = !hasAuthCookie(jar.getAll().map((c) => c.name));
  return (
    <>
      {/* Taps on the server-rendered onboarding before hydration are replayed (early-clicks.ts). */}
      {signedOut && <script dangerouslySetInnerHTML={{ __html: EARLY_CLICK_SCRIPT }} />}
      <AppShell signedOut={signedOut} />
    </>
  );
}
