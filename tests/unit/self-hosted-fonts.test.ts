import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// docs/self-hosted-fonts.md — the build must never depend on Google Fonts, and
// the hashed file names are what makes the year-long immutable cache safe.
const root = join(__dirname, "..", "..");
const css = readFileSync(join(root, "src/app/fonts.css"), "utf8");
const layout = readFileSync(join(root, "src/app/layout.tsx"), "utf8");
const dir = join(root, "public/fonts");
const files = readdirSync(dir).filter((f) => f.endsWith(".woff2"));
const cssUrls = [...css.matchAll(/url\((\/fonts\/[^)]+)\)/g)].map((m) => m[1]);
const preloaded = [...layout.matchAll(/"(\/fonts\/[^"]+\.woff2)"/g)].map((m) => m[1]);

function walk(d: string): string[] {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : /\.(ts|tsx|css)$/.test(e.name) ? [join(d, e.name)] : [],
  );
}

describe("self-hosted fonts", () => {
  it("nothing imports next/font/google or points at Google Fonts", () => {
    for (const f of walk(join(root, "src"))) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from\s+["']next\/font\/google["']|(url\(|@import\s+)["']?https?:\/\/fonts\.(googleapis|gstatic)\.com/);
    }
  });

  it("every @font-face file exists, is real WOFF2 and carries its own content hash", () => {
    expect(new Set(cssUrls).size).toBe(21);
    for (const url of new Set(cssUrls)) {
      const name = url.slice("/fonts/".length);
      expect(files, name).toContain(name);
      const data = readFileSync(join(dir, name));
      expect(data.subarray(0, 4).toString("latin1"), name).toBe("wOF2");
      const hash = name.match(/\.([0-9a-f]{8})\.woff2$/)?.[1];
      expect(hash, name).toBe(createHash("sha256").update(data).digest("hex").slice(0, 8));
    }
    // No orphan files shipped to every visitor's cache.
    expect(files.map((f) => `/fonts/${f}`).sort()).toEqual([...new Set(cssUrls)].sort());
  });

  it("keeps the UI v2 families, weights and Vietnamese coverage", () => {
    const faces = [...css.matchAll(/@font-face \{([^}]*)\}/g)].map((m) => m[1]);
    const weights = (family: string) =>
      [...new Set(faces.filter((f) => f.includes(`font-family: "${family}";`)).map((f) => f.match(/font-weight: (\d+)/)?.[1]))].sort();
    expect(weights("Nunito")).toEqual(["400", "600", "700", "800", "900"]);
    expect(weights("Baloo 2")).toEqual(["600", "700", "800"]);
    expect(weights("Be Vietnam Pro")).toEqual(["400", "500", "600", "700"]);
    for (const family of ["Nunito", "Baloo 2", "Be Vietnam Pro"]) {
      // ễ (U+1EC5) lives in the vietnamese subset of every family.
      expect(faces.some((f) => f.includes(`font-family: "${family}";`) && /U\+1ea0-1ef9/.test(f)), family).toBe(true);
      expect(css).toContain(`font-family: "${family} Fallback";`);
    }
    expect(faces.every((f) => !f.includes("font-family: \"") || f.includes("Fallback") || f.includes("font-display: swap;"))).toBe(true);
    expect(css).toMatch(/--font-nunito: "Nunito", "Nunito Fallback";/);
  });

  it("preloads exactly the kid-screen files next/font preloaded", () => {
    expect(preloaded).toHaveLength(4);
    for (const url of preloaded) expect(cssUrls).toContain(url);
    expect(preloaded.every((u) => /\/(nunito|baloo-2)-(latin|vietnamese)\./.test(u))).toBe(true);
  });
});
