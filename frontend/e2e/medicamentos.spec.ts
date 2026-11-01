import { expect, test } from "@playwright/test";
import { goOffline, goOnline, localTime, newUser, run } from "./helpers";

test("medicamento cadastrado uma vez, com sugestões da ANVISA, reaproveitado em outro tratamento", async ({ browser }) => {
  const ana = await newUser(browser, `Ana M ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família M ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();

  // Primeiro tratamento: o nome sugere do catálogo da ANVISA e preenche a substância.
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByRole("combobox", { name: "Pessoa" }).selectOption({ label: "Gabriel" });
  const catalog = p.getByRole("group", { name: "Sugestões do catálogo da ANVISA" });
  await expect(async () => {
    await p.getByLabel("Medicamento").fill("");
    await p.getByLabel("Medicamento").fill("tyle");
    await expect(catalog.getByRole("button").filter({ hasText: /^Tylenol\s*paracetamol ·/ })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await catalog.getByRole("button").filter({ hasText: /^Tylenol\s*paracetamol ·/ }).click();
  await expect(p.getByLabel("Medicamento")).toHaveValue("Tylenol");
  await expect(p.getByLabel("Substância 1")).toHaveValue("paracetamol");
  await expect(p.getByLabel("Fabricante / laboratório")).toHaveValue("Kenvue Ltda.");
  await p.getByLabel("Concentração 1").fill("750 mg");
  await p.getByLabel(/Forma farmacêutica/).fill("Comprimido");
  await p.getByLabel("Dose conforme a prescrição").fill("1 comprimido");
  await p.getByLabel("Horário 1", { exact: true }).fill(localTime(60));
  await p.getByRole("button", { name: "Conferir" }).click();
  await expect(p.getByText("paracetamol 750 mg")).toBeVisible();
  await p.getByRole("button", { name: "Salvar" }).click();
  await expect(p.getByText("Rascunho", { exact: true })).toBeVisible();

  // Medicamentos: cadastrado com a substância e a concentração.
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Medicamentos cadastrados →" }).click();
  await expect(p.getByRole("link", { name: /Tylenol/ })).toContainText("paracetamol 750 mg");

  // Segundo tratamento: escolhe o mesmo medicamento, sem cadastrar de novo.
  await p.goto("/tratamentos/novo");
  await p.getByRole("combobox", { name: "Pessoa" }).selectOption({ label: "Gabriel" });
  await p.getByLabel("Medicamento").fill("Tyl");
  await p.getByRole("group", { name: "Medicamentos da família" }).getByRole("button", { name: /Tylenol/ }).click();
  await expect(p.getByTestId("medication-summary")).toContainText("paracetamol 750 mg");
  await expect(p.getByText(/^Novo medicamento/)).toHaveCount(0);
  await p.getByLabel("Dose conforme a prescrição").fill("2 comprimidos");
  await p.getByLabel("Horário 1", { exact: true }).fill(localTime(120));
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await expect(p.getByText("Rascunho", { exact: true })).toBeVisible();
  await p.goto("/medicamentos");
  await expect(p.getByRole("link", { name: /Tylenol/ })).toHaveCount(1);

  // Offline: o cadastro aparece na hora, aguardando envio, e sincroniza depois.
  await goOffline(ana.context, p);
  await p.getByRole("link", { name: "Novo medicamento" }).click();
  await p.getByLabel("Nome do medicamento").fill("Xarope caseiro");
  await p.getByLabel("Substância 1").fill("guaco");
  await p.getByRole("button", { name: "Salvar" }).click();
  await expect(p.getByRole("link", { name: /Xarope caseiro/ })).toContainText("Aguardando envio");
  await goOnline(ana.context, p);
  await expect(p.getByRole("link", { name: /Xarope caseiro/ })).not.toContainText("Aguardando envio", { timeout: 15_000 });
  await ana.context.close();
});
