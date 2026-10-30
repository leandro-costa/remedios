import { api, UserError } from "../api/client";

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

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const bytes = new Uint8Array(a);
  return bytes.length === b.length && bytes.every((v, i) => v === b[i]);
}

/** Erro do navegador ao ativar, em português e com o que fazer. */
export class PushError extends UserError {}

async function subscribe(registration: ServiceWorkerRegistration, key: Uint8Array<ArrayBuffer>): Promise<PushSubscription> {
  const existing = await registration.pushManager.getSubscription();
  // Inscrição feita com outra chave (o servidor trocou as chaves VAPID): não recebe mais nada.
  if (existing && sameKey(existing.options.applicationServerKey, key)) return existing;
  await existing?.unsubscribe();
  try {
    return await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  } catch {
    // Logo depois de dar a permissão, alguns navegadores recusam a primeira tentativa.
    await new Promise((r) => setTimeout(r, 1000));
    try {
      return await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      throw new PushError(name === "NotAllowedError"
        ? "O navegador não deixou ativar as notificações. Confira a permissão do site e tente de novo."
        : "O serviço de notificações do navegador não respondeu. Tente de novo. Em janela anônima as " +
          "notificações não funcionam; no Brave, ligue " +
          "\"Usar os serviços do Google para mensagens push\" nas configurações de privacidade.");
    }
  }
}

/** Pede permissão, inscreve o navegador e registra a inscrição para este aparelho. */
export async function enablePush(deviceId: string): Promise<PushState> {
  const config = await api<PushConfig>("/push/config");
  if (!config.enabled || !config.publicKey) return "server-disabled";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const registration = await navigator.serviceWorker.ready;
  await send(deviceId, await subscribe(registration, keyBytes(config.publicKey)));
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

export type TestOutcome = "arrived" | "sent" | "failed";

/**
 * Envia um aviso de teste só para este aparelho e espera o service worker
 * contar que ele chegou. "sent": o serviço de push aceitou, mas o aviso não
 * chegou a tempo.
 */
export async function testPush(deviceId: string, waitMs = 15_000): Promise<TestOutcome> {
  if (Notification.permission !== "granted") throw new PushError("As notificações não estão permitidas para este site.");
  const registration = await navigator.serviceWorker.ready;
  const key = (await api<PushConfig>("/push/config")).publicKey;
  // A inscrição pode ter mudado (chaves trocadas no servidor): reenvia antes de testar.
  if (key) await send(deviceId, await subscribe(registration, keyBytes(key)));
  let done: (arrived: boolean) => void = () => {};
  const arrived = new Promise<boolean>((resolve) => { done = resolve; });
  const listener = (e: MessageEvent) => { if (e.data?.type === "push-received" && e.data.tag === "test") done(true); };
  navigator.serviceWorker.addEventListener("message", listener);
  const timer = setTimeout(() => done(false), waitMs);
  try {
    const r = await api<{ sent: number; failed: number }>(`/me/push/test?deviceId=${deviceId}`, { method: "POST" });
    if (r.sent === 0) return "failed";
    return (await arrived) ? "arrived" : "sent";
  } finally {
    clearTimeout(timer);
    navigator.serviceWorker.removeEventListener("message", listener);
  }
}
