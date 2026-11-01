import { expect, test } from "@playwright/test";
import { activate, goOffline, goOnline, localDateTime, localTime, newUser, run } from "./helpers";

test("sem conexão, todas as telas abrem com a cópia guardada, inclusive as nunca abertas", async ({ browser }) => {
  const ana = await newUser(browser, `Ana CO ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família CO ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();
  await expect(p.getByLabel("Nome", { exact: true })).toHaveValue("");

  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByRole("combobox", { name: "Pessoa" }).selectOption({ label: "Gabriel" });
  await p.getByLabel("Medicamento").fill("Amoxicilina");
  await p.getByLabel("Dose conforme a prescrição").fill("5 ml");
  await p.getByLabel("Horário 1", { exact: true }).fill(localTime(60));
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await activate(p);
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();

  // Aferição registrada com conexão.
  await p.getByRole("link", { name: "Saúde" }).click();
  await p.getByRole("link", { name: "+ Aferição" }).first().click();
  await p.getByRole("radio", { name: "Temperatura" }).click();
  await p.locator("input.value-input").first().fill("38,2");
  await p.getByLabel("Horário da medida").fill(localDateTime(-30));
  await p.getByRole("button", { name: "Salvar aferição" }).click();
  await expect(p.getByRole("img", { name: /Temperatura: 1 aferição/ })).toBeVisible();
  await expect(p.getByRole("status").filter({ hasText: "Sincronizado" }).first()).toBeVisible();

  // Ao reconectar (e ao abrir o app), os dados de todas as telas são guardados em segundo plano.
  await p.getByRole("link", { name: "Hoje", exact: true }).click();
  await goOffline(ana.context, p);
  await goOnline(ana.context, p);
  await p.waitForLoadState("networkidle");
  await expect.poll(() => p.evaluate(() => performance.getEntriesByType("resource")
    .filter((e) => e.name.includes("/medications/") || e.name.includes("medicationId=")).length)).toBeGreaterThan(0);
  await p.waitForLoadState("networkidle");

  await goOffline(ana.context, p);
  // Saúde: aberta antes, agora com outro horário de abertura (a cópia continua valendo).
  await p.getByRole("link", { name: "Saúde" }).click();
  await expect(p.getByRole("img", { name: /Temperatura: 1 aferição/ })).toBeVisible();
  // Medicamentos e o medicamento: nunca abertos com conexão.
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Medicamentos cadastrados →" }).click();
  await p.getByRole("link", { name: /Amoxicilina/ }).click();
  await expect(p.getByRole("region", { name: "Histórico de uso" })).toBeVisible();
  // Histórico: nunca aberto com conexão.
  await p.getByRole("link", { name: "Histórico" }).click();
  await expect(p.getByText("Nenhum registro no período.")).toBeVisible();
  await expect(p.getByRole("alert")).toHaveCount(0);
  await goOnline(ana.context, p);
  await ana.context.close();
});
