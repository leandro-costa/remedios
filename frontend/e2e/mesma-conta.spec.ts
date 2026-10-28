import { expect, test } from "@playwright/test";
import { newUser, run } from "./helpers";

test("mesma conta em outro aparelho abre a família que já existe", async ({ browser }) => {
  const name = `Leandro M ${run}`;
  const first = await newUser(browser, name);
  await first.page.getByLabel("Nome da família").fill(`Família M ${run}`);
  await first.page.getByRole("button", { name: "Criar família" }).click();
  await expect(first.page.getByRole("heading", { name: "Hoje" })).toBeVisible();

  // Outro aparelho (outro navegador, sem nada guardado), mesma conta.
  const second = await newUser(browser, name);
  await expect(second.page.getByRole("heading", { name: "Hoje" })).toBeVisible();
  await expect(second.page).not.toHaveURL(/entrar-na-familia/);
  await expect(second.page.getByLabel("Nome da família")).toHaveCount(0);

  await first.context.close();
  await second.context.close();
});
