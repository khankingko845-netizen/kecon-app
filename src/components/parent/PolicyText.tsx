/**
 * T11 · Policy text renderer (consent gate + Bố mẹ › Chính sách & đồng ý).
 * The policy is stored as plain text with a tiny markup — "## " headings, "- "
 * bullets, blank lines between blocks — and rendered as React text only (no HTML).
 */
import type { ReactNode } from "react";

type Block = { kind: "h"; text: string } | { kind: "ul"; items: string[] } | { kind: "p"; text: string };

export function parsePolicyBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of text.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    let list: string[] | null = null;
    for (const line of lines) {
      if (line.startsWith("## ")) {
        list = null;
        blocks.push({ kind: "h", text: line.slice(3).trim() });
      } else if (line.startsWith("- ")) {
        if (!list) blocks.push({ kind: "ul", items: (list = []) });
        list.push(line.slice(2).trim());
      } else {
        list = null;
        blocks.push({ kind: "p", text: line });
      }
    }
  }
  return blocks;
}

export default function PolicyText({ text, className, headingLevel = 3 }: { text: string; className?: string; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const out: ReactNode[] = parsePolicyBlocks(text).map((b, i) => {
    if (b.kind === "h")
      return (
        <H key={i} className="mt-4 font-parent text-[15px] font-bold text-ink first:mt-0 dark:text-white">
          {b.text}
        </H>
      );
    if (b.kind === "ul")
      return (
        <ul key={i} className="mt-2 list-disc space-y-1.5 pl-5 marker:text-brand">
          {b.items.map((item, j) => (
            <li key={j}>{item}</li>
          ))}
        </ul>
      );
    return (
      <p key={i} className="mt-2">
        {b.text}
      </p>
    );
  });
  return <div className={`font-parent text-[14px] leading-relaxed text-ink-2 dark:text-white/70 ${className ?? ""}`}>{out}</div>;
}
