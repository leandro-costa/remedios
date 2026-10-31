import { Link } from "react-router";
import { api } from "../api/client";
import type { OccurrenceView } from "../api/types";
import { useCached } from "../hooks/useCached";
import { addDays, formatTime, sameDay, startOfDay } from "../lib/time";
import { useFamily } from "../session";
import { Notice, Spinner } from "./Layout";
import { StatusBadge } from "./StatusBadge";

export type AgendaView = "day" | "week" | "month";

/** Domingo da semana do dia (calendário brasileiro). */
export function startOfWeek(day: Date): Date {
  return addDays(startOfDay(day), -day.getDay());
}

export function startOfMonth(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), 1);
}

/** Avança ou volta um dia, uma semana ou um mês. */
export function move(day: Date, view: AgendaView, step: number): Date {
  if (view === "day") return addDays(day, step);
  if (view === "week") return addDays(day, 7 * step);
  return new Date(day.getFullYear(), day.getMonth() + step, 1);
}

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const WEEKDAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

interface Summary {
  total: number;
  given: number;
  notGiven: number;
  late: number;
  review: number;
  upcoming: number;
}

function summarize(doses: OccurrenceView[], queued: Set<string>): Summary {
  const s: Summary = { total: doses.length, given: 0, notGiven: 0, late: 0, review: 0, upcoming: 0 };
  for (const o of doses) {
    if (o.status === "ADMINISTERED" || queued.has(o.id)) s.given++;
    else if (o.status === "NOT_ADMINISTERED") s.notGiven++;
    else if (o.status === "REVIEW_REQUIRED") s.review++;
    else if (o.late) s.late++;
    else s.upcoming++;
  }
  return s;
}

/** Situação do dia no calendário: precisa de atenção, tudo dado, a vir ou sem doses. */
function tone(s: Summary): "none" | "attention" | "review" | "done" | "upcoming" {
  if (s.total === 0) return "none";
  if (s.notGiven > 0 || s.late > 0) return "attention";
  if (s.review > 0) return "review";
  if (s.given === s.total) return "done";
  return "upcoming";
}

function describe(s: Summary): string {
  if (s.total === 0) return "Nenhuma dose";
  const parts = [`${s.given} de ${s.total} dadas`];
  if (s.notGiven) parts.push(`${s.notGiven} não ${s.notGiven === 1 ? "dada" : "dadas"}`);
  if (s.late) parts.push(`${s.late} ${s.late === 1 ? "atrasada" : "atrasadas"}`);
  if (s.review) parts.push(`${s.review} para conferir`);
  return parts.join(" · ");
}

/**
 * Semana (7 dias com as doses de cada um) ou mês (calendário com a situação
 * de cada dia). Tocar num dia abre o dia. Doses "se necessário" e canceladas
 * não entram: não são previstas.
 */
export function AgendaRange({ view, day, personId, queued, onOpenDay, who }: {
  view: "week" | "month"; day: Date; personId: string | null; queued: Set<string>;
  onOpenDay: (day: Date) => void; who: (o: OccurrenceView) => string;
}) {
  const family = useFamily();
  const first = view === "week" ? startOfWeek(day) : startOfWeek(startOfMonth(day));
  const days = Array.from({ length: view === "week" ? 7 : 42 }, (_, i) => addDays(first, i));
  const from = days[0];
  const to = addDays(days[days.length - 1], 1);
  const agenda = useCached(`agenda-range:${family.id}:${from.toISOString()}:${to.toISOString()}`, () =>
    api<OccurrenceView[]>(`/families/${family.id}/occurrences`, { query: { from: from.toISOString(), to: to.toISOString() } }));
  const doses = (agenda.data ?? [])
    .filter((o) => o.status !== "CANCELLED" && o.treatment.kind !== "AS_NEEDED")
    .filter((o) => !personId || o.person.id === personId);
  const ofDay = (d: Date) => doses.filter((o) => sameDay(new Date(o.scheduledAt), d))
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const today = new Date();

  if (agenda.loading && !agenda.data) return <Spinner />;
  return (
    <>
      {agenda.error && !agenda.data && <Notice tone="error">{agenda.error}</Notice>}
      {view === "week" ? (
        <ul className="week">
          {days.map((d) => {
            const list = ofDay(d);
            const s = summarize(list, queued);
            return (
              <li key={d.toISOString()} className={`week-day ${sameDay(d, today) ? "is-today" : ""}`}>
                <button type="button" className="week-head" onClick={() => onOpenDay(d)}
                  aria-label={`Abrir ${WEEKDAY_NAMES[d.getDay()]}, ${d.getDate()}: ${describe(s)}`}>
                  <span className={`day-dot tone-${tone(s)}`} aria-hidden="true" />
                  <strong>{WEEKDAY_NAMES[d.getDay()].replace(/^./, (c) => c.toUpperCase())}, {d.getDate()}</strong>
                  <span className="muted small">{describe(s)}</span>
                </button>
                {list.length > 0 && (
                  <ul className="week-doses">
                    {list.map((o) => (
                      <li key={o.id}>
                        <Link to={`/doses/${o.id}`} state={{ occurrence: o }} className="week-dose">
                          <span className="dose-time">{formatTime(o.scheduledAt)}</span>
                          <span className="dose-main">
                            <strong>{o.treatment.name}</strong>
                            <span className="muted small">{who(o)}</span>
                          </span>
                          <StatusBadge status={o.status} late={o.late} queued={queued.has(o.id)} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <section className="card">
          <div className="month" role="group" aria-label="Calendário do mês">
            {WEEKDAYS.map((w, i) => <span key={i} className="month-weekday" aria-hidden="true">{w}</span>)}
            {days.map((d) => {
              const s = summarize(ofDay(d), queued);
              const out = d.getMonth() !== day.getMonth();
              return (
                <button key={d.toISOString()} type="button"
                  className={`month-day tone-${tone(s)} ${out ? "out" : ""} ${sameDay(d, today) ? "is-today" : ""}`}
                  aria-label={`${d.getDate()} de ${d.toLocaleDateString("pt-BR", { month: "long" })}: ${describe(s)}`}
                  onClick={() => onOpenDay(d)}>
                  <span>{d.getDate()}</span>
                  {s.total > 0 && <span className="month-count">{s.given}/{s.total}</span>}
                </button>
              );
            })}
          </div>
          <ul className="legend-list" aria-label="Legenda">
            <li><span className="day-dot tone-done" aria-hidden="true" />Todas dadas</li>
            <li><span className="day-dot tone-attention" aria-hidden="true" />Não dada ou atrasada</li>
            <li><span className="day-dot tone-review" aria-hidden="true" />Para conferir</li>
            <li><span className="day-dot tone-upcoming" aria-hidden="true" />A dar</li>
          </ul>
        </section>
      )}
    </>
  );
}
