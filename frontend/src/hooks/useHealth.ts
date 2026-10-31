import { useEffect, useMemo, useRef } from "react";
import type { MeasurementType, MeasurementView, SymptomView } from "../api/types";
import type { OutboxItem } from "../db/db";
import { queries } from "../lib/queries";
import { useCached } from "./useCached";
import { useOutbox } from "./useOutbox";

/** Aferição na tela: do servidor, ou ainda na fila deste aparelho. */
export type MeasurementItem = MeasurementView & { pending?: boolean };
export type SymptomItem = SymptomView & { pending?: boolean };

/**
 * Dados de saúde de uma pessoa nas últimas `hours` horas até `anchor`, com os
 * registros pendentes da fila. A cópia offline é por pessoa e período (não
 * pelo horário exato), para ser achada ao abrir a tela sem conexão.
 */
export function useHealth(familyId: string, personId: string | null, hours: number, anchor: number) {
  const m = personId ? queries.measurements(familyId, personId, hours, anchor) : null;
  const s = personId ? queries.symptoms(familyId, personId, hours, anchor) : null;
  const d = personId ? queries.healthDoses(familyId, personId, hours, anchor) : null;
  const measurements = useCached(m?.key ?? null, () => m!.fetch());
  const symptoms = useCached(s?.key ?? null, () => s!.fetch());
  const doses = useCached(d?.key ?? null, () => d!.fetch());
  const l = queries.referenceLines(familyId);
  const lines = useCached(l.key, l.fetch);
  // Mesmo período escolhido de novo (novo `anchor`, mesma chave): busca de novo.
  const firstAnchor = useRef(anchor);
  const { reload: reloadM } = measurements, { reload: reloadS } = symptoms, { reload: reloadD } = doses;
  useEffect(() => {
    if (anchor === firstAnchor.current) return;
    firstAnchor.current = anchor;
    void reloadM(); void reloadS(); void reloadD();
  }, [anchor, reloadM, reloadS, reloadD]);
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
    recordedBy: null, deviceId: String(item.body.deviceId), recordedAt: String(item.body.recordedAt), receivedAt: String(item.body.recordedAt),
    replacesId: null, voidedAt: null, voidedBy: null, voidReason: null, pending: true,
  };
}

function pendingSymptom(item: OutboxItem): SymptomItem {
  const b = item.body as Record<string, unknown>;
  return {
    id: item.id, personId: item.personId!, description: String(b.description), intensity: (b.intensity as SymptomView["intensity"]) ?? null,
    startedAt: String(b.startedAt), endedAt: (b.endedAt as string) ?? null, treatmentId: (b.treatmentId as string) ?? null,
    notes: (b.notes as string) ?? null, version: 0, recordedBy: null, deviceId: String(item.body.deviceId),
    recordedAt: String(item.body.recordedAt), updatedBy: null, updatedAt: null, pending: true,
  };
}
