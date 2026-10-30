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
export function prescriptionTitle(p: Pick<PrescriptionView, "title"> | undefined, items: Pick<TreatmentView, "name">[]): string {
  if (p?.title) return p.title;
  return items.length ? items.map((i) => i.name).join(" + ") : "Receita sem itens";
}
