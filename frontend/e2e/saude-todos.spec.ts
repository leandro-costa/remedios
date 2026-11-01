import { expect, test } from "@playwright/test";
import { localDateTime, newUser, run } from "./helpers";

test("saúde: \"Todos\" agrupa por pessoa; a tela abre na última escolha, não em Todos", async ({ browser }) => {
  const ana = await newUser(browser, `Ana ST ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família ST ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  for (const name of ["Gabriel", "Lia"]) {
    await p.getByLabel("Nome", { exact: true }).fill(name);
    await p.getByRole("button", { name: "Adicionar pessoa" }).click();
    await expect(p.getByLabel("Nome", { exact: true })).toHaveValue("");
  }

  // Sem escolha guardada, abre na primeira pessoa; "Todos" é a primeira opção, mas não a padrão.
  await p.getByRole("link", { name: "Saúde" }).click();
  const chips = p.getByRole("group", { name: "Pessoa" }).getByRole("button");
  await expect(chips.first()).toHaveText("Todos");
  await expect(p.getByRole("button", { name: "Gabriel" })).toHaveClass(/chip-on/);
  await expect(p.getByRole("button", { name: "Todos" })).not.toHaveClass(/chip-on/);
  // Aferição do Gabriel e sintoma da Lia, cadastrados a partir de "Todos".
  await p.getByRole("button", { name: "Todos" }).click();
  await p.getByRole("link", { name: "+ Aferição" }).click();
  await p.getByRole("combobox", { name: "Pessoa" }).selectOption({ label: "Gabriel" });
  await p.getByRole("radio", { name: "Temperatura" }).click();
  await p.locator("input.value-input").first().fill("38,1");
  await p.getByLabel("Horário da medida").fill(localDateTime(-30));
  await p.getByRole("button", { name: "Salvar aferição" }).click();
  await p.getByRole("button", { name: "Todos" }).click();
  await p.getByRole("link", { name: "+ Sintoma" }).click();
  await p.getByRole("combobox", { name: "Pessoa" }).selectOption({ label: "Lia" });
  await p.getByRole("button", { name: "Manchas na pele" }).click();
  await p.getByRole("button", { name: "Salvar sintoma" }).click();
  await p.getByRole("button", { name: "Todos" }).click();

  const gabriel = p.getByRole("region", { name: "Saúde de Gabriel" });
  const lia = p.getByRole("region", { name: "Saúde de Lia" });
  await expect(gabriel).toContainText("Temperatura: 38,1 °C");
  await expect(lia).toContainText("Manchas na pele");
  await expect(gabriel).not.toContainText("Manchas na pele");

  // Ao voltar para a tela (e ao reabrir o app), continua em "Todos": a última escolha.
  await p.getByRole("link", { name: "Hoje", exact: true }).click();
  await p.getByRole("link", { name: "Saúde" }).click();
  await expect(p.getByRole("button", { name: "Todos" })).toHaveClass(/chip-on/);
  await p.goto("/saude");
  await expect(p.getByRole("button", { name: "Todos" })).toHaveClass(/chip-on/);

  // Hoje também guarda a escolha: Lia continua escolhida depois de reabrir.
  await p.goto("/");
  await expect(p.getByRole("button", { name: "Gabriel", exact: true })).toHaveClass(/chip-on/);
  await p.getByRole("button", { name: "Lia", exact: true }).click();
  await p.goto("/");
  await expect(p.getByRole("button", { name: "Lia", exact: true })).toHaveClass(/chip-on/);
  await p.getByRole("link", { name: "Saúde" }).click();

  // Abrir uma pessoa mostra os gráficos dela.
  await gabriel.getByRole("button", { name: "Ver gráficos e linha do tempo de Gabriel →" }).click();
  await expect(p.getByText("Aferições e sintomas de Gabriel")).toBeVisible();
  await expect(p.getByRole("img", { name: /Temperatura: 1 aferição/ })).toBeVisible();
  await ana.context.close();
});
