import type { TreatmentView } from "../api/types";
import { mutate } from "../sync/outbox";
import { isEventual } from "./prescriptions";

const DISMISSED = "remedios.eventual.naoManter";

/** Itens "se necessário" de uma receita encerrada que ainda não foram decididos (manter ou não no uso eventual). */
export function undecided(items: TreatmentView[], all: TreatmentView[]): TreatmentView[] {
  const dismissed = readDismissed();
  return items.filter((t) => t.kind === "AS_NEEDED" && !isEventual(t) && !dismissed.has(t.id)
    && !all.some((e) => isEventual(e) && e.personId === t.personId && e.status === "ACTIVE"
      && (e.medicationId ? e.medicationId === t.medicationId : e.name === t.name)));
}

/** "Não manter": lembrado neste aparelho para a pergunta não voltar. */
export function dismiss(treatmentId: string) {
  try {
    const set = readDismissed();
    set.add(treatmentId);
    localStorage.setItem(DISMISSED, JSON.stringify([...set]));
  } catch {
    // sem armazenamento: a pergunta pode voltar, sem outro efeito
  }
}

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Leva um item "se necessário" para o uso eventual da pessoa, com a mesma
 * dose e orientação, já ativo. Funciona offline (duas gravações na fila).
 */
export async function keepInEventual(familyId: string, t: TreatmentView, deviceId: string | null) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const body = {
    name: t.name, kind: "AS_NEEDED" as const, prescribedDose: t.prescribedDose, route: t.route,
    instructions: t.instructions, startAt: now, endAt: null, doseCount: null, schedule: null,
    medicationId: t.medicationId ?? null,
  };
  const created: TreatmentView = {
    ...body, id, personId: t.personId, prescriptionId: t.personId, status: "ACTIVE", version: 2, conflictId: null,
    createdBy: "", createdAt: now, updatedBy: "", updatedAt: now,
  };
  await mutate({
    familyId, method: "POST", path: `/families/${familyId}/treatments`,
    body: { ...body, id, personId: t.personId, prescriptionId: t.personId },
    label: `Uso eventual: ${t.name}`, entityId: id,
    effects: [
      { key: `treatments:${familyId}`, op: "upsert", list: true, value: { ...created } },
      { key: `treatment:${id}`, op: "upsert", value: { ...created } },
    ],
  });
  await mutate({
    familyId, method: "POST", path: `/families/${familyId}/treatments/${id}/status`,
    body: { status: "ACTIVE", baseVersion: 1, effectiveFrom: now, pastDoses: "OPEN", deviceId },
    label: `Ativar no uso eventual: ${t.name}`, entityId: id,
  });
}
