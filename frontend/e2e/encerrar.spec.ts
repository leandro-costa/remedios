import { expect, test } from "@playwright/test";
import { activate, localTime, newUser, run } from "./helpers";

test("doses de tratamento encerrado não aparecem na tela Hoje", async ({ browser }) => {
  const T_PLUS_60 = localTime(60);
  const ana = await newUser(browser, `Ana E ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família E ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();

  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByLabel("Pessoa").selectOption({ label: "Gabriel" });
  await p.getByLabel("Medicamento").fill("Xarope E");
  await p.getByLabel("Dose conforme a prescrição").fill("5 ml");
  await p.getByLabel("Horário 1", { exact: true }).fill(T_PLUS_60);
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await activate(p);
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();

  await p.getByRole("link", { name: "Hoje" }).click();
  await expect(p.getByRole("link", { name: new RegExp(T_PLUS_60) })).toContainText("Xarope E");

  // Encerra: as doses futuras são canceladas e saem do dia.
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: /Xarope E/ }).click();
  await p.getByRole("button", { name: "Encerrar" }).click();
  await p.getByRole("button", { name: "Confirmar" }).click();
  await expect(p.getByText("Encerrado", { exact: true })).toBeVisible();

  await p.getByRole("link", { name: "Hoje" }).click();
  await expect(p.getByText("Nenhuma dose prevista para hoje.")).toBeVisible();
  await expect(p.getByRole("link", { name: new RegExp(T_PLUS_60) })).toHaveCount(0);

  // Aba Tratamentos abre em "Ativos": o encerrado fica em "Encerrados".
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await expect(p.getByRole("button", { name: "Ativos" })).toHaveClass(/chip-on/);
  await expect(p.getByRole("link", { name: /Xarope E/ })).toHaveCount(0);
  await p.getByRole("button", { name: "Encerrados" }).click();
  await expect(p.getByRole("link", { name: /Xarope E/ })).toBeVisible();
  await ana.context.close();
});
