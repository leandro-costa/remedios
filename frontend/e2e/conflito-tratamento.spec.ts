import { expect, test, type Page } from "@playwright/test";
import { activate, goOffline, goOnline, localTime, newUser, run, shot } from "./helpers";

async function editDose(p: Page, dose: string) {
  await p.getByRole("link", { name: "Editar" }).click();
  await p.getByLabel("Dose conforme a prescrição").fill(dose);
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await expect(p.getByText(dose, { exact: true })).toBeVisible();
}

test("dois aparelhos offline alteram o mesmo tratamento: a segunda alteração vai para conferência", async ({ browser }) => {
  const T_PLUS_180 = localTime(180);
  const ana = await newUser(browser, `Ana C ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família C ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Davi");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();
  await expect(p.getByRole("listitem").filter({ hasText: "Davi" })).not.toContainText("Aguardando envio");

  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByRole("combobox", { name: "Pessoa" }).selectOption({ label: "Davi" });
  await p.getByLabel("Medicamento").fill("Xarope");
  await p.getByLabel("Dose conforme a prescrição").fill("5 ml");
  await p.getByLabel("Horário 1", { exact: true }).fill(T_PLUS_180);
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await activate(p);
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();
  const treatmentUrl = p.url();

  // Bruno entra e abre o tratamento enquanto tem conexão (fica a cópia no aparelho)
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByRole("button", { name: "Convidar responsável" }).click();
  const code = (await p.getByTestId("invite-code").textContent())!.trim();
  const bruno = await newUser(browser, `Bruno C ${run}`);
  const b = bruno.page;
  await b.getByLabel("Código do convite").fill(code);
  await b.getByRole("button", { name: "Entrar na família" }).click();
  await expect(b.getByRole("heading", { name: /Hoje/ })).toBeVisible();
  await b.goto(treatmentUrl);
  await expect(b.getByText("5 ml", { exact: true })).toBeVisible();
  await p.goto(treatmentUrl);
  await expect(p.getByText("5 ml", { exact: true })).toBeVisible();

  // Os dois ficam sem conexão e alteram a dose de jeitos diferentes
  await goOffline(ana.context, p);
  await goOffline(bruno.context, b);
  await editDose(p, "7 ml");
  await editDose(b, "10 ml");
  await expect(b.getByText("Alteração aguardando envio")).toBeVisible();

  // A Ana volta primeiro: a alteração dela vale
  await goOnline(ana.context, p);
  await expect(p.locator(".queue-float")).not.toContainText("aguardando envio", { timeout: 15_000 });

  // O Bruno volta depois: a alteração dele não é aplicada nem perdida
  await goOnline(bruno.context, b);
  await expect(b.locator(".queue-float")).not.toContainText("aguardando envio", { timeout: 15_000 });
  await b.reload();
  await expect(b.getByText("7 ml", { exact: true })).toBeVisible();
  await expect(b.getByText("Há uma alteração feita sem conexão aguardando conferência")).toBeVisible();
  await expect(b.getByRole("link", { name: "Editar" })).toHaveCount(0);

  // A Ana confere e aplica a alteração do Bruno, com motivo
  await p.getByRole("link", { name: "Hoje" }).click();
  await p.getByRole("link", { name: /1 alteração de tratamento precisa de conferência/ }).click();
  await expect(p.getByRole("heading", { name: "Xarope" })).toBeVisible();
  await expect(p.getByText("Dose: 7 ml → 10 ml")).toBeVisible();
  await p.getByLabel(/Como foi decidido/).fill("Conferimos a receita nova");
  await shot(p, "11-conferencia-tratamento");
  await p.getByRole("button", { name: "Aplicar esta alteração" }).click();
  await expect(p.getByText("Nada para conferir.")).toBeVisible();

  await b.reload();
  await expect(b.getByText("10 ml", { exact: true })).toBeVisible();
  await expect(b.getByRole("link", { name: "Editar" })).toBeVisible();
});
