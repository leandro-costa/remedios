import { useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api/client";
import type { OccurrenceView, PersonView, TreatmentConflictView, TreatmentView } from "../api/types";
import { AgendaRange, move, startOfMonth, startOfWeek, type AgendaView } from "../components/AgendaRange";
import { AsNeededCard } from "../components/AsNeeded";
import { Notice, Spinner } from "../components/Layout";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { canRecordNow, canRecordOnTime, OnTimeDialog } from "../components/OnTimeDialog";
import { ProgressRing } from "../components/ProgressRing";
import { StatusBadge } from "../components/StatusBadge";
import { SyncStatus } from "../components/SyncStatus";
import { useCached } from "../hooks/useCached";
import { ALL, recall, remember, resolvePerson } from "../lib/remember";
import { queries } from "../lib/queries";
import { undecided } from "../lib/eventual";
import { hiddenEventual, isEventual, prescriptionTitle, usePrescriptions } from "../lib/prescriptions";
import { useOutbox } from "../hooks/useOutbox";
import { addDays, formatDay, formatLongDay, formatTime, greeting, sameDay, startOfDay } from "../lib/time";
import { useFamily, useSession } from "../session";

/** Tela inicial (seção 7.1): doses do dia, por pessoa. */
export function TodayPage() {
  const family = useFamily();
  const { me } = useSession();
  // Dia, visão e pessoa ficam no endereço: ao abrir uma dose e voltar, a tela
  // continua como estava (ex.: na semana passada, filtrada por uma pessoa).
  const [params, setParams] = useSearchParams();
  const day = parseDay(params.get("dia")) ?? startOfDay(new Date());
  // Sem visão ou pessoa no endereço (ao abrir o app), vale a última escolha guardada.
  const saved = recall(family.id, "hoje");
  const visao = params.get("visao") ?? saved.visao;
  const view: AgendaView = visao === "semana" ? "week" : visao === "mes" ? "month" : "day";
  const persons = useCached(`persons:${family.id}`, () => api<PersonView[]>(`/families/${family.id}/persons`, { query: { active: "true" } }));
  const personId = resolvePerson(params.get("pessoa") ?? saved.pessoa, persons.data, me?.id);
  // Mudança ainda não aplicada ao endereço: dois toques ou arrastes seguidos
  // partem do resultado do anterior, não do que estava na tela.
  const pending = useRef<URLSearchParams | null>(null);
  useEffect(() => { pending.current = null; }, [params]);
  const update = (patch: { day?: Date; view?: AgendaView; personId?: string | null }) => {
    const next = new URLSearchParams(pending.current ?? params);
    const set = (key: string, value: string | null) => (value ? next.set(key, value) : next.delete(key));
    if (patch.day) set("dia", sameDay(patch.day, new Date()) ? null : dayKey(patch.day));
    if (patch.view) set("visao", patch.view === "week" ? "semana" : patch.view === "month" ? "mes" : "dia");
    if (patch.personId !== undefined) set("pessoa", patch.personId ?? ALL);
    remember(family.id, "hoje", {
      ...(patch.view ? { visao: next.get("visao")! } : {}),
      ...(patch.personId !== undefined ? { pessoa: patch.personId ?? ALL } : {}),
    });
    pending.current = next;
    setParams(next, { replace: true });
  };
  /** Avança ou volta um dia (ou semana, ou mês) a partir do dia mais recente escolhido. */
  const step = (by: 1 | -1) => {
    const current = pending.current ?? params;
    const from = parseDay(current.get("dia")) ?? startOfDay(new Date());
    const cv = current.get("visao") ?? recall(family.id, "hoje").visao;
    const v: AgendaView = cv === "semana" ? "week" : cv === "mes" ? "month" : "day";
    update({ day: move(from, v, by) });
  };
  // Arrastar para o lado muda de dia (ou de semana, ou de mês).
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    // Faixas que rolam para o lado (filtros) não mudam o dia.
    touch.current = (e.target as HTMLElement).closest(".chips, .month, input, dialog") ? null
      : { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
  };
  const [onTime, setOnTime] = useState<{ occurrence: OccurrenceView; now: boolean } | null>(null);

  const agendaQuery = queries.agenda(family.id, day);
  const agenda = useCached(agendaQuery.key, agendaQuery.fetch);
  const treatmentConflicts = useCached(`treatment-conflicts:${family.id}`, () =>
    api<TreatmentConflictView[]>(`/families/${family.id}/treatments/conflicts`));
  const treatments = useCached(`treatments:${family.id}`, () => api<TreatmentView[]>(`/families/${family.id}/treatments`));
  const outbox = useOutbox(family.id);
  const queued = useMemo(() => new Map(outbox.filter((i) => i.occurrenceId).map((i) => [i.occurrenceId!, i])), [outbox]);

  const mine = new Set((persons.data ?? []).filter((p) => p.userId && p.userId === me?.id).map((p) => p.id));
  // Doses canceladas (tratamento encerrado ou alterado) não pedem nenhuma ação:
  // ficam no histórico e no tratamento, não no dia.
  const doses = (agenda.data ?? [])
    .filter((o) => o.status !== "CANCELLED")
    // Doses "se necessário" não são previstas: ficam no cartão do remédio, abaixo.
    .filter((o) => o.treatment.kind !== "AS_NEEDED")
    .filter((o) => sameDay(new Date(o.scheduledAt), day))
    .filter((o) => !personId || o.person.id === personId);
  // Item do uso eventual com o mesmo medicamento de uma receita ativa fica oculto: vale a receita.
  const hidden = hiddenEventual(treatments.data ?? []);
  const asNeeded = (treatments.data ?? []).filter((t) => t.kind === "AS_NEEDED" && t.status === "ACTIVE" && !hidden.has(t.id))
    .filter((t) => !personId || t.personId === personId);
  // Receitas encerradas nos últimos 7 dias com itens "se necessário" ainda sem decisão.
  const prescriptions = usePrescriptions();
  const endedAsk = (prescriptions.data ?? []).filter((p) => p.kind !== "EVENTUAL" && p.id !== p.personId)
    .filter((p) => !personId || p.personId === personId)
    .map((p) => {
      const items = (treatments.data ?? []).filter((t) => t.prescriptionId === p.id && !isEventual(t));
      const ended = items.length > 0 && items.every((t) => t.status === "ENDED");
      const lastUpdate = Math.max(0, ...items.map((t) => new Date(t.updatedAt).getTime()));
      const pending = ended && Date.now() - lastUpdate < 7 * 86_400_000 ? undecided(items, treatments.data ?? []) : [];
      return { p, items, pending };
    })
    .filter((x) => x.pending.length > 0);
  const personName = (id: string) => mine.has(id) ? "Você" : persons.data?.find((p) => p.id === id)?.displayName;
  const review = (agenda.data ?? []).filter((o) => o.status === "REVIEW_REQUIRED").length;
  const treatmentReview = (treatmentConflicts.data ?? []).length;
  const isToday = sameDay(day, new Date());
  // Progresso do dia: doses dadas (inclui as registradas aqui e ainda não enviadas).
  const counted = doses;
  const given = counted.filter((o) => o.status === "ADMINISTERED"
    || (queued.get(o.id)?.state === "pending" && queued.get(o.id)?.kind === "ADMINISTER")).length;
  const open = (o: OccurrenceView) => (o.status === "PENDING" || o.status === "SCHEDULED") && !queued.has(o.id);
  const who = (o: OccurrenceView) => (mine.has(o.person.id) ? "você" : o.person.displayName);
  const nowLabel = (o: OccurrenceView) => `Dada agora: ${o.treatment.name} de ${who(o)}, prevista para ${formatTime(o.scheduledAt)}`;
  const onTimeLabel = (o: OccurrenceView) =>
    `Dada no horário: ${o.treatment.name} de ${who(o)} às ${formatTime(o.scheduledAt)}`;
  const next = isToday ? doses.filter(open).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0] : undefined;

  const now = new Date();
  // Na visão atual, o dia/semana/mês de hoje está na tela?
  const showingNow = view === "day" ? isToday
    : view === "week" ? sameDay(startOfWeek(day), startOfWeek(now))
    : sameDay(startOfMonth(day), startOfMonth(now));
  const dayTitle = view === "week" ? "Semana"
    : view === "month" ? capitalize(day.toLocaleDateString("pt-BR", { month: "long" }))
    : isToday ? "Hoje"
    : sameDay(day, addDays(startOfDay(now), -1)) ? "Ontem"
    : sameDay(day, addDays(startOfDay(now), 1)) ? "Amanhã" : formatDay(day);
  const subtitle = view === "week"
    ? `${shortDate(startOfWeek(day))} – ${shortDate(addDays(startOfWeek(day), 6))}`
    : view === "month" ? String(day.getFullYear()) : formatLongDay(day);
  const unit = view === "day" ? ["Dia anterior", "Próximo dia"] : view === "week" ? ["Semana anterior", "Próxima semana"] : ["Mês anterior", "Próximo mês"];
  const firstName = (me?.displayName ?? "").split(" ")[0];

  return (
    <div className="page page-today" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <section className={`hero ${next && view === "day" ? "hero-with-card" : ""}`}>
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
              <button className="icon-btn" aria-label={unit[0]} onClick={() => step(-1)}>‹</button>
              <span className="hero-muted">{subtitle}</span>
              <button className="icon-btn" aria-label={unit[1]} onClick={() => step(1)}>›</button>
            </div>
            <SyncStatus familyId={family.id} fresh={agenda.fresh} savedAt={agenda.savedAt} />
            {!showingNow && (
              <button className="today-chip" aria-label="Voltar para hoje" onClick={() => update({ day: startOfDay(new Date()) })}>
                <Icon name="back" />Hoje
              </button>
            )}
          </div>
          {view === "day" && counted.length > 0 && <ProgressRing done={given} total={counted.length} />}
        </div>
        <div className="segmented view-switch" role="radiogroup" aria-label="Visão">
          {(["day", "week", "month"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? "on" : ""}
              onClick={() => update({ view: v })}>{v === "day" ? "Dia" : v === "week" ? "Semana" : "Mês"}</button>
          ))}
        </div>
      </section>
      {next && view === "day" && (
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
          {(canRecordOnTime(next, false) || canRecordNow(next, false)) && (
            <div className="next-dose-actions">
              {canRecordOnTime(next, false) && (
                <button className="btn btn-primary" aria-label={onTimeLabel(next)} onClick={() => setOnTime({ occurrence: next, now: false })}>
                  <Icon name="check" />Dada no horário
                </button>
              )}
              <button className={`btn ${canRecordOnTime(next, false) ? "" : "btn-primary"}`} aria-label={nowLabel(next)}
                onClick={() => setOnTime({ occurrence: next, now: true })}>
                <Icon name="check" />Dada agora
              </button>
            </div>
          )}
          <div className="stack">
            <Link to={`/doses/${next.id}`} state={{ occurrence: next }}
              className={`btn ${canRecordNow(next, false) ? "" : "btn-primary"}`}
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
        <button className={`chip ${personId === null ? "chip-on" : ""}`} onClick={() => update({ personId: null })}>Todos</button>
        {(persons.data ?? []).map((p) => (
          <button key={p.id} className={`chip ${personId === p.id ? "chip-on" : ""}`} onClick={() => update({ personId: p.id })}>
            {p.userId && p.userId === me?.id ? "Você" : p.displayName}
          </button>
        ))}
      </div>

      {view !== "day" && (
        <AgendaRange view={view} day={day} personId={personId} queued={new Set(queued.keys())} who={who}
          onOpenDay={(d) => update({ day: startOfDay(d), view: "day" })} />
      )}
      {view === "day" && (
        <>
      {agenda.error && !agenda.data && <Notice tone="error">{agenda.error}</Notice>}
      {agenda.loading && !agenda.data && <Spinner />}
      {agenda.data && doses.length === 0 && (
        <p className="empty">Nenhuma dose prevista {isToday ? "para hoje" : "neste dia"}.</p>
      )}

      <ul className="doses">
        {doses.map((o) => {
          const pending = queued.get(o.id);
          const onTimeOk = canRecordOnTime(o, !!pending);
          const nowOk = canRecordNow(o, !!pending);
          const quick = onTimeOk || nowOk;
          return (
            <li key={o.id} className={`dose-row ${quick ? "has-quick" : ""}`}>
              <Link to={`/doses/${o.id}`} state={{ occurrence: o }}
                className={`dose ${o.late && !pending ? "dose-late" : ""}`}>
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
                <div className="dose-quick">
                  {onTimeOk && (
                    <button className="btn btn-small" aria-label={onTimeLabel(o)} onClick={() => setOnTime({ occurrence: o, now: false })}>
                      <Icon name="check" />Dada no horário
                    </button>
                  )}
                  <button className="btn btn-small" aria-label={nowLabel(o)} onClick={() => setOnTime({ occurrence: o, now: true })}>
                    <Icon name="check" />Dada agora
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {isToday && endedAsk.map(({ p, items, pending }) => (
        <Notice key={p.id}>
          A receita <strong>{prescriptionTitle(p, items)}</strong> terminou. Manter {pending.map((t) => t.name).join(", ")} no uso eventual?{" "}
          <Link to={`/receitas/${p.id}`}>Decidir</Link>
        </Notice>
      ))}
      {isToday && asNeeded.length > 0 && (
        <section className="stack" aria-label="Se necessário">
          <h2>Se necessário</h2>
          {asNeeded.map((t) => <AsNeededCard key={t.id} treatment={t} personName={personName(t.personId)} compact />)}
        </section>
      )}
        </>
      )}
      {onTime && <OnTimeDialog occurrence={onTime.occurrence} now={onTime.now} who={who(onTime.occurrence)} onClose={() => setOnTime(null)} />}
    </div>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "27 out" */
function shortDate(date: Date): string {
  return date.toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "");
}

/** "2026-10-31" no fuso do aparelho. */
function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDay(value: string | null): Date | null {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
