import { expect, test } from "@playwright/test";
import { activate, localTime, newUser, run } from "./helpers";

test("histórico por medicamento: receita e uso eventual do mesmo remédio aparecem juntos", async ({ browser }) => {
  const ana = await newUser(browser, `Ana HM ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família HM ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();

  // Receita com horário (30 min atrás): a dose de hoje já foi dada.
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByLabel("Pessoa").selectOption({ label: "Gabriel" });
  await p.getByLabel("Medicamento").fill("Dipirona gotas");
  await p.getByLabel("Substância 1").fill("dipirona monoidratada");
  await p.getByLabel("Dose conforme a prescrição").fill("20 gotas");
  await p.getByLabel("Horário 1", { exact: true }).fill(localTime(-30));
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await activate(p, /Sim, foi dada no horário previsto/);
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();

  // Uso eventual com o mesmo medicamento, escolhido entre os já cadastrados.
  await p.goto("/tratamentos/novo");
  await p.getByLabel("Pessoa").selectOption({ label: "Gabriel" });
  await p.getByLabel("Medicamento").fill("Dipi");
  await p.getByRole("group", { name: "Medicamentos da família" }).getByRole("button", { name: /Dipirona gotas/ }).click();
  await p.getByRole("combobox", { name: /Tipo de tratamento/ }).selectOption("AS_NEEDED");
  await p.getByLabel("Dose conforme a prescrição").fill("20 gotas");
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await p.getByRole("button", { name: "Ativar", exact: true }).click();
  await p.getByRole("button", { name: "Confirmar" }).click();
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();

  // Cartão do uso eventual: a dose da receita já conta na última dose e nas 24 h.
  await p.getByRole("link", { name: "Hoje", exact: true }).click();
  const card = p.getByRole("region", { name: "Se necessário: Dipirona gotas" });
  await expect(card.getByTestId("as-needed-count")).toHaveText("1 dose nas últimas 24 h");
  await card.getByRole("button", { name: "Registrar dose" }).click();
  await card.getByRole("button", { name: "Confirmar dose" }).click();
  await expect(card.getByTestId("as-needed-count")).toHaveText("2 doses nas últimas 24 h");

  // Medicamento: um histórico só, com as duas origens.
  await p.goto("/medicamentos");
  await p.getByRole("link", { name: /Dipirona gotas/ }).click();
  const history = p.getByRole("region", { name: "Histórico de uso" });
  await expect(history.getByRole("listitem")).toHaveCount(2);
  await expect(history).toContainText("Dipirona gotas · se necessário");

  // Histórico geral filtrado pelo medicamento.
  await p.goto("/historico");
  await p.getByLabel("Medicamento").selectOption({ label: "Dipirona gotas" });
  await expect(p.locator(".history-item")).toHaveCount(2);
  await ana.context.close();
});
