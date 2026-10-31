import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import type { MemberView, PersonView } from "../api/types";
import { Avatar } from "../components/Avatar";
import { Notice, Spinner } from "../components/Layout";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { useCached } from "../hooks/useCached";
import { queries } from "../lib/queries";
import { formatTime, formatWhen } from "../lib/time";
import { useFamily } from "../session";
import { useMedications } from "./MedicationsPage";
import { doseLabel } from "../lib/labels";

const PERIODS = [
  { days: 1, label: "Hoje" },
  { days: 7, label: "Últimos 7 dias" },
  { days: 30, label: "Últimos 30 dias" },
];

/** Histórico de registros (seção 7.4). */
export function HistoryPage() {
  const family = useFamily();
  const [personId, setPersonId] = useState("");
  const [medicationId, setMedicationId] = useState("");
  const [recordedBy, setRecordedBy] = useState("");
  const [days, setDays] = useState(7);

  const persons = useCached(`persons-all:${family.id}`, () => api<PersonView[]>(`/families/${family.id}/persons`));
  const medications = useMedications();
  const members = useCached(`members:${family.id}`, () => api<MemberView[]>(`/families/${family.id}/members`));
  // Por medicamento, não por tratamento: as doses do mesmo medicamento em
  // receitas diferentes (ou no uso eventual) aparecem juntas.
  const query = queries.history(family.id, days, personId, medicationId, recordedBy);
  const history = useCached(query.key, query.fetch);

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
          Medicamento
          <select value={medicationId} onChange={(e) => setMedicationId(e.target.value)}>
            <option value="">Todos</option>
            {[...(medications.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
              .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
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
                <span>{o.person.displayName} · {doseLabel(o)}</span>
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

