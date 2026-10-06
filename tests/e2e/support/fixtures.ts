import type { BrowserContext, Page } from "@playwright/test";

/** Must match tests/e2e/support/mock-supabase.mjs. */
export const MOCK_USER_ID = "00000000-0000-4000-8000-00000000e2e1";
export const MOCK_STORY_ID = "00000000-0000-4000-8000-0000000051a1";

const b64url = (v: string) => Buffer.from(v).toString("base64url");

/** Unsigned JWT accepted by the mock (only `sub` is checked). */
export function mockAccessToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  return [
    b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    b64url(JSON.stringify({ sub: MOCK_USER_ID, role: "authenticated", aud: "authenticated", exp, email: "e2e@kecon.test" })),
    "mock-signature",
  ].join(".");
}

/**
 * Sign in as the mock family: writes the @supabase/ssr session cookie
 * (`sb-127-auth-token`, base64-encoded JSON) and accepts the consent banner.
 */
export async function signInAsMockFamily(context: BrowserContext, baseURL: string): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const session = {
    access_token: mockAccessToken(),
    token_type: "bearer",
    expires_in: 3600 * 24,
    expires_at: exp,
    refresh_token: "mock-refresh-token",
    user: {
      id: MOCK_USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "e2e@kecon.test",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: "2025-01-01T12:00:00Z",
    },
  };
  await context.addCookies([
    {
      name: "sb-127-auth-token",
      value: `base64-${b64url(JSON.stringify(session))}`,
      url: baseURL,
      sameSite: "Lax",
    },
  ]);
  await context.addInitScript(() => {
    localStorage.setItem("kecon-consent-v1", JSON.stringify({ at: Date.now(), accepted: true }));
  });
}

/** Elements whose computed text/background is pure white (#FFF). */
export async function pureWhiteElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const WHITE = "rgb(255, 255, 255)";
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent?.trim());
      if (cs.backgroundColor === WHITE || (hasText && cs.color === WHITE)) {
        out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)}`);
      }
    }
    return out;
  });
}
