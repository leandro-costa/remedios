import { describe, expect, it } from "vitest";
import { describeSchedule, emptyScheduleForm, formFromRule, ruleFromForm, slotsBetween, validateScheduleForm } from "../src/lib/schedule";

describe("agenda", () => {
  it("envia só os campos do tipo escolhido, com horários ordenados", () => {
    const form = { ...emptyScheduleForm("America/Bahia"), times: ["20:00", "08:00", ""], everyDays: 1 };
    expect(ruleFromForm(form)).toEqual({ type: "DAILY", timezone: "America/Bahia", times: ["08:00", "20:00"], everyDays: 1 });
    expect(ruleFromForm({ ...form, type: "INTERVAL", everyHours: 8, firstDoseAt: "06:00" }))
      .toEqual({ type: "INTERVAL", timezone: "America/Bahia", everyHours: 8, firstDoseAt: "06:00" });
    expect(ruleFromForm({ ...form, type: "WEEKLY", daysOfWeek: ["THURSDAY", "MONDAY"] }).daysOfWeek)
      .toEqual(["MONDAY", "THURSDAY"]);
  });

  it("descreve a agenda em português", () => {
    expect(describeSchedule({ type: "DAILY", timezone: "UTC", times: ["20:00", "08:00:00"], everyDays: 1 }))
      .toBe("Todo dia às 08:00 e 20:00");
    expect(describeSchedule({ type: "DAILY", timezone: "UTC", times: ["09:00"], everyDays: 2 }))
      .toBe("A cada 2 dias, às 09:00");
    expect(describeSchedule({ type: "WEEKLY", timezone: "UTC", times: ["07:00"], daysOfWeek: ["MONDAY", "THURSDAY"] }))
      .toBe("Seg e Qui às 07:00");
    expect(describeSchedule({ type: "INTERVAL", timezone: "UTC", everyHours: 8, firstDoseAt: "06:00:00" }))
      .toBe("A cada 8 horas, a partir das 06:00");
    expect(describeSchedule(null)).toBe("Sem agenda definida");
  });

  it("valida antes de enviar", () => {
    const base = emptyScheduleForm("UTC");
    expect(validateScheduleForm(base)).toBeNull();
    expect(validateScheduleForm({ ...base, times: [""] })).toMatch(/horário/);
    expect(validateScheduleForm({ ...base, type: "WEEKLY" })).toMatch(/dia da semana/);
    expect(validateScheduleForm({ ...base, type: "INTERVAL", everyHours: 0 })).toMatch(/168/);
  });

  it("carrega a regra salva no formulário", () => {
    const form = formFromRule({ type: "WEEKLY", timezone: "America/Sao_Paulo", times: ["07:00:00"], daysOfWeek: ["FRIDAY"] }, "UTC");
    expect(form).toMatchObject({ type: "WEEKLY", timezone: "America/Sao_Paulo", times: ["07:00"], daysOfWeek: ["FRIDAY"] });
  });
});

describe("horários previstos (doses anteriores)", () => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  it("conta as doses diárias entre o início e agora", () => {
    const rule = { type: "DAILY" as const, timezone: tz, times: ["08:00", "20:00"], everyDays: 1 };
    const start = new Date(2026, 9, 20, 10, 0);
    const now = new Date(2026, 9, 22, 9, 0);
    const slots = slotsBetween(rule, start, start, now)!;
    expect(slots.map((d) => `${d.getDate()} ${d.getHours()}`)).toEqual(["20 20", "21 8", "21 20", "22 8"]);
  });

  it("intervalo a partir da primeira dose do dia de início", () => {
    const rule = { type: "INTERVAL" as const, timezone: tz, everyHours: 8, firstDoseAt: "06:00" };
    const start = new Date(2026, 9, 20, 7, 0);
    const slots = slotsBetween(rule, start, start, new Date(2026, 9, 21, 7, 0))!;
    expect(slots.map((d) => d.getHours())).toEqual([14, 22, 6]);
  });

  it("agenda em outro fuso: sem contagem", () => {
    const rule = { type: "DAILY" as const, timezone: tz === "Asia/Tokyo" ? "UTC" : "Asia/Tokyo", times: ["08:00"], everyDays: 1 };
    expect(slotsBetween(rule, new Date(), new Date(), new Date())).toBeNull();
  });
});
