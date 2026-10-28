import { expect, test } from "@playwright/test";
import { goOffline, goOnline, localTime, newUser, run, shot } from "./helpers";

test("cadastro, registro, offline e dois responsáveis", async ({ browser }) => {
  // Horários fixados no início: evita a virada de minuto durante o teste.
  const T_MINUS_60 = localTime(-60);
  const T_PLUS_120 = localTime(120);
  const ana = await newUser(browser, `Ana ${run}`);
  const p = ana.page;

  // Família e pessoa
  await p.getByLabel("Nome da família").fill(`Família ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await expect(p.getByRole("heading", { name: /Hoje/ })).toBeVisible();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();
  await expect(p.getByText("Gabriel", { exact: true })).toBeVisible();

  // Tratamento com doses 1 h atrás e daqui a 2 h
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByLabel("Pessoa").selectOption({ label: "Gabriel" });
  await p.getByLabel("Medicamento").fill("Medicamento A");
  await p.getByLabel("Dose conforme a prescrição").fill("5 ml");
  await p.getByLabel("Horário 1", { exact: true }).fill(T_MINUS_60);
  await p.getByRole("button", { name: "+ Adicionar horário" }).click();
  await p.getByLabel("Horário 2", { exact: true }).fill(T_PLUS_120);
  await p.getByRole("button", { name: "Conferir" }).click();
  await expect(p.getByText(`Todo dia às ${[T_MINUS_60, T_PLUS_120].sort().join(" e ")}`)).toBeVisible();
  await shot(p, "3-conferir-tratamento");
  await p.getByRole("button", { name: "Salvar" }).click();
  await expect(p.getByText("Rascunho", { exact: true })).toBeVisible();
  // Começa hoje às 00:00 e já passou uma dose: o app pergunta, sem presumir.
  await p.getByRole("button", { name: "Ativar agenda" }).click();
  await expect(p.getByText("A dose prevista até agora já foi dada?", { exact: false })).toBeVisible();
  await expect(p.getByRole("button", { name: "Confirmar" })).toBeDisabled();
  await p.getByRole("radio", { name: /Não sei ou nem todas/ }).check();
  await p.getByRole("button", { name: "Confirmar" }).click();
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();

  // Registro online da dose de 1 h atrás
  await p.getByRole("link", { name: "Hoje" }).click();
  const first = p.getByRole("link", { name: new RegExp(T_MINUS_60) });
  await expect(first).toContainText("Atrasada");
  await shot(p, "1-hoje");
  await first.click();
  await expect(p.getByRole("button", { name: "Confirmar administração" })).toBeVisible();
  await shot(p, "2-dose");
  await p.getByRole("button", { name: "Confirmar administração" }).click();
  await expect(p.getByRole("link", { name: new RegExp(T_MINUS_60) })).toContainText("Administrada");
  await expect(p.getByText("Sincronizado")).toBeVisible();

  // Convite: Bruno entra e vê o registro da Ana
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByRole("button", { name: "Convidar responsável" }).click();
  const code = (await p.getByTestId("invite-code").textContent())!.trim();
  const bruno = await newUser(browser, `Bruno ${run}`);
  const b = bruno.page;
  await b.getByLabel("Código do convite").fill(code);
  await b.getByRole("button", { name: "Entrar na família" }).click();
  await expect(b.getByRole("link", { name: new RegExp(T_MINUS_60) })).toContainText(`Ana ${run}`);

  // Offline: a app abre sem rede (service worker + IndexedDB) e guarda o registro
  await b.evaluate(() => navigator.serviceWorker.ready);
  await b.reload();
  await expect(b.getByRole("link", { name: new RegExp(T_PLUS_120) })).toBeVisible();
  await goOffline(bruno.context, b);
  await b.reload();
  await expect(b.getByRole("link", { name: new RegExp(T_PLUS_120) })).toBeVisible();
  await expect(b.getByText(/Offline/).first()).toBeVisible();

  await b.getByRole("link", { name: new RegExp(T_PLUS_120) }).click();
  await b.getByRole("button", { name: "Confirmar administração" }).click();
  await expect(b.getByRole("link", { name: new RegExp(T_PLUS_120) })).toContainText("Aguardando envio");
  await expect(b.getByText("1 registro aguardando envio")).toBeVisible();
  await shot(b, "4-offline");

  // Enquanto Bruno está offline, Ana registra a mesma dose
  await p.getByRole("link", { name: "Hoje" }).click();
  await p.getByRole("link", { name: new RegExp(T_PLUS_120) }).click();
  await p.getByRole("button", { name: "Confirmar administração" }).click();
  await expect(p.getByRole("link", { name: new RegExp(T_PLUS_120) })).toContainText("Administrada");

  // Bruno volta: o registro dele é preservado e a dose vai para conferência
  await goOnline(bruno.context, b);
  await expect(b.getByText("Sincronizado")).toBeVisible();
  await expect(b.getByRole("link", { name: new RegExp(T_PLUS_120) })).toContainText("Conferir");
  await b.getByRole("link", { name: /precisa de conferência/ }).click();
  await expect(b.getByRole("heading", { name: "Para conferir" })).toBeVisible();
  await b.getByRole("link", { name: /Medicamento A/ }).click();
  await expect(b.getByRole("heading", { name: "Registros divergentes" })).toBeVisible();
  await expect(b.getByText(`Registro de Bruno ${run}`)).toBeVisible();
  await b.getByLabel(/Como foi decidido/).fill("Conversamos: foi dada uma vez, pela Ana");
  await shot(b, "5-conferencia");
  await b.getByRole("button", { name: "Manter o registro atual" }).click();
  await expect(b.getByText("Conferência concluída")).toBeVisible();

  // Histórico mostra quem registrou
  await p.getByRole("link", { name: "Histórico" }).click();
  await expect(p.getByText(`Registrado por Ana ${run}`).first()).toBeVisible();

  await ana.context.close();
  await bruno.context.close();
});
