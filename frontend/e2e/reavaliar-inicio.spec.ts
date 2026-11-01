import { expect, test } from "@playwright/test";
import { activate, localDateTime, localTime, newUser, run } from "./helpers";

test("mudar o início de um tratamento ativo reavalia as doses", async ({ browser }) => {
  // Uma dose por dia, uma hora atrás; o tratamento começou ontem.
  const H = localTime(-60);
  const ana = await newUser(browser, `Ana R ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família R ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByRole("combobox", { name: "Pessoa" }).selectOption({ label: "Gabriel" });
  await p.getByLabel("Medicamento").fill("Antialérgico");
  await p.getByLabel("Dose conforme a prescrição").fill("1 comprimido");
  await p.getByLabel("Horário 1", { exact: true }).fill(H);
  await p.getByLabel("Primeira dose (data e hora)").fill(localDateTime(-24 * 60 - 120));
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await activate(p);
  const progress = p.getByRole("region", { name: "Andamento do tratamento" });
  await expect(progress.getByText("Sem registro").locator("..")).toContainText("2");

  // Na verdade começou dois dias antes: as duas doses a mais já foram dadas.
  await p.getByRole("link", { name: "Editar" }).click();
  await p.getByLabel("Primeira dose (data e hora)").fill(localDateTime(-3 * 24 * 60 - 120));
  await p.getByRole("button", { name: "Conferir" }).click();
  await expect(p.getByText("As 2 doses previstas antes do início antigo já foram dadas?")).toBeVisible();
  await expect(p.getByRole("button", { name: "Salvar" })).toBeDisabled();
  await p.getByRole("radio", { name: /Sim, foram dadas/ }).check();
  await p.getByRole("button", { name: "Salvar" }).click();
  await expect(progress.getByText("Dadas", { exact: true }).locator("..")).toContainText("2");
  await expect(progress.getByText("Sem registro").locator("..")).toContainText("2");

  // Adiado para hoje: as anteriores sem registro são canceladas; as dadas continuam.
  await p.getByRole("link", { name: "Editar" }).click();
  await p.getByLabel("Primeira dose (data e hora)").fill(localDateTime(-120));
  await p.getByRole("button", { name: "Conferir" }).click();
  await expect(p.getByText(/as doses sem registro antes disso serão canceladas/)).toBeVisible();
  await p.getByRole("button", { name: "Salvar" }).click();
  await expect(progress.getByText("Dadas", { exact: true }).locator("..")).toContainText("2");
  await expect(progress.getByText("Sem registro").locator("..")).toContainText("1");
  await ana.context.close();
});
