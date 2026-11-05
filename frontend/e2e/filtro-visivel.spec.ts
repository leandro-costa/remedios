import { expect, test } from "@playwright/test";
import { run, timezoneId } from "./helpers";

test("filtro de pessoa: a escolhida fica visível ao reabrir, mesmo no fim de uma fila longa", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, timezoneId, locale: "pt-BR" });
  const p = await context.newPage();
  await p.goto("/");
  await p.getByLabel("Seu nome").fill(`Ana FV ${run}`);
  await p.getByRole("button", { name: "Entrar" }).click();
  await p.getByLabel("Nome da família").fill(`Família FV ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  const names = ["Gabriel Henrique", "Isabela Cristina", "Terezinha Albuquerque", "Leonardo Augusto", "Mariana Beatriz"];
  for (const name of names) {
    await p.getByLabel("Nome", { exact: true }).fill(name);
    await p.getByRole("button", { name: "Adicionar pessoa" }).click();
    await expect(p.getByLabel("Nome", { exact: true })).toHaveValue("");
  }

  await p.goto("/");
  const row = p.getByRole("group", { name: "Filtrar por pessoa" });
  const last = row.getByRole("button", { name: "Mariana Beatriz" });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(last).toHaveClass(/chip-on/);

  // Reabrir: a escolha volta e o botão marcado está dentro da área visível da fila.
  await p.goto("/");
  await expect(last).toHaveClass(/chip-on/);
  const visible = async () => {
    const r = await row.boundingBox();
    const c = await last.boundingBox();
    return Boolean(r && c && c.x >= r.x - 1 && c.x + c.width <= r.x + r.width + 1);
  };
  await expect.poll(visible).toBe(true);
  await context.close();
});
