import { expect, test } from "@playwright/test";
import { activate, goOffline, goOnline, localTime, newUser, run, shot } from "./helpers";

test("dada no horário: um toque na tela Hoje, com confirmação, online e offline", async ({ browser }) => {
  // Horários fixados no início: evita a virada de minuto durante o teste.
  const T_MINUS_90 = localTime(-90);
  const T_MINUS_30 = localTime(-30);
  const T_PLUS_60 = localTime(60);
  const ana = await newUser(browser, `Ana H ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família H ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();
  await expect(p.getByText("Gabriel", { exact: true }).first()).toBeVisible();
  await expect(p.getByLabel("Nome", { exact: true })).toHaveValue("");

  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByLabel("Pessoa").selectOption({ label: "Gabriel" });
  await p.getByLabel("Medicamento").fill("Medicamento B");
  await p.getByLabel("Dose conforme a prescrição").fill("10 ml");
  await p.getByLabel("Horário 1", { exact: true }).fill(T_MINUS_90);
  await p.getByRole("button", { name: "+ Adicionar horário" }).click();
  await p.getByLabel("Horário 2", { exact: true }).fill(T_MINUS_30);
  await p.getByRole("button", { name: "+ Adicionar horário" }).click();
  await p.getByLabel("Horário 3", { exact: true }).fill(T_PLUS_60);
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await activate(p);
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();
  await p.getByRole("link", { name: "Hoje" }).click();

  // Cartão "Próxima dose": pede confirmação com pessoa, medicamento, dose e horário.
  const first = p.getByRole("link", { name: new RegExp(T_MINUS_90) });
  await expect(first).toContainText("Atrasada");
  await p.locator(".next-dose").getByRole("button", { name: `Dada no horário: Medicamento B de Gabriel às ${T_MINUS_90}` }).click();
  const dialog = p.getByRole("dialog", { name: "Dada no horário?" });
  await expect(dialog).toContainText(`Registrar que Gabriel recebeu Medicamento B (10 ml) às ${T_MINUS_90}`);
  await shot(p, "13-dada-no-horario");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(first).toContainText("Atrasada");

  await p.locator(".next-dose").getByRole("button", { name: /Dada no horário/ }).click();
  await dialog.getByRole("button", { name: `Confirmar: dada às ${T_MINUS_90}` }).click();
  await expect(first).toContainText("Administrada");
  await expect(first).toContainText(`${T_MINUS_90} · Ana H ${run}`);

  // Offline: o botão da lista registra no aparelho e envia quando a conexão volta.
  await goOffline(ana.context, p);
  const second = p.getByRole("link", { name: new RegExp(T_MINUS_30) });
  await p.getByRole("button", { name: `Dada no horário: Medicamento B de Gabriel às ${T_MINUS_30}` }).last().click();
  await dialog.getByRole("button", { name: `Confirmar: dada às ${T_MINUS_30}` }).click();
  await expect(second).toContainText("Aguardando envio");
  await expect(p.getByText("Sincronizado")).toHaveCount(0);
  await goOnline(ana.context, p);
  await expect(second).toContainText("Administrada");
  await expect(p.getByText("Sincronizado")).toBeVisible();
  await expect(p.getByRole("button", { name: /Dada no horário/ })).toHaveCount(0);

  // Dose de daqui a 1 h, dada antes: só "Dada agora", com o horário real.
  const third = p.getByRole("link", { name: new RegExp(T_PLUS_60) });
  await p.locator(".next-dose").getByRole("button", { name: `Dada agora: Medicamento B de Gabriel, prevista para ${T_PLUS_60}` }).click();
  const nowDialog = p.getByRole("dialog", { name: "Dada agora?" });
  await expect(nowDialog).toContainText(`(prevista para ${T_PLUS_60})`);
  await nowDialog.getByRole("button", { name: /Confirmar: dada às/ }).click();
  await expect(third).toContainText("Administrada");

  await ana.context.close();
});
