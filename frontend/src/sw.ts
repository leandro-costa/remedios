/// <reference lib="webworker" />
// Service worker do app: abre offline (precache) e mostra os avisos de push.
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/api\//, /^\/q\//] }));

interface PushPayload {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
  silent?: boolean;
  renotify?: boolean;
  vibrate?: number[];
}

self.addEventListener("push", (event) => {
  let data: PushPayload = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body: data.body ?? "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    lang: "pt-BR",
    // Mesma tag = mesma dose: o aviso novo substitui o anterior (ex.: "Dose registrada").
    tag: data.tag,
    renotify: Boolean(data.tag && data.renotify),
    silent: Boolean(data.silent),
    data: { url: data.url ?? "/" },
  };
  if (!data.silent && data.vibrate?.length) options.vibrate = data.vibrate;
  event.waitUntil((async () => {
    await self.registration.showNotification(data.title ?? "Remédios", options);
    // Avisa a tela aberta que o aviso chegou (o teste de notificações usa isso
    // para separar "não chegou" de "chegou, mas o sistema não mostrou").
    for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage({ type: "push-received", tag: data.tag });
  })());
});

// Tocar no aviso abre a dose; nunca registra nada sozinho (seção 6.2.11).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data as { url?: string })?.url ?? "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin) as WindowClient | undefined;
    if (open) {
      await open.focus();
      await open.navigate(url);
    } else {
      await self.clients.openWindow(url);
    }
  })());
});
