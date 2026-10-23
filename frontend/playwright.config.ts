import { defineConfig, devices } from "@playwright/test";

// Ponta a ponta: o PWA (build no modo local) contra a API de verdade.
// Local:  API em :8080 no modo local (veja docs/pwa.md) e `npm run e2e`.
// CI:     o serviço `e2e` do compose roda isto contra o serviço `web`.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:4173";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    locale: "pt-BR",
    trace: "retain-on-failure",
    serviceWorkers: "allow",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
  // Chromium completo (headless novo): o "headless shell" padrão sempre informa
  // as notificações como bloqueadas, diferente do navegador do celular.
  projects: [{ name: "celular", use: { ...devices["Pixel 7"], channel: "chromium" } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run build && npm run preview", url: baseURL, reuseExistingServer: true, timeout: 120_000,
        env: { VITE_AUTH_MODE: "local", VITE_FIREBASE_PROJECT_ID: "remedios-local" } },
});
