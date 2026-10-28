import { useMemo, useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import type { OccurrenceView, PersonView, TreatmentConflictView } from "../api/types";
import { Notice, Spinner } from "../components/Layout";
import { Icon } from "../components/Icon";
import { ProgressRing } from "../components/ProgressRing";
import { StatusBadge } from "../components/StatusBadge";
import { SyncStatus } from "../components/SyncStatus";
import { useCached } from "../hooks/useCached";
import { useOutbox } from "../hooks/useOutbox";
import { addDays, formatDay, formatTime, sameDay, startOfDay } from "../lib/time";
import { useFamily, useSession } from "../session";

/** Tela inicial (seção 7.1): doses do dia, por pessoa. */
export function TodayPage() {
  const family = useFamily();
  const { me } = useSession();
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [personId, setPersonId] = useState<string | null>(null);

  // Busca de um dia antes a três depois: a cópia offline cobre os próximos dias.
  const from = addDays(day, -1);
  const to = addDays(day, 3);
  const agenda = useCached(`agenda:${family.id}:${day.toISOString()}`, () =>
    api<OccurrenceView[]>(`/families/${family.id}/occurrences`, {
      query: { from: from.toISOString(), to: to.toISOString() },
    }));
  const persons = useCached(`persons:${family.id}`, () => api<PersonView[]>(`/families/${family.id}/persons`, { query: { active: "true" } }));
  const treatmentConflicts = useCached(`treatment-conflicts:${family.id}`, () =>
    api<TreatmentConflictView[]>(`/families/${family.id}/treatments/conflicts`));
  const outbox = useOutbox(family.id);
  const queued = useMemo(() => new Map(outbox.filter((i) => i.occurrenceId).map((i) => [i.occurrenceId!, i])), [outbox]);

  const mine = new Set((persons.data ?? []).filter((p) => p.userId && p.userId === me?.id).map((p) => p.id));
  const doses = (agenda.data ?? [])
    .filter((o) => sameDay(new Date(o.scheduledAt), day))
    .filter((o) => !personId || o.person.id === personId);
  const review = (agenda.data ?? []).filter((o) => o.status === "REVIEW_REQUIRED").length;
  const treatmentReview = (treatmentConflicts.data ?? []).length;
  const isToday = sameDay(day, new Date());
  // Progresso do dia: doses dadas (inclui as registradas aqui e ainda não enviadas).
  const counted = doses.filter((o) => o.status !== "CANCELLED");
  const given = counted.filter((o) => o.status === "ADMINISTERED"
    || (queued.get(o.id)?.state === "pending" && queued.get(o.id)?.kind === "ADMINISTER")).length;
  const open = (o: OccurrenceView) => (o.status === "PENDING" || o.status === "SCHEDULED") && !queued.has(o.id);
  const next = isToday ? doses.filter(open).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0] : undefined;

  return (
    <div className="page">
      <section className="hero">
        <div className="hero-top">
          <div className="hero-day">
            <div className="row">
              <button className="icon-btn" aria-label="Dia anterior" onClick={() => setDay(addDays(day, -1))}>‹</button>
              <h1>{isToday ? "Hoje" : "Dia"} · {formatDay(day)}</h1>
              <button className="icon-btn" aria-label="Próximo dia" onClick={() => setDay(addDays(day, 1))}>›</button>
            </div>
            <SyncStatus familyId={family.id} fresh={agenda.fresh} savedAt={agenda.savedAt} />
            {!isToday && <button className="link" onClick={() => setDay(startOfDay(new Date()))}>Voltar para hoje</button>}
          </div>
          {counted.length > 0 && <ProgressRing done={given} total={counted.length} />}
        </div>
        {next && (
          <div className="next-dose">
            <div className="row between">
              <span className="eyebrow">Próxima dose</span>
              <StatusBadge status={next.status} late={next.late} />
            </div>
            <div className="next-dose-main">
              <span className="pill-icon"><Icon name="pill" size={26} /></span>
              <span className="dose-main">
                <strong className="next-dose-name">{next.treatment.name} · {formatTime(next.scheduledAt)}</strong>
                <span className="muted">
                  {mine.has(next.person.id) ? "Você" : next.person.displayName} · {next.treatment.prescribedDose}
                </span>
              </span>
            </div>
            <Link to={`/doses/${next.id}`} state={{ occurrence: next }} className="btn btn-primary"
              aria-label={`Abrir dose: próxima de ${next.treatment.name}, ${mine.has(next.person.id) ? "você" : next.person.displayName}`}>
              Abrir dose
            </Link>
          </div>
        )}
      </section>

      {review > 0 && (
        <Notice tone="warn">
          <Link to="/conflitos">{review === 1 ? "1 dose precisa" : `${review} doses precisam`} de conferência →</Link>
        </Notice>
      )}
      {treatmentReview > 0 && (
        <Notice tone="warn">
          <Link to="/conflitos">{treatmentReview === 1 ? "1 alteração de tratamento precisa" : `${treatmentReview} alterações de tratamento precisam`} de conferência →</Link>
        </Notice>
      )}

      <div className="row wrap quick">
        <Link className="btn btn-small" to={`/saude/aferir${personId ? `?pessoa=${personId}` : ""}`}>+ Aferição</Link>
        <Link className="btn btn-small" to={`/saude/sintoma${personId ? `?pessoa=${personId}` : ""}`}>+ Sintoma</Link>
      </div>

      <div className="chips" role="group" aria-label="Filtrar por pessoa">
        <button className={`chip ${personId === null ? "chip-on" : ""}`} onClick={() => setPersonId(null)}>Todos</button>
        {(persons.data ?? []).map((p) => (
          <button key={p.id} className={`chip ${personId === p.id ? "chip-on" : ""}`} onClick={() => setPersonId(p.id)}>
            {p.userId && p.userId === me?.id ? "Você" : p.displayName}
          </button>
        ))}
      </div>

      {agenda.error && !agenda.data && <Notice tone="error">{agenda.error}</Notice>}
      {agenda.loading && !agenda.data && <Spinner />}
      {agenda.data && doses.length === 0 && (
        <p className="empty">Nenhuma dose prevista {isToday ? "para hoje" : "neste dia"}.</p>
      )}

      <ul className="doses">
        {doses.map((o) => {
          const pending = queued.get(o.id);
          const open = o.status === "PENDING" || o.status === "SCHEDULED";
          return (
            <li key={o.id}>
              <Link to={`/doses/${o.id}`} state={{ occurrence: o }} className={`dose ${o.late && !pending ? "dose-late" : ""}`}>
                <span className="dose-time">{formatTime(o.scheduledAt)}</span>
                <span className="dose-main">
                  <strong>{mine.has(o.person.id) ? "Você" : o.person.displayName}</strong>
                  <span>{o.treatment.name}</span>
                  <span className="muted small">{o.treatment.prescribedDose}</span>
                  {o.administration && (
                    <span className="muted small">
                      {formatTime(o.administration.administeredAt)} · {o.administration.recordedBy?.displayName}
                    </span>
                  )}
                </span>
                <span className="dose-side">
                  <StatusBadge status={o.status} late={o.late} queued={pending?.state === "pending"} />
                  {open && !pending && <span className="btn btn-small btn-primary">Registrar</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
