import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import type { PersonView, TreatmentStatus, TreatmentView } from "../api/types";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { Notice, Spinner } from "../components/Layout";
import { PageHeader } from "../components/PageHeader";
import { useCached } from "../hooks/useCached";
import { isPending } from "../db/cache";
import { TREATMENT_STATUS } from "../lib/labels";
import { describeSchedule } from "../lib/schedule";
import { useFamily, useSession } from "../session";

const FILTERS: { value: TreatmentStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "ACTIVE", label: "Ativos" },
  { value: "DRAFT", label: "Rascunhos" },
  { value: "SUSPENDED", label: "Suspensos" },
  { value: "ENDED", label: "Encerrados" },
];

/** Lista de tratamentos por pessoa (seção 7.3). */
export function TreatmentsPage() {
  const family = useFamily();
  const { me } = useSession();
  const [filter, setFilter] = useState<TreatmentStatus | "ALL">("ALL");
  const treatments = useCached(`treatments:${family.id}`, () => api<TreatmentView[]>(`/families/${family.id}/treatments`));
  const persons = useCached(`persons-all:${family.id}`, () => api<PersonView[]>(`/families/${family.id}/persons`));

  const list = (treatments.data ?? []).filter((t) => filter === "ALL" || t.status === filter);
  const groups = (persons.data ?? [])
    .map((p) => ({ person: p, items: list.filter((t) => t.personId === p.id) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="page">
      <PageHeader title="Tratamentos" subtitle="Medicamentos e horários de cada pessoa"
        action={<Link to="/tratamentos/novo" className="round-btn" aria-label="Novo tratamento" title="Novo tratamento"><Icon name="plus" /></Link>} />
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
          <ul className="cards">
            {g.items.map((t) => (
              <li key={t.id}>
                <Link to={`/tratamentos/${t.id}`} className="item">
                  <span className="tile"><Icon name="pill" /></span>
                  <span className="item-main">
                    <strong className="item-title">{t.name}</strong>
                    <span className="muted small">{t.prescribedDose} · {describeSchedule(t.schedule)}</span>
                    <span className="row wrap">
                      <span className={`badge badge-t-${t.status.toLowerCase()}`}>{TREATMENT_STATUS[t.status]}</span>
                      {isPending(t) && <span className="badge badge-queued"><Icon name="sync" />Aguardando envio</span>}
                      {t.conflictId && <span className="badge badge-review-required"><Icon name="review" />Para conferir</span>}
                    </span>
                  </span>
                  <span className="item-chevron"><Icon name="chevron" /></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
