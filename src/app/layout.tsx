import type { Metadata, Viewport } from "next";
import { Baloo_2, Be_Vietnam_Pro, Nunito } from "next/font/google";
import "./globals.css";

// UI v2 typography (docs/design/ui-v2): Nunito for child UI, Baloo 2 for
// display headings, Be Vietnam Pro for parent/admin screens. All three ship
// the Vietnamese subset so stacked diacritics (ễ, ặ, ẫ) render correctly.
const nunito = Nunito({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "600", "700", "800", "900"],
  variable: "--font-nunito",
  display: "swap",
});
const baloo = Baloo_2({
  subsets: ["latin", "vietnamese"],
  weight: ["600", "700", "800"],
  variable: "--font-baloo",
  display: "swap",
});
const beVietnam = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-be-vietnam",
  display: "swap",
  // UI-12: parent/admin screens only — don't spend the first-load bandwidth
  // on 8 static font files the kid screens never show.
  preload: false,
});

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
    <html lang="vi" className={`${nunito.variable} ${baloo.variable} ${beVietnam.variable}`}>
      <body className="min-h-full">
        {children}
      </body>
    </html>
  );
}
