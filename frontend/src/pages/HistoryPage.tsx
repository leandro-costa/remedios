import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import type { MemberView, OccurrenceView, PersonView, TreatmentView } from "../api/types";
import { Avatar } from "../components/Avatar";
import { Notice, Spinner } from "../components/Layout";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { useCached } from "../hooks/useCached";
import { addDays, formatTime, formatWhen, startOfDay } from "../lib/time";
import { useFamily } from "../session";

const PERIODS = [
  { days: 1, label: "Hoje" },
  { days: 7, label: "Últimos 7 dias" },
  { days: 30, label: "Últimos 30 dias" },
];

/** Histórico de registros (seção 7.4). */
export function HistoryPage() {
  const family = useFamily();
  const [personId, setPersonId] = useState("");
  const [treatmentId, setTreatmentId] = useState("");
  const [recordedBy, setRecordedBy] = useState("");
  const [days, setDays] = useState(7);

  const persons = useCached(`persons-all:${family.id}`, () => api<PersonView[]>(`/families/${family.id}/persons`));
  const treatments = useCached(`treatments:${family.id}`, () => api<TreatmentView[]>(`/families/${family.id}/treatments`));
  const members = useCached(`members:${family.id}`, () => api<MemberView[]>(`/families/${family.id}/members`));
  const to = addDays(startOfDay(new Date()), 1);
  const from = addDays(to, -days);
  const key = `history:${family.id}:${days}:${personId}:${treatmentId}:${recordedBy}`;
  const history = useCached(key, () => api<OccurrenceView[]>(`/families/${family.id}/history`, {
    query: { from: from.toISOString(), to: to.toISOString(), personId, treatmentId, recordedBy, limit: 300 },
  }));

  return (
    <div className="page">
      <PageHeader title="Histórico" subtitle="Quem deu, o quê e quando" />
      <div className="filters">
        <label>
          Pessoa
          <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">Todas</option>
            {(persons.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
        <label>
          Tratamento
          <select value={treatmentId} onChange={(e) => setTreatmentId(e.target.value)}>
            <option value="">Todos</option>
            {(treatments.data ?? []).filter((t) => !personId || t.personId === personId)
              .map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>
          Período
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
          </select>
        </label>
        <label>
          Responsável
          <select value={recordedBy} onChange={(e) => setRecordedBy(e.target.value)}>
            <option value="">Todos</option>
            {(members.data ?? []).map((m) => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}
          </select>
        </label>
      </div>
      {!history.fresh && <Notice tone="warn">Sem conexão: histórico guardado neste aparelho.</Notice>}
      {history.loading && !history.data && <Spinner />}
      {history.error && !history.data && <Notice tone="error">{history.error}</Notice>}
      {history.data?.length === 0 && <p className="empty">Nenhum registro no período.</p>}
      <ul className="cards">
        {(history.data ?? []).map((o) => (
          <li key={o.id}>
            <Link to={`/doses/${o.id}`} state={{ occurrence: o }} className="item history-item">
              <Avatar name={o.person.displayName} id={o.person.id} size={44} />
              <span className="item-main">
                <span className="row between wrap">
                  <strong>{formatWhen(o.administration?.administeredAt ?? o.statusChangedAt ?? o.scheduledAt)}</strong>
                  <StatusBadge status={o.status} />
                </span>
                <span>{o.person.displayName} · {o.treatment.name}</span>
                <span className="muted small">
                  Previsto {formatTime(o.scheduledAt)} · Registrado por {o.administration?.recordedBy?.displayName ?? o.statusChangedBy?.displayName ?? "—"}
                  {o.administration ? ` às ${formatTime(o.administration.recordedAt)}` : ""}
                </span>
                {o.statusReason && <span className="small">{o.statusReason}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
