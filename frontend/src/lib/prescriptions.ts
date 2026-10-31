import { api } from "../api/client";
import type { PrescriptionView, TreatmentStatus, TreatmentView } from "../api/types";
import { useCached } from "../hooks/useCached";
import { useFamily } from "../session";

export const prescriptionsKey = (familyId: string) => `prescriptions:${familyId}`;

export function usePrescriptions() {
  const family = useFamily();
  return useCached(prescriptionsKey(family.id), () => api<PrescriptionView[]>(`/families/${family.id}/prescriptions`));
}

export const PRESCRIPTION_STATUS: Record<TreatmentStatus, string> = {
  DRAFT: "Rascunho",
  ACTIVE: "Ativa",
  SUSPENDED: "Suspensa",
  ENDED: "Encerrada",
};

/**
 * Situação da receita pelos itens (como no servidor; aqui inclui o que ainda
 * está na fila): ativa se algum item está ativo; senão suspensa; senão
 * rascunho se algum não foi ativado (ou não há itens); senão encerrada.
 */
export function prescriptionStatus(items: Pick<TreatmentView, "status">[]): TreatmentStatus {
  const s = new Set(items.map((i) => i.status));
  if (s.has("ACTIVE")) return "ACTIVE";
  if (s.has("SUSPENDED")) return "SUSPENDED";
  if (s.size === 0 || s.has("DRAFT")) return "DRAFT";
  return "ENDED";
}

/** Título da receita, ou os medicamentos dela. */
export function prescriptionTitle(p: Pick<PrescriptionView, "title"> | undefined,
  items: Pick<TreatmentView, "name" | "personId" | "prescriptionId">[]): string {
  if (p?.title) return p.title;
  if (items.some((i) => i.prescriptionId && i.prescriptionId === i.personId)) return EVENTUAL_TITLE;
  return items.length ? items.map((i) => i.name).join(" + ") : "Receita sem itens";
}

export const EVENTUAL_TITLE = "Uso eventual";

/** O uso eventual de uma pessoa tem o id da própria pessoa. */
export function isEventual(t: Pick<TreatmentView, "personId" | "prescriptionId">): boolean {
  return Boolean(t.prescriptionId) && t.prescriptionId === t.personId;
}

/**
 * Itens do uso eventual ocultos porque uma receita ativa da mesma pessoa tem o
 * mesmo medicamento: vale o da receita (dose e orientação dela). Quando a
 * receita termina, o item do uso eventual volta.
 */
export function hiddenEventual(treatments: TreatmentView[]): Map<string, TreatmentView> {
  const hidden = new Map<string, TreatmentView>();
  for (const t of treatments) {
    if (!isEventual(t) || t.status !== "ACTIVE" || !t.medicationId) continue;
    const other = treatments.find((o) => !isEventual(o) && o.personId === t.personId
      && o.medicationId === t.medicationId && o.status === "ACTIVE");
    if (other) hidden.set(t.id, other);
  }
  return hidden;
}
