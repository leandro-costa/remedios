import { describe, expect, it } from "vitest";
import { niceTicks, timeTicks, timeWindow } from "../src/components/MeasurementChart";
import { formatMeasurement, parseNumber, referenceFor } from "../src/lib/health";
import type { ReferenceLineView } from "../src/api/types";

describe("aferições", () => {
  it("aceita vírgula ou ponto e recusa texto", () => {
    expect(parseNumber("38,4")).toBe(38.4);
    expect(parseNumber(" 38.4 ")).toBe(38.4);
    expect(parseNumber("120")).toBe(120);
    expect(parseNumber("38,4°")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });

  it("formata no padrão brasileiro, com unidade", () => {
    expect(formatMeasurement({ type: "TEMPERATURE", value: 38.4, unit: "°C" })).toBe("38,4 °C");
    expect(formatMeasurement({ type: "BLOOD_PRESSURE", value: 120, value2: 80, unit: "mmHg" })).toBe("120/80 mmHg");
    expect(formatMeasurement({ type: "OXYGEN_SATURATION", value: 97, unit: "%" })).toBe("97%");
    expect(formatMeasurement({ type: "OTHER", value: 3, unit: "vezes" })).toBe("3 vezes");
  });

  it("a linha da pessoa prevalece sobre a da família", () => {
    const line = (personId: string | null, value: number): ReferenceLineView =>
      ({ id: String(value), personId, type: "TEMPERATURE", value, value2: null, label: "x", updatedAt: "" });
    const lines = [line(null, 37.8), line("p1", 38)];
    expect(referenceFor(lines, "p1", "TEMPERATURE")?.value).toBe(38);
    expect(referenceFor(lines, "p2", "TEMPERATURE")?.value).toBe(37.8);
    expect(referenceFor(lines, "p1", "WEIGHT")).toBeNull();
  });
});

describe("eixos do gráfico", () => {
  it("divisões redondas que cobrem os valores", () => {
    const ticks = niceTicks(36.4, 39.1);
    expect(ticks[0]).toBeLessThanOrEqual(36.4);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(39.1);
    expect(ticks).toEqual([36, 37, 38, 39, 40]);
    expect(niceTicks(37.6, 38.7)).toEqual([37.5, 38, 38.5, 39]);
    expect(niceTicks(37, 37).length).toBeGreaterThan(1);
  });

  it("horas no período curto e dias no longo, sem excesso de marcas", () => {
    const from = new Date(2026, 9, 22, 0, 0).getTime();
    const day = timeTicks(from, from + 24 * 3_600_000, 4);
    expect(day.length).toBeLessThanOrEqual(5);
    expect(day[0].label).toMatch(/^\d{2}h$/);
    const week = timeTicks(from, from + 7 * 24 * 3_600_000, 7);
    expect(week.length).toBeLessThanOrEqual(8);
    expect(week[0].label).not.toMatch(/h$/);
  });
});

describe("janela do tempo", () => {
  it("aproxima o eixo das medidas, sem sair do período escolhido", () => {
    const now = Date.now();
    const from = now - 72 * 3_600_000;
    const [start, end] = timeWindow([{ at: now - 2 * 3_600_000 }, { at: now - 3_600_000 }], from, now + 60_000);
    expect(start).toBeGreaterThan(from);
    expect(start).toBeLessThan(now - 2 * 3_600_000);
    expect(end).toBeLessThanOrEqual(now + 60_000);
    expect(timeWindow([], from, now)).toEqual([from, now]);
  });
});
