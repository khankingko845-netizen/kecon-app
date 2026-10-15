import { test, expect } from "@playwright/test";

// docs/self-hosted-fonts.md — fonts come from /fonts/ (no Google Fonts at build
// or run time), the kid-screen files are preloaded in the HTML head and cached
// for a year, and Vietnamese renders in Nunito / Baloo 2.
const PRELOADED = [
  "/fonts/nunito-vietnamese.d107f726.woff2",
  "/fonts/nunito-latin.20fc9b6f.woff2",
  "/fonts/baloo-2-vietnamese.c8024507.woff2",
  "/fonts/baloo-2-latin.2e9420db.woff2",
];

test("font tự host: preload trong HTML, cache 1 năm, không gọi Google Fonts", async ({ page, request }) => {
  const html = await (await request.get("/")).text();
  const head = html.slice(0, html.indexOf("</head>"));
  for (const href of PRELOADED) {
    const tag = head.match(new RegExp(`<link[^>]*href="${href.replace(/[.]/g, "\\.")}"[^>]*>`))?.[0] ?? "";
    expect(tag, href).toMatch(/rel="preload"/);
    expect(tag, href).toMatch(/as="font"/);
    expect(tag, href).toMatch(/crossorigin/i);
  }
  expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);

  const font = await request.get(PRELOADED[1]);
  expect(font.status()).toBe(200);
  expect(font.headers()["content-type"]).toBe("font/woff2");
  expect(font.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");

  const external: string[] = [];
  page.on("request", (r) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) external.push(r.url());
  });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const facts = await page.evaluate(async () => {
    await document.fonts.load('800 24px "Baloo 2"', "Kể chuyện ễ ặ");
    await document.fonts.load('400 16px "Nunito"', "Kể chuyện ễ ặ");
    return {
      body: getComputedStyle(document.body).fontFamily,
      nunito: document.fonts.check('400 16px "Nunito"', "Kể chuyện ễ ặ"),
      baloo: document.fonts.check('800 24px "Baloo 2"', "Kể chuyện ễ ặ"),
      loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
    };
  });
  expect(facts.body.startsWith("Nunito")).toBe(true);
  expect(facts.nunito).toBe(true);
  expect(facts.baloo).toBe(true);
  expect(facts.loaded).toContain("Nunito");
  expect(facts.loaded).toContain("Baloo 2");
  expect(external).toEqual([]);
});
