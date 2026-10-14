import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";

// G-07: the service worker shows the parent reminder and never turns a parent
// device into a child-push subscription when the browser rotates it.
function worker(mark: string | null) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const meta = { match: vi.fn(async () => (mark ? new Response(mark) : undefined)), delete: vi.fn(async () => true) };
  const storage = { open: vi.fn(async () => meta), keys: vi.fn(async () => []), delete: vi.fn(async () => true) };
  const net = vi.fn(async () => new Response("{}"));
  const showNotification = vi.fn(async () => undefined);
  const subscribe = vi.fn(async () => ({ endpoint: "https://push.example/new" }));
  const self = {
    location: { origin: "https://kecon.test" },
    clients: { claim: vi.fn() },
    registration: { showNotification, pushManager: { subscribe } },
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
  };
  vm.runInNewContext(fs.readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"), { self, caches: storage, fetch: net, URL, Response, Promise, JSON });
  return { handlers, net, showNotification, subscribe, meta };
}
const run = async (w: ReturnType<typeof worker>, type: string, event: Record<string, unknown>) => {
  let p: Promise<unknown> = Promise.resolve();
  w.handlers[type]({ ...event, waitUntil: (v: Promise<unknown>) => (p = v) });
  await p;
};

describe("service worker — parent reminders", () => {
  it("a parent payload opens Tuần của bé, quietly, with its own tag", async () => {
    const w = worker(null);
    await run(w, "push", { data: { json: () => ({ kind: "parent", title: "Tuần của bé", body: "Tối nay…", url: "https://evil.test" }) } });
    const [title, options] = w.showNotification.mock.calls[0] as unknown as [string, { data: { url: string }; tag: string; actions: { title: string }[] }];
    expect(title).toBe("Tuần của bé");
    expect(options.data.url).toBe("/?screen=parent-week");
    expect(options.tag).toBe("kecon-parent-week");
    expect(options.actions[0].title).toBe("Mở Tuần của bé");
  });
  it("a rotated parent subscription is not re-registered as a child device", async () => {
    const w = worker("https://push.example/parent");
    await run(w, "pushsubscriptionchange", { oldSubscription: { endpoint: "https://push.example/parent", options: {} } });
    expect(w.subscribe).not.toHaveBeenCalled();
    expect(w.net).not.toHaveBeenCalled();
    expect(w.meta.delete).toHaveBeenCalled();
  });
  it("other subscriptions keep the existing child-push renewal", async () => {
    const w = worker("https://push.example/parent");
    await run(w, "pushsubscriptionchange", { oldSubscription: { endpoint: "https://push.example/child", options: {} } });
    expect(w.subscribe).toHaveBeenCalled();
    expect(w.net).toHaveBeenCalledWith("/api/push/subscribe", expect.objectContaining({ method: "POST" }));
  });
});
