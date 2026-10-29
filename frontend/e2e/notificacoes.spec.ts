import { expect, test } from "@playwright/test";
import { localTime, newUser, run, shot, activate, goOffline, goOnline } from "./helpers";

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

  // Horário de silêncio: ligar já traz início e fim, que ficam e podem ser ajustados.
  await p.getByRole("checkbox", { name: "Horário de silêncio" }).click();
  await expect(p.getByLabel("Início do silêncio")).toHaveValue("22:00");
  await expect(p.getByLabel("Fim do silêncio")).toHaveValue("07:00");
  await p.waitForTimeout(500);
  await expect(p.getByRole("checkbox", { name: "Horário de silêncio" })).toBeChecked();
  await expect(p.getByText("Informe início e fim do horário de silêncio.")).toHaveCount(0);
  // Só recarrega depois que a mudança chegou à API.
  const salvo = p.waitForResponse((r) => r.url().endsWith("/api/me/notification-settings")
    && r.request().method() === "PUT" && (r.request().postData() ?? "").includes("23:30") && r.ok());
  await p.getByLabel("Início do silêncio").fill("23:30");
  await salvo;
  await p.reload();
  await expect(p.getByRole("checkbox", { name: "Horário de silêncio" })).toBeChecked();
  await expect(p.getByLabel("Início do silêncio")).toHaveValue("23:30");
  await expect(p.getByLabel("Fim do silêncio")).toHaveValue("07:00");

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
  await activate(p);
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

  // Lembrar daqui a pouco: só o lembrete da Ana muda; a dose fica no horário.
  const snooze = p.getByRole("region", { name: "Lembrar daqui a pouco" });
  await snooze.getByRole("button", { name: "15 min" }).click();
  await expect(snooze.getByText("Vamos lembrar você às")).toBeVisible();
  await expect(snooze.getByText(`a dose continua prevista para as ${T_PLUS_60}`)).toBeVisible();
  await snooze.getByRole("button", { name: "Cancelar o adiamento" }).click();
  await expect(snooze.getByText("Vamos lembrar você às")).toHaveCount(0);
  // Offline: fica no aparelho, aguardando envio, e sincroniza depois.
  await goOffline(ana.context, p);
  await snooze.getByRole("button", { name: "30 min" }).click();
  await expect(snooze.getByText("Aguardando envio")).toBeVisible();
  await expect(snooze.getByText("Vamos lembrar você às")).toBeVisible();
  await shot(p, "12-lembrar-depois");
  await goOnline(ana.context, p);
  await expect(snooze.getByText("Aguardando envio")).toHaveCount(0);
  await expect(snooze.getByText("Vamos lembrar você às")).toBeVisible();
  // Bruno não vê o adiamento da Ana.
  await b.reload();
  await expect(b.getByRole("button", { name: /Você está cuidando até/ })).toBeVisible();
  await expect(b.getByText("Vamos lembrar você às")).toHaveCount(0);

  // Atalho para mudar os horários de vez: a alteração do tratamento, com vigência e motivo.
  await p.getByRole("link", { name: "Mudar horários do tratamento" }).click();
  await expect(p.getByRole("heading", { name: "Alterar tratamento" })).toBeVisible();
  await expect(p.getByText("Motivo da alteração")).toBeVisible();

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
