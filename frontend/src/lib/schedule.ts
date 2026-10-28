import type { DayOfWeek, ScheduleRule, ScheduleType } from "../api/types";

export const WEEKDAYS: { value: DayOfWeek; short: string }[] = [
  { value: "MONDAY", short: "Seg" },
  { value: "TUESDAY", short: "Ter" },
  { value: "WEDNESDAY", short: "Qua" },
  { value: "THURSDAY", short: "Qui" },
  { value: "FRIDAY", short: "Sex" },
  { value: "SATURDAY", short: "Sáb" },
  { value: "SUNDAY", short: "Dom" },
];

/** Estado do editor de agenda (todos os campos, para alternar o tipo sem perder dados). */
export interface ScheduleForm {
  type: ScheduleType;
  timezone: string;
  times: string[];
  everyDays: number;
  daysOfWeek: DayOfWeek[];
  everyHours: number;
  firstDoseAt: string;
}

export function emptyScheduleForm(timezone: string): ScheduleForm {
  return { type: "DAILY", timezone, times: ["08:00"], everyDays: 1, daysOfWeek: [], everyHours: 8, firstDoseAt: "08:00" };
}

export function formFromRule(rule: ScheduleRule | null, timezone: string): ScheduleForm {
  const form = emptyScheduleForm(rule?.timezone ?? timezone);
  if (!rule) return form;
  return {
    ...form,
    type: rule.type,
    times: rule.times?.map(hhmm) ?? form.times,
    everyDays: rule.everyDays ?? 1,
    daysOfWeek: rule.daysOfWeek ?? [],
    everyHours: rule.everyHours ?? form.everyHours,
    firstDoseAt: rule.firstDoseAt ? hhmm(rule.firstDoseAt) : form.firstDoseAt,
  };
}

/** Regra enviada à API; só os campos do tipo escolhido. */
export function ruleFromForm(form: ScheduleForm): ScheduleRule {
  switch (form.type) {
    case "DAILY":
      return { type: "DAILY", timezone: form.timezone, times: sortedTimes(form.times), everyDays: form.everyDays };
    case "WEEKLY":
      return { type: "WEEKLY", timezone: form.timezone, times: sortedTimes(form.times), daysOfWeek: orderedDays(form.daysOfWeek) };
    case "INTERVAL":
      return { type: "INTERVAL", timezone: form.timezone, everyHours: form.everyHours, firstDoseAt: form.firstDoseAt };
  }
}

/** Problema do formulário, para mostrar antes de enviar; null se estiver ok. */
export function validateScheduleForm(form: ScheduleForm): string | null {
  if (form.type !== "INTERVAL" && form.times.filter(Boolean).length === 0) return "Informe ao menos um horário.";
  if (form.type === "DAILY" && (form.everyDays < 1 || form.everyDays > 365)) return "O intervalo deve ser de 1 a 365 dias.";
  if (form.type === "WEEKLY" && form.daysOfWeek.length === 0) return "Escolha ao menos um dia da semana.";
  if (form.type === "INTERVAL" && (form.everyHours < 1 || form.everyHours > 168)) return "O intervalo deve ser de 1 a 168 horas.";
  if (form.type === "INTERVAL" && !form.firstDoseAt) return "Informe o horário da primeira dose.";
  return null;
}

/** "Todo dia às 08:00 e 20:00", "Seg e Qui às 07:00", "A cada 8 horas, a partir das 06:00". */
export function describeSchedule(rule: ScheduleRule | null): string {
  if (!rule) return "Sem agenda definida";
  switch (rule.type) {
    case "DAILY": {
      const times = listTimes(rule.times ?? []);
      return rule.everyDays && rule.everyDays > 1 ? `A cada ${rule.everyDays} dias, ${times}` : `Todo dia ${times}`;
    }
    case "WEEKLY": {
      const days = WEEKDAYS.filter((d) => rule.daysOfWeek?.includes(d.value)).map((d) => d.short);
      return `${joinPt(days)} ${listTimes(rule.times ?? [])}`;
    }
    case "INTERVAL":
      return `A cada ${rule.everyHours} ${rule.everyHours === 1 ? "hora" : "horas"}, a partir das ${hhmm(rule.firstDoseAt ?? "")}`;
  }
}

function listTimes(times: string[]): string {
  const list = sortedTimes(times).map(hhmm);
  return `${list.length === 1 && list[0].startsWith("01:") ? "à" : "às"} ${joinPt(list)}`;
}

function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

function hhmm(time: string): string {
  return time.slice(0, 5);
}

function sortedTimes(times: string[]): string[] {
  return times.filter(Boolean).map(hhmm).sort();
}

function orderedDays(days: DayOfWeek[]): DayOfWeek[] {
  return WEEKDAYS.map((d) => d.value).filter((d) => days.includes(d));
}

const JS_DAY: DayOfWeek[] = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

function atLocal(day: Date, time: string): Date {
  const [h, m] = hhmm(time).split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
}

/**
 * Horários previstos em [from, to), com as mesmas regras do servidor (o dia
 * de início fixa a recorrência). Calcula no fuso deste aparelho; para uma
 * agenda em outro fuso, devolve null.
 */
export function slotsBetween(rule: ScheduleRule | null, anchor: Date, from: Date, to: Date): Date[] | null {
  if (!rule || rule.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone) return null;
  const slots: Date[] = [];
  const anchorDay = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  if (rule.type === "INTERVAL") {
    const period = (rule.everyHours ?? 1) * 3600_000;
    let at = atLocal(anchorDay, rule.firstDoseAt ?? "00:00").getTime();
    if (from.getTime() > at) at += Math.ceil((from.getTime() - at) / period) * period;
    for (; at < to.getTime() && slots.length < 2000; at += period) slots.push(new Date(at));
    return slots;
  }
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1);
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
  for (; day <= last && slots.length < 2000; day.setDate(day.getDate() + 1)) {
    const days = Math.round((day.getTime() - anchorDay.getTime()) / 86_400_000);
    const matches = rule.type === "DAILY"
      ? days >= 0 && days % (rule.everyDays ?? 1) === 0
      : (rule.daysOfWeek ?? []).includes(JS_DAY[day.getDay()]);
    if (!matches) continue;
    for (const time of rule.times ?? []) {
      const at = atLocal(day, time);
      if (at >= from && at < to) slots.push(at);
    }
  }
  return slots;
}
