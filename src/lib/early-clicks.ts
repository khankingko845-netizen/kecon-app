/**
 * UI-12 follow-up — the signed-out onboarding is rendered on the server so it
 * paints ~1 s after navigation, but its buttons only work once React hydrates
 * (~1.5–2.5 s later on Slow 4G). Taps in that window used to be lost.
 *
 * {@link EARLY_CLICK_SCRIPT} runs inline before the bundle: it remembers taps
 * on `[data-early-click="…"]` controls. Once hydrated, the screen calls
 * {@link takeEarlyClick} to stop recording and replay the last tap. Replayed
 * actions must be idempotent: React 19 may also replay a tap that lands while
 * it is hydrating.
 */
export const EARLY_CLICK_ATTR = "data-early-click";

export const EARLY_CLICK_SCRIPT = `(function(){var q=window.__keconEarly=[];function h(e){var t=e.target;var el=t&&t.closest?t.closest("[${EARLY_CLICK_ATTR}]"):null;if(el)q.push(el.getAttribute("${EARLY_CLICK_ATTR}"));}document.addEventListener("click",h,true);window.__keconEarlyStop=function(){document.removeEventListener("click",h,true);};})();`;

declare global {
  interface Window {
    __keconEarly?: string[];
    __keconEarlyStop?: () => void;
  }
}

/** Stop recording and return the last pre-hydration tap (if any). */
export function takeEarlyClick(): string | null {
  if (typeof window === "undefined") return null;
  window.__keconEarlyStop?.();
  window.__keconEarlyStop = undefined;
  const queue = window.__keconEarly ?? [];
  window.__keconEarly = [];
  return queue.length > 0 ? queue[queue.length - 1] : null;
}
