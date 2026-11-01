import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { activate, localTime, newUser, run, shot } from "./helpers";

/** Regras WCAG 2.1 níveis A e AA, mais as da 2.2 AA (ex.: tamanho dos alvos de toque). */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function audit(page: Page, screen: string, problems: string[]) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  for (const v of violations) {
    problems.push(`${screen}: ${v.id} (${v.impact}) ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  }
}

test("acessibilidade (WCAG 2.2 AA), política de conteúdo e cabeçalhos de segurança", async ({ browser }) => {
  const T_MINUS_60 = localTime(-60);
  const problems: string[] = [];
  const blocked: string[] = [];

  // Tela de entrada, antes do login
  const context = await browser.newContext({ locale: "pt-BR" });
  const login = await context.newPage();
  login.on("console", (m) => m.text().includes("Content Security Policy") && blocked.push(m.text()));
  const response = await login.goto("/");
  if (process.env.E2E_BASE_URL) {
    // Servido pelo nginx de produção (compose): os cabeçalhos precisam estar lá.
    const headers = response!.headers();
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["strict-transport-security"]).toContain("max-age=");
  }
  await expect(login.getByLabel("Seu nome")).toBeVisible();
  await audit(login, "Entrar", problems);
  await shot(login, "q-entrar");
  await context.close();

  const ana = await newUser(browser, `Ana A ${run}`);
  const p = ana.page;
  p.on("console", (m) => m.text().includes("Content Security Policy") && blocked.push(m.text()));
  await expect(p.getByLabel("Nome da família")).toBeVisible();
  await audit(p, "Começar", problems);
  await p.getByLabel("Nome da família").fill(`Família A ${run}`);
  await p.getByRole("button", { name: "Criar família" }).click();

  await p.getByRole("link", { name: "Família" }).click();
  await p.getByLabel("Nome", { exact: true }).fill("Gabriel");
  await p.getByRole("button", { name: "Adicionar pessoa" }).click();
  await expect(p.getByRole("listitem").filter({ hasText: "Gabriel" })).not.toContainText("Aguardando envio");
  await audit(p, "Família", problems);
  await shot(p, "q-familia");

  await p.getByRole("link", { name: "Tratamentos" }).click();
  await p.getByRole("link", { name: "Novo tratamento" }).click();
  await audit(p, "Novo tratamento", problems);
  await p.getByRole("combobox", { name: "Pessoa" }).selectOption({ label: "Gabriel" });
  await p.getByLabel("Medicamento").fill("Medicamento A");
  await p.getByLabel("Dose conforme a prescrição").fill("5 ml");
  await p.getByLabel("Horário 1", { exact: true }).fill(T_MINUS_60);
  await p.getByRole("button", { name: "Conferir" }).click();
  await audit(p, "Confira antes de salvar", problems);
  await p.getByRole("button", { name: "Salvar" }).click();
  await p.getByRole("button", { name: "Ativar agenda" }).click();
  await audit(p, "Ativar agenda (pergunta das doses)", problems);
  await p.getByRole("button", { name: "Cancelar" }).click();
  await activate(p);
  await expect(p.getByText("Ativo", { exact: true })).toBeVisible();
  await audit(p, "Tratamento", problems);
  await shot(p, "q-tratamento");
  await p.getByRole("link", { name: "Tratamentos" }).click();
  await audit(p, "Tratamentos", problems);
  await shot(p, "q-tratamentos");

  await p.getByRole("link", { name: "Hoje" }).click();
  await expect(p.getByRole("link", { name: new RegExp(T_MINUS_60) })).toBeVisible();
  await audit(p, "Hoje", problems);
  await p.locator(".next-dose").getByRole("button", { name: /Dada no horário/ }).click();
  await expect(p.getByRole("dialog", { name: "Dada no horário?" })).toBeVisible();
  await audit(p, "Dada no horário (confirmação)", problems);
  await p.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  await p.getByRole("link", { name: new RegExp(T_MINUS_60) }).click();
  await expect(p.getByRole("button", { name: "Confirmar administração" })).toBeVisible();
  await audit(p, "Dose", problems);
  await p.getByRole("button", { name: "Confirmar administração" }).click();
  await expect(p.getByRole("heading", { name: "Hoje" })).toBeVisible();

  await p.getByRole("link", { name: "Saúde" }).click();
  await audit(p, "Saúde", problems);
  await p.getByRole("link", { name: "+ Aferição" }).first().click();
  await audit(p, "Nova aferição", problems);
  await p.getByRole("link", { name: "Saúde" }).click();
  await p.getByRole("link", { name: "+ Sintoma" }).first().click();
  await audit(p, "Novo sintoma", problems);

  await p.getByRole("link", { name: "Histórico" }).click();
  await audit(p, "Histórico", problems);
  await shot(p, "q-historico");
  await p.goto("/conflitos");
  await expect(p.getByRole("heading", { name: "Para conferir" })).toBeVisible();
  await audit(p, "Para conferir", problems);

  // Teclado: o elemento focado tem contorno visível.
  // Parte de um ponto conhecido (o campo "Nome" da nova pessoa) e volta pelo
  // teclado até o botão anterior: a aba Família é a última, e Tab a partir
  // dela sairia da página.
  await p.getByRole("link", { name: "Família", exact: true }).click();
  await p.getByLabel("Nome", { exact: true }).focus();
  await p.keyboard.press("Shift+Tab");
  const outline = await p.evaluate(() => {
    const el = document.activeElement!;
    const style = getComputedStyle(el);
    return { tag: el.tagName, style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(["A", "BUTTON"]).toContain(outline.tag);
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThanOrEqual(2);

  // Tema escuro (o app segue o do sistema): contraste também precisa passar.
  await p.emulateMedia({ colorScheme: "dark" });
  for (const [screen, link] of [["Hoje", "Hoje"], ["Tratamentos", "Tratamentos"], ["Saúde", "Saúde"], ["Família", "Família"]]) {
    await p.getByRole("link", { name: link, exact: true }).click();
    await audit(p, `${screen} (tema escuro)`, problems);
    await shot(p, `q-escuro-${link}`);
  }

  expect(problems, problems.join("\n")).toEqual([]);
  expect(blocked, blocked.join("\n")).toEqual([]);
});
