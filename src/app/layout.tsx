import type { Metadata, Viewport } from "next";
import "./fonts.css";
import "./globals.css";

// UI v2 typography (docs/design/ui-v2): Nunito for child UI, Baloo 2 for
// display headings, Be Vietnam Pro for parent/admin screens. All three ship
// the Vietnamese subset so stacked diacritics (ễ, ặ, ẫ) render correctly.
// Self-hosted (src/app/fonts.css + public/fonts, docs/self-hosted-fonts.md):
// the build no longer downloads from Google Fonts, so CI can't fail on it.
// Preload what the kid screens paint first — Nunito + Baloo 2, latin +
// vietnamese — exactly what next/font preloaded. Be Vietnam Pro (parent/admin
// only, UI-12) is not preloaded.
const PRELOADED_FONTS = [
  "/fonts/nunito-vietnamese.d107f726.woff2",
  "/fonts/nunito-latin.20fc9b6f.woff2",
  "/fonts/baloo-2-vietnamese.c8024507.woff2",
  "/fonts/baloo-2-latin.2e9420db.woff2",
];

export const metadata: Metadata = {
  title: "KểCon — Giọng Kể Của Bố Mẹ",
  description: "Ứng dụng kể chuyện bằng giọng nói của bố mẹ cho bé",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // UI-12: no maximumScale / userScalable=no — parents must be able to zoom (WCAG 1.4.4).
  themeColor: "#FFF8EE",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <head>
        {/* Real <link> tags: ReactDOM.preload() from this layout only reached the RSC payload, not the HTML head. */}
        {PRELOADED_FONTS.map((href) => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
      </head>
      <body className="min-h-full">
        {children}
      </body>
    </html>
  );
}
