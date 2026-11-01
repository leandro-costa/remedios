import { Link } from "react-router";
import { api } from "../api/client";
import type { PersonView, TreatmentProgressView, TreatmentStatus, TreatmentView } from "../api/types";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { Notice, Spinner } from "../components/Layout";
import { PageHeader } from "../components/PageHeader";
import { useCached } from "../hooks/useCached";
import { isPending } from "../db/cache";
import { TREATMENT_STATUS } from "../lib/labels";
import { describeSchedule } from "../lib/schedule";
import { useFamily, useSession } from "../session";
import { hiddenEventual, prescriptionStatus, prescriptionTitle, PRESCRIPTION_STATUS, usePrescriptions } from "../lib/prescriptions";
import { formatDate } from "../lib/time";
import { useRemembered } from "../lib/remember";

// Ativos primeiro e como padrão: encerrados e rascunhos ficam a um toque.
const FILTERS: { value: TreatmentStatus | "ALL"; label: string }[] = [
  { value: "ACTIVE", label: "Ativos" },
  { value: "DRAFT", label: "Rascunhos" },
  { value: "SUSPENDED", label: "Suspensos" },
  { value: "ENDED", label: "Encerrados" },
  { value: "ALL", label: "Todos" },
];

/** Lista de tratamentos por pessoa (seção 7.3). */
export function TreatmentsPage() {
  const family = useFamily();
  const { me } = useSession();
  const [savedFilter, setFilter] = useRemembered(family.id, "tratamentos", "situacao", "ACTIVE");
  const filter = (FILTERS.some((f) => f.value === savedFilter) ? savedFilter : "ACTIVE") as TreatmentStatus | "ALL";
  const treatments = useCached(`treatments:${family.id}`, () => api<TreatmentView[]>(`/families/${family.id}/treatments`));
  const persons = useCached(`persons-all:${family.id}`, () => api<PersonView[]>(`/families/${family.id}/persons`));
  const progress = useCached(`treatment-progress:${family.id}`, () =>
    api<TreatmentProgressView[]>(`/families/${family.id}/treatments/progress`));
  const prescriptions = usePrescriptions();
  const progressOf = (id: string) => progress.data?.find((p) => p.treatmentId === id);
  const hidden = hiddenEventual(treatments.data ?? []);

  const list = (treatments.data ?? []).filter((t) => filter === "ALL" || t.status === filter);
  const groups = (persons.data ?? [])
    .map((p) => ({ person: p, items: list.filter((t) => t.personId === p.id) }))
    .filter((g) => g.items.length > 0);

  /** Receitas da pessoa com os itens visíveis no filtro; receita de um item só, sem título, aparece como o item. */
  const receitasOf = (items: TreatmentView[]) => {
    const byId = new Map<string, TreatmentView[]>();
    for (const t of items) {
      const key = t.prescriptionId ?? t.id;
      byId.set(key, [...(byId.get(key) ?? []), t]);
    }
    // O uso eventual (id da pessoa) vem primeiro, sempre como grupo.
    return [...byId.entries()].sort(([a], [b]) => Number(b === items[0]?.personId) - Number(a === items[0]?.personId)).map(([id, visible]) => {
      const prescription = prescriptions.data?.find((p) => p.id === id);
      const all = (treatments.data ?? []).filter((t) => (t.prescriptionId ?? t.id) === id);
      return {
        id, prescription, items: visible, all,
        title: prescriptionTitle(prescription, all),
        status: prescriptionStatus(all),
        grouped: Boolean(prescription?.title) || all.length > 1 || id === visible[0].personId,
      };
    });
  };

  const itemCard = (t: TreatmentView) => (
                <Link to={`/tratamentos/${t.id}`} className="item">
                  <span className="tile"><Icon name="pill" /></span>
                  <span className="item-main">
                    <strong className="item-title">{t.name}</strong>
                    <span className="muted small">
                      {t.prescribedDose} · {t.kind === "AS_NEEDED" ? "se necessário" : describeSchedule(t.schedule)}
                      {t.doseCount ? ` · ${t.doseCount} ${t.doseCount === 1 ? "dose" : "doses"}` : ""}
                    </span>
                    {(() => {
                      const p = progressOf(t.id);
                      if (!p || p.total === null || t.status === "DRAFT" || t.kind === "AS_NEEDED") return null;
                      return <span className="small">{p.administered} de {p.total} dadas{p.notAdministered ? ` · ${p.notAdministered} não dadas` : ""}</span>;
                    })()}
                    <span className="row wrap">
                      <span className={`badge badge-t-${t.status.toLowerCase()}`}>{TREATMENT_STATUS[t.status]}</span>
                      {isPending(t) && <span className="badge badge-queued"><Icon name="sync" />Aguardando envio</span>}
                      {t.conflictId && <span className="badge badge-review-required"><Icon name="review" />Para conferir</span>}
                    </span>
                    {hidden.has(t.id) && <span className="muted small">Oculto enquanto a receita com {hidden.get(t.id)!.name} estiver ativa</span>}
                  </span>
                  <span className="item-chevron"><Icon name="chevron" /></span>
                </Link>
  );

  return (
    <div className="page">
      <PageHeader title="Tratamentos" subtitle="Receitas, medicamentos e horários de cada pessoa"
        action={<Link to="/tratamentos/novo" className="round-btn" aria-label="Novo tratamento" title="Novo tratamento"><Icon name="plus" /></Link>} />
      <Link to="/medicamentos" className="link">Medicamentos cadastrados →</Link>
      {!treatments.fresh && <Notice tone="warn">Sem conexão: lista guardada neste aparelho.</Notice>}
      <div className="chips" role="group" aria-label="Filtrar por situação">
        {FILTERS.map((f) => (
          <button key={f.value} className={`chip ${filter === f.value ? "chip-on" : ""}`} onClick={() => setFilter(f.value)}>{f.label}</button>
        ))}
      </div>
      {treatments.loading && !treatments.data && <Spinner />}
      {treatments.error && !treatments.data && <Notice tone="error">{treatments.error}</Notice>}
      {treatments.data && groups.length === 0 && <p className="empty">Nenhum tratamento {filter === "ALL" ? "cadastrado" : "nesta situação"}.</p>}
      {groups.map((g) => (
        <section key={g.person.id}>
          <h2 className="group-head">
            <Avatar name={g.person.displayName} id={g.person.id} size={32} />
            {g.person.userId && g.person.userId === me?.id ? "Você" : g.person.displayName}
          </h2>
          {receitasOf(g.items).map((r) => r.grouped ? (
            <section key={r.id} className="prescription-card" aria-label={`Receita: ${r.title}`}>
              <Link to={`/receitas/${r.id}`} className="prescription-head">
                <span className="item-main">
                  <strong>{r.title}</strong>
                  <span className="muted small">{[r.prescription?.prescriber, r.prescription?.prescribedOn && formatDate(r.prescription.prescribedOn + "T12:00:00")].filter(Boolean).join(" · ") || `${r.all.length} ${r.all.length === 1 ? "item" : "itens"}`}</span>
                </span>
                <span className={`badge badge-t-${r.status.toLowerCase()}`}>{PRESCRIPTION_STATUS[r.status]}</span>
                <span className="item-chevron"><Icon name="chevron" /></span>
              </Link>
              <ul className="cards">
                {r.items.map((t) => <li key={t.id}>{itemCard(t)}</li>)}
              </ul>
            </section>
          ) : (
            <ul key={r.id} className="cards">
              {r.items.map((t) => <li key={t.id}>{itemCard(t)}</li>)}
            </ul>
          ))}
        </section>
      ))}
    </div>
  );
}
