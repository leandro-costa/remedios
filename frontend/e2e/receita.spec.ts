import { expect, test } from "@playwright/test";
import { activate, localTime, newUser, run } from "./helpers";

test("receita com vários remédios: itens, situação calculada e encerrar tudo de uma vez", async ({ browser }) => {
  const ana = await newUser(browser, `Ana Rc ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família Rc ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();

  // Primeiro remédio: cria a receita com título e médico.
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByLabel("Pessoa").selectOption({ label: "Gabriel" });
  await p.getByText("Dados da receita (título, quem prescreveu, data)").click();
  await p.getByLabel(/Título da receita/).fill("Infecção de garganta");
  await p.getByLabel(/Quem prescreveu/).fill("Dra. Lima");
  await p.getByLabel("Medicamento").fill("Amoxicilina");
  await p.getByLabel("Dose conforme a prescrição").fill("5 ml");
  await p.getByLabel("Horário 1", { exact: true }).fill(localTime(60));
  await p.getByRole("button", { name: "Conferir" }).click();
  await expect(p.getByText("Nova receita: Infecção de garganta")).toBeVisible();
  await p.getByRole("button", { name: "Salvar" }).click();
  await activate(p);
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();

  // Receita: segundo remédio, "em caso de dor".
  await p.getByRole("link", { name: "Ver a receita deste remédio →" }).click();
  await expect(p.getByText("Ativa", { exact: true })).toBeVisible();
  await expect(p.getByText("Dra. Lima")).toBeVisible();
  await p.getByRole("link", { name: "+ Adicionar remédio" }).click();
  await expect(p.getByText("Receita: Infecção de garganta")).toBeVisible();
  await p.getByLabel("Medicamento").fill("Dipirona");
  await p.getByRole("combobox", { name: /Tipo de tratamento/ }).selectOption("AS_NEEDED");
  await p.getByLabel("Dose conforme a prescrição").fill("20 gotas");
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await p.getByRole("button", { name: "Ativar", exact: true }).click();
  await p.getByRole("button", { name: "Confirmar" }).click();
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();

  // Lista: a receita agrupa os dois itens.
  await p.getByRole("link", { name: "Tratamentos" }).click();
  const card = p.getByRole("region", { name: "Receita: Infecção de garganta" });
  await expect(card.getByRole("link", { name: /Amoxicilina/ })).toBeVisible();
  await expect(card.getByRole("link", { name: /Dipirona/ })).toBeVisible();

  // Encerrar a receita encerra os dois, inclusive o "em caso de dor".
  await card.getByRole("link", { name: /Infecção de garganta/ }).click();
  await p.getByRole("button", { name: "Encerrar receita" }).click();
  await p.getByRole("button", { name: "Confirmar" }).click();
  await expect(p.getByText("Encerrada", { exact: true })).toBeVisible();
  const items = p.getByRole("region", { name: "Itens da receita" });
  await expect(items.getByText("Encerrado", { exact: true })).toHaveCount(2);
  await expect(p.getByRole("link", { name: "+ Adicionar remédio" })).toHaveCount(0);
  await ana.context.close();
});
