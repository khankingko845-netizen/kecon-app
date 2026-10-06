import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
// Only force HTTPS when the site is actually served over HTTPS (local `next start`
// on http://127.0.0.1 for E2E must keep working).
const isHttpsSite = (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");

/** Origin (and websocket origin) of the Supabase project the browser talks to. */
function supabaseOrigins(): string[] {
  try {
    const { origin } = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return [origin, origin.replace(/^http/, "ws")];
  } catch {
    return [];
  }
}

/**
 * Content-Security-Policy (T05). The browser only ever talks to our own
 * `/api/*` routes and Supabase — provider APIs are called server-side — so
 * `connect-src` is tight. Images/audio may come from Supabase Storage,
 * ElevenLabs previews or DALL·E CDNs, hence `https:` for img/media.
 * Uses the "without nonces" setup from the Next.js CSP guide so pages can
 * stay statically rendered.
 */
export function buildContentSecurityPolicy(): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "media-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...supabaseOrigins(), ...(isDev ? ["ws:"] : [])],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!isDev && isHttpsSite) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

export const securityHeaders: { key: string; value: string }[] = [
  { key: "Content-Security-Policy", value: buildContentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone: voice recording; camera: scanning books. Nothing else.
  { key: "Permissions-Policy", value: "microphone=(self), camera=(self), geolocation=(), payment=(), usb=()" },
  ...(!isDev && isHttpsSite ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  // Removed output: "export" to enable API routes and server features
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
