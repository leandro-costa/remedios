import type { Browser, BrowserContext, Page } from "@playwright/test";

/**
 * Fuso em que agora é por volta do meio-dia, para que "1 hora atrás" e
 * "daqui a 2 horas" caiam no mesmo dia em qualquer horário do CI.
 */
export const offset = Math.max(-12, Math.min(14, 12 - new Date().getUTCHours()));
export const timezoneId = offset === 0 ? "Etc/UTC" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;

export function localTime(minutesFromNow: number): string {
  const d = new Date(Date.now() + minutesFromNow * 60_000 + offset * 3_600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export const run = Date.now().toString(36);

/** Capturas de tela opcionais (E2E_SCREENSHOTS=pasta), úteis para documentação. */
export async function shot(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png` });
}

export async function newUser(browser: Browser, name: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ timezoneId, locale: "pt-BR" });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel("Seu nome").fill(name);
  await page.getByRole("button", { name: "Entrar" }).click();
  return { context, page };
}

export async function goOffline(context: BrowserContext, page: Page) {
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
}

export async function goOnline(context: BrowserContext, page: Page) {
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}


/** Valor para <input type="datetime-local"> no fuso do teste. */
export function localDateTime(minutesFromNow: number): string {
  const d = new Date(Date.now() + minutesFromNow * 60_000 + offset * 3_600_000);
  return d.toISOString().slice(0, 16);
}
