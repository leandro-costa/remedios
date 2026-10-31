import { expect, test } from "@playwright/test";
import { goOffline, goOnline, newUser, run, shot } from "./helpers";

test("se necessário: sem horários, registra cada dose, mostra a última e as das últimas 24 h, offline também", async ({ browser }) => {
  const ana = await newUser(browser, `Ana P ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família P ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();

  // Cadastro: sem agenda e sem término por doses.
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByLabel("Pessoa").selectOption({ label: "Gabriel" });
  await p.getByLabel("Medicamento").fill("Paracetamol");
  await p.getByLabel("Dose conforme a prescrição").fill("15 gotas");
  await p.getByRole("combobox", { name: /Tipo de tratamento/ }).selectOption("AS_NEEDED");
  await expect(p.getByLabel("Horário 1", { exact: true })).toHaveCount(0);
  await expect(p.getByRole("radio", { name: "Por doses" })).toHaveCount(0);
  await p.getByLabel(/Quando dar/).fill("Se febre acima de 37,8 °C, no máximo de 6 em 6 horas");
  await p.getByRole("button", { name: "Conferir" }).click();
  await expect(p.getByText("Sem horários: registre cada dose quando der")).toBeVisible();
  await p.getByRole("button", { name: "Salvar" }).click();
  await p.getByRole("button", { name: "Ativar", exact: true }).click();
  await p.getByRole("button", { name: "Confirmar" }).click();
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();

  // Hoje: cartão do remédio, fora da lista de doses previstas.
  await p.getByRole("link", { name: "Hoje", exact: true }).click();
  const card = p.getByRole("region", { name: "Se necessário: Paracetamol" });
  await expect(card).toContainText("Na receita: Se febre acima de 37,8 °C");
  await expect(card.getByTestId("as-needed-last")).toHaveText("Nenhuma dose registrada.");
  await card.getByRole("button", { name: "Registrar dose" }).click();
  await card.getByLabel(/Observação/).fill("38,4 °C");
  await card.getByRole("button", { name: "Confirmar dose" }).click();
  await expect(card.getByTestId("as-needed-last")).toContainText("Última dose: Hoje");
  await expect(card.getByTestId("as-needed-last")).toContainText(`por Ana P ${run}`);
  await expect(card.getByTestId("as-needed-count")).toHaveText("1 dose nas últimas 24 h");
  await expect(p.getByText("Nenhuma dose prevista para hoje.")).toBeVisible();
  await shot(p, "20-se-necessario");

  // Offline: aparece na hora, aguardando envio, e entra na contagem.
  await goOffline(ana.context, p);
  await card.getByRole("button", { name: "Registrar dose" }).click();
  await card.getByRole("button", { name: "Confirmar dose" }).click();
  await expect(card.getByTestId("as-needed-count")).toHaveText("2 doses nas últimas 24 h");
  await expect(card.getByTestId("as-needed-last")).toContainText("Aguardando envio");
  await goOnline(ana.context, p);
  await expect(card.getByTestId("as-needed-last")).not.toContainText("Aguardando envio", { timeout: 15_000 });
  await expect(card.getByTestId("as-needed-count")).toHaveText("2 doses nas últimas 24 h");

  // Registrada por engano: sai da contagem.
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await expect(p.getByRole("heading", { name: "Tratamentos" })).toBeVisible();
  await expect(p.getByRole("link", { name: /Paracetamol/ })).toContainText("se necessário");
  await p.getByRole("link", { name: /Paracetamol/ }).click();
  const detail = p.getByRole("region", { name: "Se necessário: Paracetamol" });
  await expect(detail.getByTestId("as-needed-count")).toHaveText("2 doses nas últimas 24 h");
  await detail.getByRole("link", { name: /Hoje/ }).first().click();
  await p.getByRole("button", { name: "Corrigir registro" }).click();
  await p.getByRole("radio", { name: /Registrada por engano/ }).check();
  await p.getByLabel("Motivo da correção").fill("Toque duplo");
  await p.getByRole("button", { name: "Salvar correção" }).click();
  await p.getByRole("link", { name: "Hoje", exact: true }).click();
  await expect(p.getByRole("region", { name: "Se necessário: Paracetamol" }).getByTestId("as-needed-count"))
    .toHaveText("1 dose nas últimas 24 h");
  await ana.context.close();
});
