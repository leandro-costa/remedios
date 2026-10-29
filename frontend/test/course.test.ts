import { describe, expect, it } from "vitest";
import type { ScheduleRule } from "../src/api/types";
import { dosesInDays, planCourse } from "../src/lib/schedule";

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const twiceADay: ScheduleRule = { type: "DAILY", timezone: tz, times: ["08:00", "20:00"], everyDays: 1 };

describe("tratamento por número de doses", () => {
  it("5 dias, 2 vezes ao dia, começando às 20h: 10 doses, a última no 6º dia às 8h", () => {
    const first = new Date(2026, 0, 1, 20, 0);
    expect(dosesInDays(twiceADay, first, 5)).toBe(10);
    const plan = planCourse(twiceADay, first, { doseCount: 10 })!;
    expect(plan.count).toBe(10);
    expect(plan.first).toEqual(first);
    expect(plan.last).toEqual(new Date(2026, 0, 6, 8, 0));
    expect(plan.days).toBe(5);
  });

  it("começando às 8h: 10 doses terminam no 5º dia às 20h", () => {
    const first = new Date(2026, 0, 1, 8, 0);
    expect(dosesInDays(twiceADay, first, 5)).toBe(10);
    expect(planCourse(twiceADay, first, { doseCount: 10 })!.last).toEqual(new Date(2026, 0, 5, 20, 0));
  });

  it("a cada 8 horas por 7 dias: 21 doses", () => {
    const rule: ScheduleRule = { type: "INTERVAL", timezone: tz, everyHours: 8, firstDoseAt: "06:00" };
    expect(dosesInDays(rule, new Date(2026, 0, 1, 6, 0), 7)).toBe(21);
  });

  it("término por data: conta as doses até a data", () => {
    const plan = planCourse(twiceADay, new Date(2026, 0, 1, 20, 0), { endAt: new Date(2026, 0, 5, 20, 1) })!;
    expect(plan.count).toBe(9);
  });

  it("sem término: sem plano", () => {
    expect(planCourse(twiceADay, new Date(2026, 0, 1), {})).toBeNull();
  });
});
