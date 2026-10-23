import { expect, test } from "@playwright/test";
import { localTime, newUser, run, shot } from "./helpers";

test("estou cuidando da dose, notificações e lembretes avulsos", async ({ browser }) => {
  // Horários fixados no início: evita a virada de minuto durante o teste.
  const T_PLUS_60 = localTime(60);
  const ana = await newUser(browser, `Ana N ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família N ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();

  // Cartão de notificações deste aparelho
  await expect(p.getByRole("heading", { name: "Notificações neste aparelho" })).toBeVisible();
  await expect(p.getByRole("button", { name: "Ativar notificações" })).toBeVisible();
  await expect(p.getByText("Mostrar pessoa e medicamento no aviso (tela bloqueada)")).toBeVisible();

  // Convida Bruno
  await p.getByRole("button", { name: "Convidar responsável" }).click();
  const code = (await p.getByTestId("invite-code").textContent())!.trim();

  // Tratamento com dose daqui a 1 hora
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByLabel("Pessoa").selectOption({ label: "Gabriel" });
  await p.getByLabel("Medicamento").fill("Xarope");
  await p.getByLabel("Dose conforme a prescrição").fill("5 ml");
  await p.getByLabel("Horário 1", { exact: true }).fill(T_PLUS_60);
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await p.getByRole("button", { name: "Ativar agenda" }).click();
  await p.getByRole("button", { name: "Confirmar" }).click();
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();

  const bruno = await newUser(browser, `Bruno N ${run}`);
  const b = bruno.page;
  await b.getByLabel("Código do convite").fill(code);
  await b.getByRole("button", { name: "Entrar na família" }).click();

  // Bruno avisa que está cuidando; Ana vê
  await b.getByRole("link", { name: new RegExp(T_PLUS_60) }).click();
  await b.getByRole("button", { name: "Estou cuidando desta dose" }).click();
  await expect(b.getByRole("button", { name: /Você está cuidando até/ })).toBeVisible();
  await p.getByRole("link", { name: "Hoje" }).click();
  await p.getByRole("link", { name: new RegExp(T_PLUS_60) }).click();
  await expect(p.getByText(`Bruno N ${run} está cuidando desta dose`)).toBeVisible();
  await shot(p, "8-cuidando");

  // Lembrete avulso na aba Saúde
  await p.getByRole("link", { name: "Saúde" }).click();
  await p.getByRole("button", { name: "+ Lembrete" }).click();
  await p.getByRole("button", { name: "Em 30 min" }).click();
  await expect(p.getByText(/Medir a temperatura de novo/)).toBeVisible();
  await p.getByRole("button", { name: "Cancelar" }).first().click();
  await expect(p.getByText("Nenhum lembrete agendado.")).toBeVisible();

  await ana.context.close();
  await bruno.context.close();
});
