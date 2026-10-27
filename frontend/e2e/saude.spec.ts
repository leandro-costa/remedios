import { expect, test, type Page } from "@playwright/test";
import { goOffline, goOnline, localDateTime, localTime, newUser, run, shot, activate } from "./helpers";

async function measure(p: Page, type: string, values: string[], minutesAgo: number) {
  await p.getByRole("link", { name: "+ Aferição" }).first().click();
  await p.getByRole("radio", { name: type }).click();
  const inputs = p.locator("input.value-input");
  for (let i = 0; i < values.length; i++) await inputs.nth(i).fill(values[i]);
  await p.getByLabel("Horário da medida").fill(localDateTime(-minutesAgo));
  await p.getByRole("button", { name: "Salvar aferição" }).click();
  await expect(p.getByRole("heading", { name: "Saúde" })).toBeVisible();
}

test("aferições com gráfico, referência, offline e sintomas", async ({ browser }) => {
  // Horários fixados no início: evita a virada de minuto durante o teste.
  const T_MINUS_75 = localTime(-75);
  const ana = await newUser(browser, `Ana S ${run}`);
  const p = ana.page;
  await p.getByLabel("Nome da família").fill(`Família S ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();
  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();
  await expect(p.getByText("Gabriel", { exact: true })).toBeVisible();

  // Antitérmico dado há pouco mais de 1 h
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await p.getByLabel("Pessoa").selectOption({ label: "Gabriel" });
  await p.getByLabel("Medicamento").fill("Antitérmico");
  await p.getByLabel("Dose conforme a prescrição").fill("10 gotas");
  await p.getByLabel("Horário 1", { exact: true }).fill(T_MINUS_75);
  await p.getByRole("button", { name: "Conferir" }).click();
  await p.getByRole("button", { name: "Salvar" }).click();
  await activate(p);
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();
  await p.getByRole("link", { name: "Hoje" }).click();
  await p.getByRole("link", { name: new RegExp(T_MINUS_75) }).click();
  await p.getByLabel("Horário efetivo").fill(localDateTime(-70));
  await p.getByRole("button", { name: "Confirmar administração" }).click();
  await expect(p.getByRole("link", { name: new RegExp(T_MINUS_75) })).toContainText("Administrada");

  // Temperaturas
  await p.getByRole("link", { name: "Saúde" }).click();
  await measure(p, "Temperatura", ["38,6"], 120);
  await measure(p, "Temperatura", ["38.1"], 60);
  const chart = p.getByRole("img", { name: /Temperatura: 2 aferições; a última, 38,1 °C/ });
  await expect(chart).toBeVisible();

  // Linha de referência da família
  await p.getByRole("button", { name: "+ Referência" }).click();
  await p.locator(".reference-editor input").first().fill("37,8");
  await p.getByLabel("Origem da orientação").fill("Orientação do pediatra");
  await p.getByRole("button", { name: "Salvar referência" }).click();
  await expect(p.getByText("37,8 °C · Orientação do pediatra")).toBeVisible();

  // Tocar num ponto mostra o valor e a última dose antes dele
  const marker = await p.locator(".chart .marker-1").nth(1).boundingBox();
  await p.mouse.move(marker!.x + marker!.width / 2, marker!.y + marker!.height / 2);
  await expect(p.locator(".tooltip")).toContainText("38,1 °C");
  await expect(p.locator(".tooltip")).toContainText("Última dose antes: Antitérmico");
  await shot(p, "6-grafico-temperatura");

  // Sem internet: a aferição fica na fila e aparece no gráfico como pendente
  await goOffline(ana.context, p);
  await measure(p, "Temperatura", ["37,2"], 5);
  await expect(p.getByText("1 registro aguardando envio")).toBeVisible();
  await expect(p.locator(".chart .marker-1.pending")).toHaveCount(1);
  await goOnline(ana.context, p);
  await expect(p.getByText("Sincronizado")).toBeVisible();
  await expect(p.getByRole("img", { name: /Temperatura: 3 aferições; a última, 37,2 °C/ })).toBeVisible();

  // Pressão arterial: duas séries com legenda
  await measure(p, "Pressão arterial", ["120", "80"], 30);
  await expect(p.getByRole("heading", { name: "Pressão arterial (mmHg)" })).toBeVisible();
  await expect(p.getByLabel("Legenda").first()).toContainText("Sistólica");

  // Sintoma como possível reação, e depois o fim
  await p.getByRole("link", { name: "+ Sintoma" }).first().click();
  await p.getByRole("button", { name: "Manchas na pele" }).click();
  await p.getByRole("radio", { name: "Leve" }).click();
  await p.getByLabel(/Possível reação/).selectOption({ label: "Antitérmico" });
  await p.getByRole("button", { name: "Salvar sintoma" }).click();
  await expect(p.getByRole("heading", { name: "Sintomas em andamento" })).toBeVisible();
  await expect(p.getByText("Sintoma: Manchas na pele (leve)")).toBeVisible();
  await expect(p.getByText(/possível reação/).first()).toBeVisible();
  await shot(p, "7-saude");

  await p.getByRole("link", { name: /Manchas na pele · Leve/ }).click();
  await p.getByRole("button", { name: "Registrar fim" }).click();
  await expect(p.getByRole("heading", { name: "Saúde" })).toBeVisible();
  await expect(p.getByRole("heading", { name: "Sintomas em andamento" })).toHaveCount(0);
  await expect(p.getByText("Fim: Manchas na pele")).toBeVisible();

  await ana.context.close();
});
