/**
 * UI-12 (hiệu năng): the server only needs to know *whether* a Supabase
 * session cookie exists to pick the first paint — onboarding for visitors,
 * the "Đóm đang thức dậy…" splash for families (the client then verifies the
 * session as before). The value is never parsed or trusted here.
 *
 * @supabase/ssr names it `sb-<project-ref>-auth-token`, split into `.0`, `.1`…
 * chunks when the session is large.
 */
const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

export function hasAuthCookie(cookieNames: Iterable<string>): boolean {
  for (const name of cookieNames) if (AUTH_COOKIE.test(name)) return true;
  return false;
}
