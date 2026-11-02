import { expect, test } from "@playwright/test";
import { activate, localDateTime, newUser, run } from "./helpers";

test("a cada N horas: antecipar o horário da primeira dose no mesmo dia cria a dose e reavalia a série", async ({ browser }) => {
  const first = localDateTime(-60);
  const earlier = localDateTime(-90);
  const ana = await newUser(browser, `Ana PI ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família PI ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Isabela");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();
  await expect(p.getByLabel("Nome", { exact: true })).toHaveValue("");

  // A cada 12 horas; a primeira dose (data e hora) define o horário da série.
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByRole("combobox", { name: "Pessoa" }).selectOption({ label: "Isabela" });
  await p.getByLabel("Medicamento").fill("Amoxicilina 875 mg");
  await p.getByLabel("Dose conforme a prescrição").fill("1 comprimido");
  await p.getByRole("radio", { name: "A cada N horas" }).click();
  await p.getByRole("spinbutton", { name: /A cada/ }).fill("12");
  await p.getByLabel(/Primeira dose \(data e hora\)/).fill(first);
  await expect(p.getByLabel("Primeira dose às")).toHaveValue(first.slice(11, 16));
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await activate(p, /Sim, foi dada no horário previsto/);
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();

  // Editar: a primeira dose foi meia hora antes, no mesmo dia.
  await p.getByRole("link", { name: "Editar" }).click();
  await p.getByLabel(/Primeira dose \(data e hora\)/).fill(earlier);
  await expect(p.getByLabel("Primeira dose às")).toHaveValue(earlier.slice(11, 16));
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("radio", { name: /Sim, foram dadas/ }).check();
  await p.getByRole("button", { name: "Salvar" }).click();

  // A dose do novo horário entra como dada; a do horário antigo continua registrada.
  const doses = p.getByRole("region", { name: "Doses do tratamento" });
  await expect(doses.getByRole("link", { name: new RegExp(`Hoje · ${earlier.slice(11, 16)}`) })).toContainText("Administrada");
  await expect(doses.getByRole("link", { name: new RegExp(`Hoje · ${first.slice(11, 16)}`) })).toContainText("Administrada");
  await expect(p.getByText(/A cada 12 horas, a partir das/)).toContainText(earlier.slice(11, 16));
  await ana.context.close();
});
