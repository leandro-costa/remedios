import { useMemo } from "react";
import { api } from "../api/client";
import type { MeasurementType, MeasurementView, OccurrenceView, ReferenceLineView, SymptomView } from "../api/types";
import type { OutboxItem } from "../db/db";
import { useCached } from "./useCached";
import { useOutbox } from "./useOutbox";

/** Aferição na tela: do servidor, ou ainda na fila deste aparelho. */
export type MeasurementItem = MeasurementView & { pending?: boolean };
export type SymptomItem = SymptomView & { pending?: boolean };

/** Dados de saúde de uma pessoa num período, com os registros pendentes da fila. */
export function useHealth(familyId: string, personId: string | null, from: Date, to: Date) {
  const range = { from: from.toISOString(), to: to.toISOString() };
  const key = personId ? `${familyId}:${personId}:${range.from}:${range.to}` : null;
  const measurements = useCached(key && `measurements:${key}`, () =>
    api<MeasurementView[]>(`/families/${familyId}/persons/${personId}/measurements`, { query: range }));
  const symptoms = useCached(key && `symptoms:${key}`, () =>
    api<SymptomView[]>(`/families/${familyId}/persons/${personId}/symptoms`, { query: range }));
  const doses = useCached(key && `doses:${key}`, () =>
    api<OccurrenceView[]>(`/families/${familyId}/history`, { query: { ...range, personId, limit: 500 } }));
  const lines = useCached(`reference-lines:${familyId}`, () =>
    api<ReferenceLineView[]>(`/families/${familyId}/reference-lines`));
  const outbox = useOutbox(familyId);

  const pending = useMemo(() => outbox.filter((i) => i.personId === personId && i.state === "pending"), [outbox, personId]);
  const allMeasurements = useMemo<MeasurementItem[]>(() => {
    const queued = pending.filter((i) => i.kind === "MEASUREMENT").map(pendingMeasurement);
    const known = new Set((measurements.data ?? []).map((m) => m.id));
    return [...(measurements.data ?? []), ...queued.filter((m) => !known.has(m.id))]
      .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  }, [measurements.data, pending]);
  const allSymptoms = useMemo<SymptomItem[]>(() => {
    const queued = pending.filter((i) => i.kind === "SYMPTOM").map(pendingSymptom);
    const known = new Set((symptoms.data ?? []).map((s) => s.id));
    return [...(symptoms.data ?? []), ...queued.filter((s) => !known.has(s.id))];
  }, [symptoms.data, pending]);
  const administered = (doses.data ?? []).filter((o) => o.status === "ADMINISTERED" && o.administration);

  return {
    measurements: allMeasurements,
    symptoms: allSymptoms,
    doses: administered,
    lines: lines.data ?? [],
    loading: measurements.loading && !measurements.data,
    error: measurements.error && !measurements.data ? measurements.error : null,
    fresh: measurements.fresh && symptoms.fresh,
    savedAt: measurements.savedAt,
    reloadLines: lines.reload,
  };
}

function pendingMeasurement(item: OutboxItem): MeasurementItem {
  const b = item.body as Record<string, unknown>;
  return {
    id: item.id, personId: item.personId!, type: b.type as MeasurementType, value: Number(b.value),
    value2: b.value2 == null ? null : Number(b.value2), unit: String(b.unit ?? ""), label: (b.label as string) ?? null,
    method: (b.method as string) ?? null, measuredAt: String(b.measuredAt), notes: (b.notes as string) ?? null,
    recordedBy: null, deviceId: item.body.deviceId, recordedAt: item.body.recordedAt, receivedAt: item.body.recordedAt,
    replacesId: null, voidedAt: null, voidedBy: null, voidReason: null, pending: true,
  };
}

function pendingSymptom(item: OutboxItem): SymptomItem {
  const b = item.body as Record<string, unknown>;
  return {
    id: item.id, personId: item.personId!, description: String(b.description), intensity: (b.intensity as SymptomView["intensity"]) ?? null,
    startedAt: String(b.startedAt), endedAt: (b.endedAt as string) ?? null, treatmentId: (b.treatmentId as string) ?? null,
    notes: (b.notes as string) ?? null, version: 0, recordedBy: null, deviceId: item.body.deviceId,
    recordedAt: item.body.recordedAt, updatedBy: null, updatedAt: null, pending: true,
  };
}
