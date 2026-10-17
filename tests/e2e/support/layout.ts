import type { Page } from "@playwright/test";

export type SideOverflow = { overflow: number; offenders: string[] };

/**
 * Sideways overflow of the page in CSS px, measured against the layout viewport
 * (`documentElement.clientWidth`).
 *
 * Do not compare with `window.innerWidth`: with mobile emulation Chromium zooms
 * out to fit content that is wider than the screen, so `innerWidth` grows with
 * the content (measured 377 at a 360 px viewport) and `scrollWidth <= innerWidth`
 * can never fail.
 *
 * When the page overflows, `offenders` lists the outermost elements that stick
 * out past the right edge and are not inside a clipping/scrolling container.
 */
export function sideOverflow(page: Page): Promise<SideOverflow> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const width = root.clientWidth;
    const overflow = root.scrollWidth - width;
    const offenders: string[] = [];
    if (overflow > 1) {
      const clipped = (el: Element) => {
        for (let p = el.parentElement; p && p !== document.body && p !== root; p = p.parentElement)
          if (getComputedStyle(p).overflowX !== "visible") return true;
        return false;
      };
      const sticksOut = (el: Element) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && b.right > width + 1 && !clipped(el);
      };
      for (const el of Array.from(document.body.querySelectorAll("*"))) {
        if (!sticksOut(el)) continue;
        // Report the outermost offender only (its parent fits).
        if (el.parentElement && el.parentElement !== document.body && sticksOut(el.parentElement)) continue;
        const cls = String((el as HTMLElement).className || "").trim().split(/\s+/).slice(0, 4).join(".");
        const label = (el.getAttribute("aria-label") || el.getAttribute("data-testid") || (el as HTMLElement).innerText || "").replace(/\s+/g, " ").trim().slice(0, 40);
        offenders.push(`${el.tagName.toLowerCase()}${cls ? "." + cls : ""} right=${Math.round(el.getBoundingClientRect().right)} "${label}"`);
        if (offenders.length >= 8) break;
      }
    }
    return { overflow, offenders };
  });
}

/** True when the page cannot be scrolled sideways (1 px rounding allowed). */
export async function noSideScroll(page: Page): Promise<boolean> {
  return (await sideOverflow(page)).overflow <= 1;
}
