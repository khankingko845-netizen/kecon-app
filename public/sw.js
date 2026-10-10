// KểCon Service Worker — offline shell + push notifications.
const CACHE = "kecon-shell-v3";
const AMBIENT_CACHE = "kecon-ambient-v1";
const AMBIENT_FILE = /^\/audio\/ambient\/v1\/(rain|waves|wind|fire|forest|night|stream|lullaby)\.mp3$/;

// ============================================================
// INSTALL / ACTIVATE
// ============================================================
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("kecon-shell-") && k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ============================================================
// FETCH — cache strategy
// ============================================================
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET. Skip API and auth routes.
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/")
  ) {
    return;
  }

  // Full public clips are stored only after the client verifies their SHA-256.
  // Keep this cache across shell updates; never mix clips with API/auth responses.
  if (AMBIENT_FILE.test(url.pathname)) {
    event.respondWith(
      caches.open(AMBIENT_CACHE).then(async (cache) => {
        const cached = await cache.match(url.pathname);
        if (!cached || cached.status !== 200) return fetch(request);
        const range = request.headers.get("range");
        if (!range) return cached;
        const bytes = await cached.arrayBuffer();
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        let start = match && match[1] ? Number(match[1]) : 0;
        let end = match && match[2] ? Number(match[2]) : bytes.byteLength - 1;
        if (match && !match[1] && match[2]) {
          start = Math.max(0, bytes.byteLength - Number(match[2]));
          end = bytes.byteLength - 1;
        }
        if (!match || (!match[1] && !match[2]) || start > end || start >= bytes.byteLength) {
          return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.byteLength}` } });
        }
        end = Math.min(end, bytes.byteLength - 1);
        return new Response(bytes.slice(start, end + 1), {
          status: 206,
          headers: {
            "Content-Type": cached.headers.get("content-type") || "audio/mpeg",
            "Content-Range": `bytes ${start}-${end}/${bytes.byteLength}`,
            "Content-Length": String(end - start + 1),
            "Accept-Ranges": "bytes",
          },
        });
      })
    );
    return;
  }

  // Cache-first for immutable Next build assets.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            if (res.ok) caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
            return res;
          })
      )
    );
    return;
  }

  // Network-first for everything else, falling back to cache when offline.
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        if (res.ok && res.status !== 206) caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request))
  );
});

// ============================================================
// PUSH NOTIFICATIONS
// ============================================================
self.addEventListener("push", (event) => {
  let data = { title: "KểCon 🌙", body: "Có truyện mới cho bé!" };

  try {
    if (event.data) {
      const payload = event.data.json();
      data = {
        title: payload.title || data.title,
        body: payload.body || data.body,
        ...payload,
      };
    }
  } catch {
    // plain text fallback
    if (event.data) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    vibrate: [100, 50, 100],
    data: {
      url: data.url || "/",
      storyId: data.storyId || null,
    },
    actions: [
      { action: "open", title: "Mở truyện" },
      { action: "dismiss", title: "Để sau" },
    ],
    tag: data.tag || "kecon-notification",
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Handle notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.postMessage({
            type: "NOTIFICATION_CLICK",
            url: targetUrl,
            storyId: event.notification.data?.storyId,
          });
          return client.focus();
        }
      }
      // Otherwise open new window
      return self.clients.openWindow(targetUrl);
    })
  );
});

// Handle subscription change (browser may revoke and re-issue)
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription?.options ?? { userVisibleOnly: true })
      .then((subscription) => {
        return fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription),
        });
      })
  );
});
