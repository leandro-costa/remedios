import { expect, test } from "@playwright/test";
import { activate, localTime, run, timezoneId } from "./helpers";

// Celular de 360 px com a fonte do sistema maior: o Chrome amplia a página e
// sobram cerca de 320 px. Nenhum botão pode vazar do cartão nem a tela rolar para o lado.
test("tela estreita: botões dentro dos cartões e sem rolagem lateral", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true, timezoneId, locale: "pt-BR" });
  const p = await context.newPage();
  await p.goto("/");
  await p.getByLabel("Seu nome").fill(`Ana TE ${run}`);
  await p.getByRole("button", { name: "Entrar" }).click();
  await p.getByLabel("Nome da família").fill(`Família TE ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Terezinha");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();
  await expect(p.getByLabel("Nome", { exact: true })).toHaveValue("");

  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByRole("combobox", { name: "Pessoa" }).selectOption({ label: "Terezinha" });
  await p.getByLabel("Medicamento").fill("Vitamina D3 colecalciferol");
  await p.getByLabel("Dose conforme a prescrição").fill("10 gotas");
  await p.getByLabel("Horário 1", { exact: true }).fill(localTime(-20));
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await activate(p);
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();

  await p.getByRole("link", { name: "Hoje", exact: true }).click();
  await expect(p.locator(".next-dose").getByRole("button", { name: /Dada agora/ })).toBeVisible();
  const problems = await p.evaluate(() => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw) out.push(`rolagem lateral: ${document.documentElement.scrollWidth} > ${vw}`);
    for (const b of Array.from(document.querySelectorAll<HTMLElement>(".next-dose .btn, .dose-row .btn"))) {
      const card = b.closest<HTMLElement>(".next-dose, .dose-row")!.getBoundingClientRect();
      const r = b.getBoundingClientRect();
      if (r.right > card.right + 0.5 || r.left < card.left - 0.5 || b.scrollWidth > b.clientWidth + 1) out.push(`vaza: ${b.innerText}`);
    }
    return out;
  });
  expect(problems).toEqual([]);
  await context.close();
});
