import { expect, test } from "@playwright/test";
import { activate, goToday, localDateTime, newUser, run } from "./helpers";

test("Hoje: botão mostra as doses atrasadas de outros dias e cada uma abre para registrar", async ({ browser }) => {
  // Todo dia, daqui a uma hora; começou há dois dias (anteontem e ontem ficaram sem registro).
  const start = localDateTime(60 - 2 * 24 * 60);
  const ana = await newUser(browser, `Ana AT ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família AT ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();
  await expect(p.getByLabel("Nome", { exact: true })).toHaveValue("");

  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByRole("combobox", { name: "Pessoa" }).selectOption({ label: "Gabriel" });
  await p.getByLabel("Medicamento").fill("Vitamina D");
  await p.getByLabel("Dose conforme a prescrição").fill("1 cápsula");
  await p.getByLabel("Horário 1", { exact: true }).fill(start.slice(11, 16));
  await p.getByLabel(/Primeira dose \(data e hora\)/).fill(start);
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await activate(p);
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();

  await goToday(p);
  const overdue = p.getByRole("region", { name: "Atrasadas de outros dias" });
  const toggle = overdue.getByRole("button", { name: "Ver 2 doses atrasadas de outros dias" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(overdue.getByRole("link", { name: /Vitamina D/ })).toHaveCount(2);

  // Registrar uma delas: sai da lista.
  await overdue.getByRole("link", { name: /Vitamina D/ }).first().click();
  await expect(p.getByRole("heading", { name: "Dose", exact: true })).toBeVisible();
  await p.getByRole("button", { name: "Confirmar administração" }).click();
  await goToday(p);
  await expect(p.getByRole("button", { name: "Ver 1 dose atrasada de outro dia" })).toBeVisible();
  await ana.context.close();
});
