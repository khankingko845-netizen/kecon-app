import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasAuthCookie } from "@/lib/auth-cookie";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css|json)$/.test(name) ? [path] : [];
  });
}

describe("UI-12 · dấu tiếng Việt", () => {
  it("mọi chuỗi trong src/ ở dạng Unicode dựng sẵn (NFC)", () => {
    // NFD text ("e" + combining marks) renders with misplaced/stacked diacritics
    // in some fonts, breaks search and is read letter-by-letter by screen readers.
    const offenders = sourceFiles("src").flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ file, line: i + 1, text: line }))
        .filter(({ text }) => text !== text.normalize("NFC"))
        .map(({ file, line }) => `${file}:${line}`)
    );
    expect(offenders).toEqual([]);
  });
});

describe("UI-12 · hasAuthCookie (chọn màn đầu tiên phía server)", () => {
  it("nhận cookie phiên của @supabase/ssr, kể cả dạng chia nhỏ", () => {
    expect(hasAuthCookie(["sb-127-auth-token"])).toBe(true);
    expect(hasAuthCookie(["theme", "sb-abcd1234-auth-token.0", "sb-abcd1234-auth-token.1"])).toBe(true);
  });

  it("khách chưa đăng nhập → false", () => {
    expect(hasAuthCookie([])).toBe(false);
    expect(hasAuthCookie(["kecon-consent", "sb-127-auth-token-code-verifier-x", "auth-token"])).toBe(false);
  });
});
