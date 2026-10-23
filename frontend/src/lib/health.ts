import type { Intensity, MeasurementType, ReferenceLineView } from "../api/types";

export interface TypeInfo {
  label: string;
  unit: string;
  /** Passo do campo numérico. */
  step: number;
  /** Casas decimais na exibição. */
  decimals: number;
  methods?: { value: string; label: string }[];
  /** Pressão arterial: dois valores. */
  pair?: [string, string];
}

/** Tipos de aferição. Unidades fixas, iguais às da API. */
export const MEASUREMENT_TYPES: Record<MeasurementType, TypeInfo> = {
  TEMPERATURE: {
    label: "Temperatura", unit: "°C", step: 0.1, decimals: 1,
    methods: [
      { value: "AXILLARY", label: "Axilar" },
      { value: "ORAL", label: "Oral" },
      { value: "RECTAL", label: "Retal" },
      { value: "EAR", label: "Ouvido" },
      { value: "FOREHEAD", label: "Testa" },
    ],
  },
  HEART_RATE: { label: "Frequência cardíaca", unit: "bpm", step: 1, decimals: 0 },
  BLOOD_PRESSURE: { label: "Pressão arterial", unit: "mmHg", step: 1, decimals: 0, pair: ["Sistólica", "Diastólica"] },
  OXYGEN_SATURATION: { label: "Saturação de O₂", unit: "%", step: 1, decimals: 0 },
  BLOOD_GLUCOSE: {
    label: "Glicemia", unit: "mg/dL", step: 1, decimals: 0,
    methods: [
      { value: "FASTING", label: "Em jejum" },
      { value: "BEFORE_MEAL", label: "Antes de refeição" },
      { value: "AFTER_MEAL", label: "Depois de refeição" },
      { value: "RANDOM", label: "Qualquer horário" },
    ],
  },
  WEIGHT: { label: "Peso", unit: "kg", step: 0.1, decimals: 1 },
  OTHER: { label: "Outra medida", unit: "", step: 0.1, decimals: 1 },
};

export const TYPE_ORDER: MeasurementType[] = [
  "TEMPERATURE", "HEART_RATE", "BLOOD_PRESSURE", "OXYGEN_SATURATION", "BLOOD_GLUCOSE", "WEIGHT", "OTHER",
];

export const INTENSITY: Record<Intensity, string> = {
  MILD: "Leve",
  MODERATE: "Moderada",
  SEVERE: "Intensa",
};

/** Sugestões para agilizar o registro; o responsável pode escrever qualquer outro. */
export const SYMPTOM_SUGGESTIONS = [
  "Febre", "Tosse", "Dor de cabeça", "Dor de garganta", "Dor de barriga", "Vômito", "Diarreia", "Calafrios",
  "Congestão nasal", "Manchas na pele", "Coceira", "Sonolência", "Irritabilidade", "Falta de apetite",
];

const number = (decimals: number) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** "38,4 °C", "120/80 mmHg" */
export function formatMeasurement(m: { type: MeasurementType; value: number; value2?: number | null; unit: string }): string {
  const info = MEASUREMENT_TYPES[m.type];
  const fmt = number(m.type === "OTHER" ? (Number.isInteger(m.value) ? 0 : 1) : info.decimals);
  const value = m.value2 != null ? `${fmt.format(m.value)}/${fmt.format(m.value2)}` : fmt.format(m.value);
  return m.unit === "%" ? `${value}%` : `${value} ${m.unit}`;
}

export function formatNumber(value: number, decimals: number): string {
  return number(decimals).format(value);
}

/** Aceita vírgula ou ponto; devolve null se não for número. */
export function parseNumber(text: string): number | null {
  const normalized = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

export function methodLabel(type: MeasurementType, method: string | null): string | null {
  if (!method) return null;
  return MEASUREMENT_TYPES[type].methods?.find((m) => m.value === method)?.label ?? method;
}

/** Linha que vale para a pessoa: a dela, ou a da família. */
export function referenceFor(lines: ReferenceLineView[], personId: string, type: MeasurementType) {
  return lines.find((l) => l.type === type && l.personId === personId)
    ?? lines.find((l) => l.type === type && l.personId === null)
    ?? null;
}
