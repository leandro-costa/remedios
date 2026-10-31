import { expect, test, type Page } from "@playwright/test";
import { activate, localTime, newUser, run } from "./helpers";

/** Arrasta o dedo na tela Hoje (para a esquerda: avança). */
async function swipe(p: Page, direction: "left" | "right") {
  await p.evaluate((dir) => {
    const el = document.querySelector(".page-today")!;
    const at = (x: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 400 });
    const [a, b] = dir === "left" ? [320, 80] : [80, 320];
    el.dispatchEvent(new TouchEvent("touchstart", { touches: [at(a)], changedTouches: [at(a)], bubbles: true }));
    el.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [at(b)], bubbles: true }));
  }, direction);
}

test("agenda: arrastar muda o dia, atalho para hoje, semana e mês", async ({ browser }) => {
  const H = localTime(-60);
  const ana = await newUser(browser, `Ana AG ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família AG ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByLabel("Pessoa").selectOption({ label: "Gabriel" });
  await p.getByLabel("Medicamento").fill("Vitamina D");
  await p.getByLabel("Dose conforme a prescrição").fill("1 cápsula");
  await p.getByLabel("Horário 1", { exact: true }).fill(H);
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await activate(p, /Sim, foi dada no horário previsto/);
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();
  await p.getByRole("link", { name: "Hoje", exact: true }).click();
  await expect(p.getByRole("heading", { name: "Hoje" })).toBeVisible();
  await expect(p.getByRole("button", { name: "Voltar para hoje" })).toHaveCount(0);

  // Arrastar para o lado muda o dia; o atalho volta para hoje.
  await swipe(p, "left");
  await expect(p.getByRole("heading", { name: "Amanhã" })).toBeVisible();
  await swipe(p, "right");
  await swipe(p, "right");
  await expect(p.getByRole("heading", { name: "Ontem" })).toBeVisible();
  await p.getByRole("button", { name: "Voltar para hoje" }).click();
  await expect(p.getByRole("heading", { name: "Hoje" })).toBeVisible();

  // Semana: cada dia com o resumo; hoje, a dose já dada.
  await p.getByRole("radio", { name: "Semana" }).click();
  await expect(p.getByRole("heading", { name: "Semana" })).toBeVisible();
  await expect(p.locator(".week-day.is-today .week-head")).toContainText("1 de 1 dadas");
  await expect(p.locator(".week-day.is-today")).toContainText("Vitamina D");

  // Mês: calendário; tocar no dia de hoje abre o dia.
  await p.getByRole("radio", { name: "Mês" }).click();
  const today = p.locator(".month-day.is-today");
  await expect(today).toHaveAttribute("aria-label", /1 de 1 dadas/);
  await expect(today).toHaveClass(/tone-done/);
  await swipe(p, "left");
  await expect(p.getByRole("button", { name: "Voltar para hoje" })).toBeVisible();
  await p.getByRole("button", { name: "Voltar para hoje" }).click();
  await p.locator(".month-day.is-today").click();
  await expect(p.getByRole("heading", { name: "Hoje" })).toBeVisible();
  await expect(p.getByRole("radio", { name: "Dia" })).toHaveAttribute("aria-checked", "true");
  await ana.context.close();
});
