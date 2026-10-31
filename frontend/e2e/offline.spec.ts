import { expect, test } from "@playwright/test";
import { goOffline, goOnline, localDateTime, localTime, newUser, run, shot } from "./helpers";

test("cadastros offline aparecem na hora e sincronizam ao voltar a conexão", async ({ browser }) => {
  // Horários fixados no início: evita a virada de minuto durante o teste.
  const T_MINUS_60 = localTime(-60);
  const YESTERDAY = localDateTime(-24 * 60);
  const ana = await newUser(browser, `Ana O ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família O ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await expect(p.getByRole("heading", { name: /Hoje/ })).toBeVisible();
  await p.getByRole("link", { name: "Família" }).click();
  await expect(p.getByRole("heading", { name: "Pessoas acompanhadas" })).toBeVisible();

  // Sem conexão: a pessoa é cadastrada no aparelho e aparece na hora
  await goOffline(ana.context, p);
  await p.getByLabel("Nome", { exact: true }).fill("Lia");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();
  const lia = p.getByRole("listitem").filter({ hasText: "Lia" });
  await expect(lia).toContainText("Aguardando envio");
  await expect(p.locator(".queue-float")).toContainText("1 aguardando envio");
  await shot(p, "9-pessoa-offline");

  // Ainda offline: tratamento para a pessoa recém-cadastrada, começando ontem
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByLabel("Pessoa").selectOption({ label: "Lia" });
  await p.getByLabel("Medicamento").fill("Antibiótico");
  await p.getByLabel("Dose conforme a prescrição").fill("5 ml");
  await p.getByLabel("Primeira dose (data e hora)").fill(YESTERDAY);
  await p.getByLabel("Horário 1", { exact: true }).fill(T_MINUS_60);
  await p.getByRole("button", { name: "Conferir" }).click();
  await expect(p.getByText("Sem conexão: fica guardado neste aparelho")).toBeVisible();
  await p.getByRole("button", { name: "Salvar" }).click();
  await expect(p.getByRole("heading", { name: "Antibiótico" })).toBeVisible();
  await expect(p.getByText("Rascunho", { exact: true })).toBeVisible();
  await expect(p.getByText("Alteração aguardando envio")).toBeVisible();

  // Ativar: começou ontem, então o app pergunta pelas doses anteriores
  await p.getByRole("button", { name: "Ativar agenda" }).click();
  await expect(p.getByText(/A dose prevista até agora já foi dada\?/)).toBeVisible();
  await p.getByRole("radio", { name: /Sim, foi dada no horário previsto/ }).check();
  await shot(p, "10-doses-anteriores");
  await p.getByRole("button", { name: "Confirmar" }).click();
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();
  // Pessoa, medicamento e receita novos (cadastrados junto com o tratamento), tratamento e ativação.
  await expect(p.locator(".queue-float")).toContainText("5 aguardando envio");

  // Conexão de volta: tudo é enviado na ordem, e a dose anterior aparece como dada
  await goOnline(ana.context, p);
  await expect(p.locator(".queue-float")).not.toContainText("aguardando envio", { timeout: 15_000 });
  await p.getByRole("link", { name: "Hoje" }).click();
  await expect(p.getByRole("link", { name: new RegExp(T_MINUS_60) })).toContainText("Administrada");
  await expect(p.getByText("Sincronizado")).toBeVisible();
  await p.getByRole("link", { name: "Família" }).click();
  await expect(lia).not.toContainText("Aguardando envio");
});
