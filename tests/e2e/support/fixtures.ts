import { expect, type BrowserContext, type Page } from "@playwright/test";

/** Must match tests/e2e/support/mock-supabase.mjs. */
export const MOCK_USER_ID = "00000000-0000-4000-8000-00000000e2e1";
/** Family with parent PIN {@link MOCK_PIN} and a 30-minute daily limit. */
export const MOCK_PIN_USER_ID = "00000000-0000-4000-8000-00000000e2e2";
export const MOCK_PIN = "2468";
/** Family whose profile (child's age) can be edited — UI-13 "Lớn cùng bé". */
export const MOCK_AGE_USER_ID = "00000000-0000-4000-8000-00000000e2e3";
export const MOCK_PHOTO_USER_ID = "00000000-0000-4000-8000-00000000e2e7";
export const MOCK_VOICE_USER_ID = "00000000-0000-4000-8000-00000000e2e8";
export const MOCK_AVATAR_USER_ID = "00000000-0000-4000-8000-00000000e2e6";
/** The only mock account with `profiles.role = "admin"` (Admin v2 · A-01). */
export const MOCK_ADMIN_USER_ID = "00000000-0000-4000-8000-00000000e2e4";
/** Narrow staff role "editor" (Admin v2 · A-02). */
export const MOCK_EDITOR_USER_ID = "00000000-0000-4000-8000-00000000e2e5";
export const MOCK_MFA_USER_ID = "00000000-0000-4000-8000-00000000e2e9";
export const MOCK_STORY_ID = "00000000-0000-4000-8000-0000000051a1";

const MOCK_EMAILS: Record<string, string> = {
  [MOCK_USER_ID]: "e2e@kecon.test",
  [MOCK_PIN_USER_ID]: "e2e-pin@kecon.test",
  [MOCK_AGE_USER_ID]: "e2e-age@kecon.test",
  [MOCK_PHOTO_USER_ID]: "e2e-photo@kecon.test",
  [MOCK_VOICE_USER_ID]: "e2e-voice@kecon.test",
  [MOCK_AVATAR_USER_ID]: "e2e-avatar@kecon.test",
  [MOCK_MFA_USER_ID]: "e2e-mfa@kecon.test",
  [MOCK_ADMIN_USER_ID]: "e2e-admin@kecon.test",
  [MOCK_EDITOR_USER_ID]: "e2e-editor@kecon.test",
};

const b64url = (v: string) => Buffer.from(v).toString("base64url");

/** Unsigned JWT accepted by the mock (only `sub` is checked). */
export function mockAccessToken(sub: string = MOCK_USER_ID, email = "e2e@kecon.test", adminReady = true): string {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  return [
    b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    b64url(JSON.stringify({ sub, role: "authenticated", aud: "authenticated", exp, email, session_id:crypto.randomUUID(),aal:adminReady?"aal2":"aal1",amr:[{method:adminReady?"totp":"password",timestamp:Math.floor(Date.now()/1000)}],e2e_admin_ready:adminReady })),
    "mock-signature",
  ].join(".");
}

/**
 * Sign in as the mock family: writes the @supabase/ssr session cookie
 * (`sb-127-auth-token`, base64-encoded JSON) and accepts the consent banner.
 */
export async function signInAsMockFamily(
  context: BrowserContext,
  baseURL: string,
  { userId = MOCK_USER_ID, adminReady = true }: { userId?: string;adminReady?:boolean } = {}
): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const email = MOCK_EMAILS[userId] ?? "e2e@kecon.test";
  const session = {
    access_token: mockAccessToken(userId, email, adminReady),
    token_type: "bearer",
    expires_in: 3600 * 24,
    expires_at: exp,
    refresh_token: "mock-refresh-token",
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email,
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

/**
 * Pass the parent gate (T19) as an adult: answers the multiplication shown
 * when no PIN is set, or types `pin` on the keypad.
 */
export async function passParentGate(page: Page, pin?: string): Promise<void> {
  const gate = page.locator("[data-parent-gate]");
  await expect(gate).not.toHaveAttribute("data-parent-gate", "loading");
  if (pin) {
    for (const d of pin) await gate.getByRole("button", { name: d, exact: true }).click();
  } else {
    const question = await gate.locator("[data-challenge]").getAttribute("data-challenge");
    const [a, b] = (question ?? "").split("×").map((n) => Number(n.trim()));
    await gate.getByLabel("Kết quả phép tính").fill(String(a * b));
  }
  await gate.getByRole("button", { name: "Mở khoá" }).click();
  await expect(gate).toHaveCount(0);
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
