import { api } from "../api/client";

export type PushState =
  | "unsupported"      // navegador sem Web Push
  | "install-required" // iPhone/iPad: só funciona com o app na tela inicial
  | "server-disabled"  // servidor sem chaves VAPID
  | "denied"           // o usuário bloqueou as notificações
  | "off"              // disponível, ainda não ativado neste aparelho
  | "on";

interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64Url.length % 4)) % 4);
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function encode(buffer: ArrayBuffer | null): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer ?? new ArrayBuffer(0))) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function pushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return "install-required";
  if (!supported()) return "unsupported";
  const config = await api<PushConfig>("/push/config").catch(() => null);
  if (config && !config.enabled) return "server-disabled";
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

async function send(deviceId: string, subscription: PushSubscription) {
  await api(`/me/devices/${deviceId}/push`, {
    method: "PUT",
    body: {
      endpoint: subscription.endpoint,
      p256dh: encode(subscription.getKey("p256dh")),
      auth: encode(subscription.getKey("auth")),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });
}

/** Pede permissão, inscreve o navegador e registra a inscrição para este aparelho. */
export async function enablePush(deviceId: string): Promise<PushState> {
  const config = await api<PushConfig>("/push/config");
  if (!config.enabled || !config.publicKey) return "server-disabled";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(config.publicKey),
    });
  }
  await send(deviceId, subscription);
  return "on";
}

export async function disablePush(deviceId: string): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
  await api(`/me/devices/${deviceId}/push`, { method: "DELETE" });
}

/**
 * Ao abrir o app: se as notificações estão permitidas, reenvia a inscrição
 * (o navegador pode renová-la; o aparelho pode ter ganhado novo id).
 */
export async function syncPush(deviceId: string): Promise<void> {
  if (!supported() || Notification.permission !== "granted") return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await send(deviceId, subscription).catch(() => {});
}

export async function testPush(): Promise<{ sent: number; failed: number }> {
  return api("/me/push/test", { method: "POST" });
}
