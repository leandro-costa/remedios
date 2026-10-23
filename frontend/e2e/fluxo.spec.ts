import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Fuso em que agora é por volta do meio-dia, para que "1 hora atrás" e
 * "daqui a 2 horas" caiam no mesmo dia em qualquer horário do CI.
 */
const offset = Math.max(-12, Math.min(14, 12 - new Date().getUTCHours()));
const timezoneId = offset === 0 ? "Etc/UTC" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;

function localTime(minutesFromNow: number): string {
  const d = new Date(Date.now() + minutesFromNow * 60_000 + offset * 3_600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

const run = Date.now().toString(36);

/** Capturas de tela opcionais (E2E_SCREENSHOTS=pasta), úteis para documentação. */
async function shot(page: Page, name: string) {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png` });
}

async function newUser(browser: Browser, name: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ timezoneId, locale: "pt-BR" });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel("Seu nome").fill(name);
  await page.getByRole("button", { name: "Entrar" }).click();
  return { context, page };
}

async function goOffline(context: BrowserContext, page: Page) {
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
}

async function goOnline(context: BrowserContext, page: Page) {
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

test("cadastro, registro, offline e dois responsáveis", async ({ browser }) => {
  const ana = await newUser(browser, `Ana ${run}`);
  const p = ana.page;

  // Família e pessoa
  await p.getByLabel("Nome da família").fill(`Família ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await expect(p.getByRole("heading", { name: /Hoje/ })).toBeVisible();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();
  await expect(p.getByText("Gabriel", { exact: true })).toBeVisible();

  // Tratamento com doses 1 h atrás e daqui a 2 h
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByLabel("Pessoa").selectOption({ label: "Gabriel" });
  await p.getByLabel("Medicamento").fill("Medicamento A");
  await p.getByLabel("Dose conforme a prescrição").fill("5 ml");
  await p.getByLabel("Horário 1", { exact: true }).fill(localTime(-60));
  await p.getByRole("button", { name: "+ Adicionar horário" }).click();
  await p.getByLabel("Horário 2", { exact: true }).fill(localTime(120));
  await p.getByRole("button", { name: "Conferir" }).click();
  await expect(p.getByText(`Todo dia às ${[localTime(-60), localTime(120)].sort().join(" e ")}`)).toBeVisible();
  await shot(p, "3-conferir-tratamento");
  await p.getByRole("button", { name: "Salvar" }).click();
  await expect(p.getByText("Rascunho", { exact: true })).toBeVisible();
  await p.getByRole("button", { name: "Ativar agenda" }).click();
  await p.getByRole("button", { name: "Confirmar" }).click();
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();

  // Registro online da dose de 1 h atrás
  await p.getByRole("link", { name: "Hoje" }).click();
  const first = p.getByRole("link", { name: new RegExp(localTime(-60)) });
  await expect(first).toContainText("Atrasada");
  await shot(p, "1-hoje");
  await first.click();
  await expect(p.getByRole("button", { name: "Confirmar administração" })).toBeVisible();
  await shot(p, "2-dose");
  await p.getByRole("button", { name: "Confirmar administração" }).click();
  await expect(p.getByRole("link", { name: new RegExp(localTime(-60)) })).toContainText("Administrada");
  await expect(p.getByText("Sincronizado")).toBeVisible();

  // Convite: Bruno entra e vê o registro da Ana
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByRole("button", { name: "Convidar responsável" }).click();
  const code = (await p.getByTestId("invite-code").textContent())!.trim();
  const bruno = await newUser(browser, `Bruno ${run}`);
  const b = bruno.page;
  await b.getByLabel("Código do convite").fill(code);
  await b.getByRole("button", { name: "Entrar na família" }).click();
  await expect(b.getByRole("link", { name: new RegExp(localTime(-60)) })).toContainText(`Ana ${run}`);

  // Offline: a app abre sem rede (service worker + IndexedDB) e guarda o registro
  await b.evaluate(() => navigator.serviceWorker.ready);
  await b.reload();
  await expect(b.getByRole("link", { name: new RegExp(localTime(120)) })).toBeVisible();
  await goOffline(bruno.context, b);
  await b.reload();
  await expect(b.getByRole("link", { name: new RegExp(localTime(120)) })).toBeVisible();
  await expect(b.getByText(/Offline/).first()).toBeVisible();

  await b.getByRole("link", { name: new RegExp(localTime(120)) }).click();
  await b.getByRole("button", { name: "Confirmar administração" }).click();
  await expect(b.getByRole("link", { name: new RegExp(localTime(120)) })).toContainText("Aguardando envio");
  await expect(b.getByText("1 registro aguardando envio")).toBeVisible();
  await shot(b, "4-offline");

  // Enquanto Bruno está offline, Ana registra a mesma dose
  await p.getByRole("link", { name: "Hoje" }).click();
  await p.getByRole("link", { name: new RegExp(localTime(120)) }).click();
  await p.getByRole("button", { name: "Confirmar administração" }).click();
  await expect(p.getByRole("link", { name: new RegExp(localTime(120)) })).toContainText("Administrada");

  // Bruno volta: o registro dele é preservado e a dose vai para conferência
  await goOnline(bruno.context, b);
  await expect(b.getByText("Sincronizado")).toBeVisible();
  await expect(b.getByRole("link", { name: new RegExp(localTime(120)) })).toContainText("Conferir");
  await b.getByRole("link", { name: /precisa de conferência/ }).click();
  await expect(b.getByRole("heading", { name: "Para conferir" })).toBeVisible();
  await b.getByRole("link", { name: /Medicamento A/ }).click();
  await expect(b.getByRole("heading", { name: "Registros divergentes" })).toBeVisible();
  await expect(b.getByText(`Registro de Bruno ${run}`)).toBeVisible();
  await b.getByLabel(/Como foi decidido/).fill("Conversamos: foi dada uma vez, pela Ana");
  await shot(b, "5-conferencia");
  await b.getByRole("button", { name: "Manter o registro atual" }).click();
  await expect(b.getByText("Conferência concluída")).toBeVisible();

  // Histórico mostra quem registrou
  await p.getByRole("link", { name: "Histórico" }).click();
  await expect(p.getByText(`Registrado por Ana ${run}`).first()).toBeVisible();

  await ana.context.close();
  await bruno.context.close();
});
