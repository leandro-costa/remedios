import { expect, test, type Page } from "@playwright/test";
import { newUser, run } from "./helpers";

async function saveAndActivate(p: Page) {
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await p.getByRole("button", { name: "Ativar", exact: true }).click();
  await p.getByRole("button", { name: "Confirmar" }).click();
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();
}

test("uso eventual: item oculto enquanto a receita tem o mesmo remédio e pergunta ao encerrar", async ({ browser }) => {
  const ana = await newUser(browser, `Ana UE ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família UE ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();
  await expect(p.getByLabel("Nome", { exact: true })).toHaveValue("");

  // Uso eventual: só "se necessário".
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByRole("combobox", { name: "Pessoa" }).selectOption({ label: "Gabriel" });
  await p.getByLabel("Incluir em").selectOption({ label: 'Uso eventual (sem receita, "se necessário")' });
  await expect(p.getByRole("combobox", { name: /Tipo de tratamento/ })).toHaveValue("AS_NEEDED");
  await expect(p.getByRole("combobox", { name: /Tipo de tratamento/ }).locator("option")).toHaveCount(1);
  await p.getByLabel("Medicamento").fill("Paracetamol gotas");
  await p.getByLabel("Dose conforme a prescrição").fill("10 gotas");
  await p.getByRole("button", { name: "Conferir" }).click();
  await expect(p.locator(".facts").getByText("Uso eventual", { exact: true })).toBeVisible();
  await p.getByRole("button", { name: "Salvar" }).click();
  await p.getByRole("button", { name: "Ativar", exact: true }).click();
  await p.getByRole("button", { name: "Confirmar" }).click();
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();

  await p.getByRole("link", { name: "Tratamentos" }).click();
  const eventual = p.getByRole("region", { name: "Receita: Uso eventual" });
  await expect(eventual.getByRole("link", { name: /Paracetamol gotas/ })).toBeVisible();

  // Receita com o mesmo medicamento e outro "se necessário".
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByRole("combobox", { name: "Pessoa" }).selectOption({ label: "Gabriel" });
  await p.getByText("Dados da receita (título, quem prescreveu, data)").click();
  await p.getByLabel(/Título da receita/).fill("Gripe");
  await p.getByLabel("Medicamento").fill("Parace");
  await p.getByRole("group", { name: "Medicamentos da família" }).getByRole("button", { name: /Paracetamol gotas/ }).click();
  await p.getByRole("combobox", { name: /Tipo de tratamento/ }).selectOption("AS_NEEDED");
  await p.getByLabel("Dose conforme a prescrição").fill("15 gotas");
  await saveAndActivate(p);
  await p.getByRole("link", { name: "Ver a receita deste remédio →" }).click();
  await p.getByRole("link", { name: "+ Adicionar remédio" }).click();
  await p.getByLabel("Medicamento").fill("Ibuprofeno");
  await p.getByRole("combobox", { name: /Tipo de tratamento/ }).selectOption("AS_NEEDED");
  await p.getByLabel("Dose conforme a prescrição").fill("5 gotas");
  await saveAndActivate(p);

  // Hoje: vale o Paracetamol da receita (15 gotas); o do uso eventual fica oculto.
  await p.getByRole("link", { name: "Hoje", exact: true }).click();
  const cards = p.getByRole("region", { name: "Se necessário: Paracetamol gotas" });
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("15 gotas");
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await expect(eventual.getByText("Oculto enquanto a receita com Paracetamol gotas estiver ativa")).toBeVisible();

  // Encerrar a receita: pergunta se mantém o Ibuprofeno no uso eventual (o Paracetamol já está lá).
  await p.getByRole("region", { name: "Receita: Gripe" }).getByRole("link", { name: /Gripe/ }).click();
  await p.getByRole("button", { name: "Encerrar receita" }).click();
  const ask = p.getByRole("group", { name: /Manter no uso eventual de Gabriel/ });
  await expect(ask.getByRole("checkbox")).toHaveCount(1);
  await expect(ask.getByRole("checkbox", { name: /Ibuprofeno/ })).toBeChecked();
  await p.getByRole("button", { name: "Confirmar" }).click();
  await expect(p.getByText("Encerrada", { exact: true })).toBeVisible();

  await p.getByRole("link", { name: "Tratamentos" }).click();
  await expect(eventual.getByRole("link", { name: /Ibuprofeno/ })).toBeVisible();
  await expect(eventual.getByText(/Oculto enquanto/)).toHaveCount(0);
  await p.getByRole("link", { name: "Hoje", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("10 gotas");
  await expect(p.getByRole("region", { name: "Se necessário: Ibuprofeno" })).toBeVisible();
  await ana.context.close();
});
