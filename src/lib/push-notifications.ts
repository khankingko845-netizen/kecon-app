"use client";

/**
 * Push notification helpers for KểCon.
 *
 * Usage:
 *   import { requestPushPermission, subscribeToPush, isPushSupported } from "@/lib/push-notifications";
 *
 * The VAPID public key should be set in NEXT_PUBLIC_VAPID_PUBLIC_KEY env var.
 * Generate a VAPID key pair with: npx web-push generate-vapid-keys
 */

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function getPermissionState(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestPushPermission(): Promise<NotificationPermission> {
  if (!isPushSupported()) return "denied";
  return Notification.requestPermission();
}

/**
 * Subscribe the browser to push and POST the subscription to our API.
 * Returns the PushSubscription or null if it fails.
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  try {
    const permission = await requestPushPermission();
    if (permission !== "granted") return null;

    const reg = await navigator.serviceWorker.ready;

    // Check for existing subscription
    let subscription = await reg.pushManager.getSubscription();

    if (!subscription) {
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        console.warn("[Push] Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY");
        return null;
      }

      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
      });
    }

    // Send subscription to server
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    });

    return subscription;
  } catch (err) {
    console.error("[Push] Subscribe failed:", err);
    return null;
  }
}

export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    if (!subscription) return true;

    // Tell server to remove subscription
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });

    return subscription.unsubscribe();
  } catch (err) {
    console.error("[Push] Unsubscribe failed:", err);
    return false;
  }
}

/**
 * Listen for notification clicks forwarded from the SW.
 */
export function onNotificationClick(
  callback: (data: { url: string; storyId: string | null }) => void
): () => void {
  const handler = (event: MessageEvent) => {
    if (event.data?.type === "NOTIFICATION_CLICK") {
      callback({ url: event.data.url, storyId: event.data.storyId });
    }
  };
  navigator.serviceWorker?.addEventListener("message", handler);
  return () => navigator.serviceWorker?.removeEventListener("message", handler);
}

// ---- Helpers ----

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
