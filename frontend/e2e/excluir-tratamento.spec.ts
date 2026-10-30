import { expect, test } from "@playwright/test";
import { activate, localTime, newUser, run } from "./helpers";

test("excluir tratamento cadastrado por engano, mesmo encerrado: some de tudo", async ({ browser }) => {
  const ana = await newUser(browser, `Ana X ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família X ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByLabel("Pessoa").selectOption({ label: "Gabriel" });
  await p.getByLabel("Medicamento").fill("Engano");
  await p.getByLabel("Dose conforme a prescrição").fill("5 ml");
  await p.getByLabel("Horário 1", { exact: true }).fill(localTime(60));
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await activate(p);
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();
  await p.getByRole("button", { name: "Encerrar" }).click();
  await p.getByRole("button", { name: "Confirmar" }).click();
  await expect(p.getByText("Encerrado", { exact: true })).toBeVisible();

  await p.getByRole("button", { name: "Excluir (cadastrado por engano)" }).click();
  await expect(p.getByRole("button", { name: "Excluir tratamento" })).toBeDisabled();
  await p.getByLabel("Motivo").fill("Cadastrado na pessoa errada");
  await p.getByRole("button", { name: "Excluir tratamento" }).click();
  await expect(p.getByRole("heading", { name: "Tratamentos" })).toBeVisible();
  await p.getByRole("button", { name: "Todos" }).click();
  await expect(p.getByRole("link", { name: /Engano/ })).toHaveCount(0);
  await p.reload();
  await p.getByRole("button", { name: "Todos" }).click();
  await expect(p.getByRole("link", { name: /Engano/ })).toHaveCount(0);
  await ana.context.close();
});
