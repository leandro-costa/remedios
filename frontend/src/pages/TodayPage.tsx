import { useMemo, useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import type { OccurrenceView, PersonView, TreatmentConflictView } from "../api/types";
import { Notice, Spinner } from "../components/Layout";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { canRecordOnTime, OnTimeDialog } from "../components/OnTimeDialog";
import { ProgressRing } from "../components/ProgressRing";
import { StatusBadge } from "../components/StatusBadge";
import { SyncStatus } from "../components/SyncStatus";
import { useCached } from "../hooks/useCached";
import { useOutbox } from "../hooks/useOutbox";
import { addDays, formatDay, formatLongDay, formatTime, greeting, sameDay, startOfDay } from "../lib/time";
import { useFamily, useSession } from "../session";

/** Tela inicial (seção 7.1): doses do dia, por pessoa. */
export function TodayPage() {
  const family = useFamily();
  const { me } = useSession();
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [personId, setPersonId] = useState<string | null>(null);
  const [onTime, setOnTime] = useState<OccurrenceView | null>(null);

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
  // Doses canceladas (tratamento encerrado ou alterado) não pedem nenhuma ação:
  // ficam no histórico e no tratamento, não no dia.
  const doses = (agenda.data ?? [])
    .filter((o) => o.status !== "CANCELLED")
    .filter((o) => sameDay(new Date(o.scheduledAt), day))
    .filter((o) => !personId || o.person.id === personId);
  const review = (agenda.data ?? []).filter((o) => o.status === "REVIEW_REQUIRED").length;
  const treatmentReview = (treatmentConflicts.data ?? []).length;
  const isToday = sameDay(day, new Date());
  // Progresso do dia: doses dadas (inclui as registradas aqui e ainda não enviadas).
  const counted = doses;
  const given = counted.filter((o) => o.status === "ADMINISTERED"
    || (queued.get(o.id)?.state === "pending" && queued.get(o.id)?.kind === "ADMINISTER")).length;
  const open = (o: OccurrenceView) => (o.status === "PENDING" || o.status === "SCHEDULED") && !queued.has(o.id);
  const who = (o: OccurrenceView) => (mine.has(o.person.id) ? "você" : o.person.displayName);
  const onTimeLabel = (o: OccurrenceView) =>
    `Dada no horário: ${o.treatment.name} de ${who(o)} às ${formatTime(o.scheduledAt)}`;
  const next = isToday ? doses.filter(open).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0] : undefined;

  const dayTitle = isToday ? "Hoje"
    : sameDay(day, addDays(startOfDay(new Date()), -1)) ? "Ontem"
    : sameDay(day, addDays(startOfDay(new Date()), 1)) ? "Amanhã" : formatDay(day);
  const firstName = (me?.displayName ?? "").split(" ")[0];

  return (
    <div className="page page-today">
      <section className={`hero ${next ? "hero-with-card" : ""}`}>
        <div className="hero-hello">
          {me && <Avatar name={me.displayName} id={me.id} size={44} />}
          <span className="hero-hello-text">
            <span className="hero-muted">{greeting()},</span>
            <strong>{firstName}</strong>
          </span>
          <Link to="/familia#notificacoes" className="round-btn hero-btn" aria-label="Avisos e notificações" title="Avisos e notificações">
            <Icon name="bell" />
          </Link>
        </div>
        <div className="hero-top">
          <div className="hero-day">
            <h1>{dayTitle}</h1>
            <div className="day-nav">
              <button className="icon-btn" aria-label="Dia anterior" onClick={() => setDay(addDays(day, -1))}>‹</button>
              <span className="hero-muted">{formatLongDay(day)}</span>
              <button className="icon-btn" aria-label="Próximo dia" onClick={() => setDay(addDays(day, 1))}>›</button>
            </div>
            <SyncStatus familyId={family.id} fresh={agenda.fresh} savedAt={agenda.savedAt} />
            {!isToday && <button className="link" onClick={() => setDay(startOfDay(new Date()))}>Voltar para hoje</button>}
          </div>
          {counted.length > 0 && <ProgressRing done={given} total={counted.length} />}
        </div>
      </section>
      {next && (
        <div className="next-dose">
          <div className="row between">
            <span className="eyebrow">Próxima dose</span>
            <StatusBadge status={next.status} late={next.late} />
          </div>
          <div className="next-dose-main">
            <span className="pill-icon"><Icon name="pill" size={28} /></span>
            <span className="dose-main">
              <strong className="next-dose-name">{next.treatment.name} · {formatTime(next.scheduledAt)}</strong>
              <span className="muted">
                {mine.has(next.person.id) ? "Você" : next.person.displayName} · {next.treatment.prescribedDose}
              </span>
            </span>
          </div>
          <div className={canRecordOnTime(next, false) ? "next-dose-actions" : "stack"}>
            {canRecordOnTime(next, false) && (
              <button className="btn btn-primary" aria-label={onTimeLabel(next)} onClick={() => setOnTime(next)}>
                <Icon name="check" />Dada no horário
              </button>
            )}
            <Link to={`/doses/${next.id}`} state={{ occurrence: next }}
              className={`btn ${canRecordOnTime(next, false) ? "" : "btn-primary"}`}
              aria-label={`Abrir dose: próxima de ${next.treatment.name}, ${who(next)}`}>
              Abrir dose
            </Link>
          </div>
        </div>
      )}

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
          const quick = canRecordOnTime(o, !!pending);
          return (
            <li key={o.id} className="dose-row">
              <Link to={`/doses/${o.id}`} state={{ occurrence: o }}
                className={`dose ${o.late && !pending ? "dose-late" : ""} ${quick ? "dose-has-quick" : ""}`}>
                <span className="dose-time">{formatTime(o.scheduledAt)}</span>
                <span className="dose-main">
                  <strong>{o.treatment.name}</strong>
                  <span className="muted small">{mine.has(o.person.id) ? "Você" : o.person.displayName} · {o.treatment.prescribedDose}</span>
                  {o.administration && (
                    <span className="muted small">
                      {formatTime(o.administration.administeredAt)} · {o.administration.recordedBy?.displayName}
                    </span>
                  )}
                </span>
                <span className="dose-side">
                  <StatusBadge status={o.status} late={o.late} queued={pending?.state === "pending"} />
                </span>
              </Link>
              {quick && (
                <button className="btn btn-small dose-quick" aria-label={onTimeLabel(o)} onClick={() => setOnTime(o)}>
                  <Icon name="check" />Dada no horário
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {onTime && <OnTimeDialog occurrence={onTime} who={who(onTime)} onClose={() => setOnTime(null)} />}
    </div>
  );
}
