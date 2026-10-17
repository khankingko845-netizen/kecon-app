"use client";
/**
 * G-07 parent reminders: this browser's Web Push subscription, registered as a
 * parent device behind the PIN (POST /api/missions/parent, action "device").
 * The endpoint is also remembered in Cache Storage ("kecon-meta") so the
 * service worker never re-registers a parent device as a child-push device.
 */
import { isPushSupported, urlBase64ToUint8Array } from "@/lib/push-notifications";

const META_CACHE = "kecon-meta";
const PARENT_MARK = "/__kecon/parent-endpoint";

export interface PushKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type SubscribeFailure = "unsupported" | "denied" | "failed";

export async function currentPushEndpoint(): Promise<string | null> {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription())?.endpoint ?? null;
  } catch {
    return null;
  }
}

/** Ask for permission (parent taps a button first) and return the push keys. */
export async function subscribeParentDevice(publicKey: string): Promise<PushKeys | SubscribeFailure> {
  if (!isPushSupported()) return "unsupported";
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
      }));
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "failed";
    return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
  } catch {
    return "failed";
  }
}

export async function unsubscribeThisDevice(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    await (await reg.pushManager.getSubscription())?.unsubscribe();
  } catch {
    /* already gone */
  }
}

export async function markParentEndpoint(endpoint: string | null): Promise<void> {
  try {
    const cache = await caches.open(META_CACHE);
    if (endpoint) await cache.put(PARENT_MARK, new Response(endpoint));
    else await cache.delete(PARENT_MARK);
  } catch {
    /* Cache Storage unavailable (private mode): the server still rejects child endpoints */
  }
}

export async function readParentEndpoint(): Promise<string | null> {
  try {
    const res = await (await caches.open(META_CACHE)).match(PARENT_MARK);
    return res ? await res.text() : null;
  } catch {
    return null;
  }
}
