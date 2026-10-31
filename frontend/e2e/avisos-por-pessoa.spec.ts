import { expect, test } from "@playwright/test";
import { newUser, run } from "./helpers";

test("quem recebe os avisos: filtro por pessoa, guardado e com alerta quando ninguém recebe", async ({ browser }) => {
  const ana = await newUser(browser, `Ana AP ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família AP ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  for (const name of ["Gabriel", "Lia"]) {
    await p.getByLabel("Nome", { exact: true }).fill(name);
    await p.getByRole("button", { name: "Adicionar pessoa" }).click();
    await expect(p.getByLabel("Nome", { exact: true })).toHaveValue("");
  }
  await p.reload();

  const section = p.getByRole("region", { name: "Quem recebe os avisos" });
  const lia = section.getByRole("checkbox", { name: "Você recebe os avisos de Lia" });
  await expect(lia).toBeChecked();
  await lia.click();
  await expect(lia).not.toBeChecked();
  await expect(section).toContainText("Ninguém recebe os avisos de Lia.");
  await expect(p.locator(".queue-float")).not.toContainText("aguardando envio");

  await p.reload();
  await expect(section.getByRole("checkbox", { name: "Você recebe os avisos de Lia" })).not.toBeChecked();
  await expect(section.getByRole("checkbox", { name: "Você recebe os avisos de Gabriel" })).toBeChecked();
  await ana.context.close();
});
