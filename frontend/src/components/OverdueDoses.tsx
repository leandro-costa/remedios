import { useState } from "react";
import { Link } from "react-router";
import { useCached } from "../hooks/useCached";
import { queries } from "../lib/queries";
import { formatDay, formatTime, startOfDay } from "../lib/time";
import { useFamily } from "../session";
import { Icon } from "./Icon";
import { StatusBadge } from "./StatusBadge";

/** Dias anteriores consultados para doses ainda sem registro. */
export const OVERDUE_DAYS = 7;

/**
 * Doses de dias anteriores que passaram do horário e ninguém registrou
 * (dada ou não dada). Na tela Hoje, um botão mostra a lista; cada dose abre
 * o detalhe para registrar. Só lista; não sugere nem repõe doses.
 */
export function OverdueDoses({ personId, queued, who }: {
  personId: string | null; queued: Set<string>; who: (personId: string, name: string) => string;
}) {
  const family = useFamily();
  const today = startOfDay(new Date());
  const query = queries.overdue(family.id, today);
  const data = useCached(query.key, query.fetch);
  const [open, setOpen] = useState(false);

  const overdue = (data.data ?? [])
    .filter((o) => (o.status === "PENDING" || o.status === "SCHEDULED") && new Date(o.scheduledAt) < today)
    .filter((o) => !queued.has(o.id))
    .filter((o) => !personId || o.person.id === personId)
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  if (overdue.length === 0) return null;

  const byDay = new Map<string, typeof overdue>();
  for (const o of overdue) {
    const key = formatDay(startOfDay(new Date(o.scheduledAt)));
    byDay.set(key, [...(byDay.get(key) ?? []), o]);
  }
  const label = overdue.length === 1 ? "1 dose atrasada de outro dia" : `${overdue.length} doses atrasadas de outros dias`;

  return (
    <section className="overdue stack" aria-label="Atrasadas de outros dias">
      <button type="button" className="btn overdue-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="alert" />{open ? "Ocultar" : "Ver"} {label}
      </button>
      {open && (
        <>
          <p className="muted small">
            Dos últimos {OVERDUE_DAYS} dias, sem registro. Abra a dose para registrar se foi dada ou não.
          </p>
          {[...byDay.entries()].map(([dayLabel, list]) => (
            <div key={dayLabel} className="stack">
              <h3 className="group-title">{dayLabel}</h3>
              <ul className="doses">
                {list.map((o) => (
                  <li key={o.id} className="dose-row">
                    <Link to={`/doses/${o.id}`} state={{ occurrence: o }} className="dose dose-late">
                      <span className="dose-time">{formatTime(o.scheduledAt)}</span>
                      <span className="dose-main">
                        <strong>{o.treatment.name}</strong>
                        <span className="muted small">{who(o.person.id, o.person.displayName)} · {o.treatment.prescribedDose}</span>
                      </span>
                      <span className="dose-side"><StatusBadge status={o.status} late /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

