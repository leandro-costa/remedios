import { expect, test } from "@playwright/test";
import { activate, localDateTime, localTime, newUser, run, shot } from "./helpers";

test("tratamento por dias vira número de doses, com primeira e última dose e andamento", async ({ browser }) => {
  // Dois horários com 12 h de intervalo; a primeira dose é amanhã no primeiro deles.
  const H1 = localTime(24 * 60);
  const H2 = localTime(24 * 60 + 12 * 60);
  const FIRST = localDateTime(24 * 60);
  const ana = await newUser(browser, `Ana D ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família D ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();

  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByLabel("Pessoa").selectOption({ label: "Gabriel" });
  await p.getByLabel("Medicamento").fill("Antibiótico");
  await p.getByLabel("Dose conforme a prescrição").fill("5 ml");
  await p.getByLabel("Horário 1", { exact: true }).fill(H1);
  await p.getByRole("button", { name: "+ Adicionar horário" }).click();
  await p.getByLabel("Horário 2", { exact: true }).fill(H2);
  await p.getByLabel("Primeira dose (data e hora)").fill(FIRST);
  await p.getByRole("radio", { name: "Por dias" }).click();
  await p.getByLabel("Quantos dias").fill("5");
  await p.getByRole("button", { name: "Conferir" }).click();

  // Conferência: 5 dias × 2 horários = 10 doses, com primeira e última.
  await expect(p.getByText("Por 5 dias (10 doses)")).toBeVisible();
  await expect(p.getByTestId("course-plan")).toContainText("10 doses · 5 dias");
  await expect(p.getByTestId("course-plan")).toContainText(`primeira`);
  await shot(p, "19-tratamento-por-doses");
  await p.getByRole("button", { name: "Salvar" }).click();
  await activate(p);
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();

  // Detalhe: término e andamento.
  await expect(p.getByText("Após 10 doses")).toBeVisible();
  const progress = p.getByRole("region", { name: "Andamento do tratamento" });
  await expect(progress).toContainText("0 de 10 registradas");
  await expect(progress.getByText("A dar").locator("..")).toContainText("10");
  await expect(progress).toContainText("Última dose prevista");

  // Lista: total no cartão.
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await expect(p.getByRole("link", { name: /Antibiótico/ })).toContainText("10 doses");
  await expect(p.getByRole("link", { name: /Antibiótico/ })).toContainText("0 de 10 dadas");

  // Edição: o término volta como "Por doses: 10".
  await p.getByRole("link", { name: /Antibiótico/ }).click();
  await p.getByRole("link", { name: "Editar" }).click();
  await expect(p.getByRole("radio", { name: "Por doses" })).toHaveAttribute("aria-checked", "true");
  await expect(p.getByLabel("Quantas doses no total")).toHaveValue("10");
  await ana.context.close();
});
