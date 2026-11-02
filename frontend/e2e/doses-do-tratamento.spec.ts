import { expect, test } from "@playwright/test";
import { activate, localTime, newUser, run } from "./helpers";

test("tratamento: lista todas as doses, abre o detalhe e exclui uma gerada por engano", async ({ browser }) => {
  const H = localTime(-60);
  const ana = await newUser(browser, `Ana DT ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família DT ${run}`);
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
  await p.getByLabel("Horário 1", { exact: true }).fill(H);
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await activate(p);
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();

  // Doses do tratamento: a de hoje (já passou, sem registro) e as próximas.
  const doses = p.getByRole("region", { name: "Doses do tratamento" });
  await expect(doses.getByRole("heading", { name: "Anteriores" })).toBeVisible();
  await expect(doses.getByRole("heading", { name: "Próximas" })).toBeVisible();
  const today = doses.getByRole("link", { name: new RegExp(`Hoje · ${H}`) });
  await expect(today).toContainText("Atrasada");

  // Abrir o detalhe da dose e voltar.
  await today.click();
  await expect(p.getByRole("heading", { name: "Dose", exact: true })).toBeVisible();
  await p.goBack();

  // Excluir a dose de hoje (só administradores), com motivo.
  await doses.getByRole("button", { name: new RegExp(`Excluir a dose de Hoje · ${H}`) }).click();
  const dialog = p.getByRole("dialog", { name: "Excluir dose" });
  await expect(dialog.getByRole("button", { name: "Excluir dose" })).toBeDisabled();
  await dialog.getByLabel("Motivo").fill("Gerada no horário errado");
  await dialog.getByRole("button", { name: "Excluir dose" }).click();
  await expect(today).toContainText("Cancelada");
  await expect(today).toContainText("Gerada no horário errado");
  await expect(doses.getByRole("button", { name: new RegExp(`Excluir a dose de Hoje · ${H}`) })).toHaveCount(0);

  // Some de Hoje.
  await p.getByRole("link", { name: "Hoje", exact: true }).click();
  await expect(p.getByRole("link", { name: new RegExp(`${H}.*Amoxicilina`) })).toHaveCount(0);
  await ana.context.close();
});
