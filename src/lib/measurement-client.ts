/** No SDK, cookies/identifiers added or durable event queue. DB deduplicates per authenticated account. */
export function recordMilestone(event: "home_view" | "first_listen") {
  void fetch("/api/analytics/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
    keepalive: true,
  }).catch(() => {});
}
