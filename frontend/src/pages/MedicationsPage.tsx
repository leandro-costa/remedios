import { Link } from "react-router";
import { api } from "../api/client";
import type { MedicationView } from "../api/types";
import { Icon } from "../components/Icon";
import { Notice, Spinner } from "../components/Layout";
import { ScreenBar } from "../components/ScreenBar";
import { isPending } from "../db/cache";
import { useCached } from "../hooks/useCached";
import { useFamily } from "../session";

export const medicationsKey = (familyId: string) => `medications:${familyId}`;

export function useMedications() {
  const family = useFamily();
  return useCached(medicationsKey(family.id), () => api<MedicationView[]>(`/families/${family.id}/medications`));
}

/** Resumo das substâncias: "paracetamol 750 mg + cafeína 65 mg". */
export function describeSubstances(m: Pick<MedicationView, "substances">): string {
  return m.substances.map((s) => [s.substance, s.concentration].filter(Boolean).join(" ")).join(" + ");
}

/** Medicamentos da família, para reaproveitar em vários tratamentos. */
export function MedicationsPage() {
  const medications = useMedications();
  const list = [...(medications.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return (
    <div className="page">
      <ScreenBar title="Medicamentos" />
      <div className="row between">
        <p className="muted">Cadastrados uma vez, usados em quantos tratamentos precisar.</p>
        <Link to="/medicamentos/novo" className="round-btn" aria-label="Novo medicamento" title="Novo medicamento"><Icon name="plus" /></Link>
      </div>
      {!medications.fresh && <Notice tone="warn">Sem conexão: lista guardada neste aparelho.</Notice>}
      {medications.loading && !medications.data && <Spinner />}
      {medications.error && !medications.data && <Notice tone="error">{medications.error}</Notice>}
      {medications.data && list.length === 0 && <p className="empty">Nenhum medicamento cadastrado.</p>}
      <ul className="cards">
        {list.map((m) => (
          <li key={m.id}>
            <Link to={`/medicamentos/${m.id}`} className="item">
              <span className="tile"><Icon name="pill" /></span>
              <span className="item-main">
                <strong className="item-title">{m.name}</strong>
                <span className="muted small">{describeSubstances(m) || "Substâncias não informadas"}</span>
                <span className="muted small">{[m.form, m.manufacturer, m.category].filter(Boolean).join(" · ")}</span>
                {isPending(m) && <span className="badge badge-queued"><Icon name="sync" />Aguardando envio</span>}
              </span>
              <span className="item-chevron"><Icon name="chevron" /></span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
