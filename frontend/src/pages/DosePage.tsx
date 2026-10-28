import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { api, errorMessage } from "../api/client";
import type { OccurrenceDetail, OccurrenceView } from "../api/types";
import type { OutboxItem } from "../db/db";
import { Icon } from "../components/Icon";
import { Notice, Spinner } from "../components/Layout";
import { StatusBadge } from "../components/StatusBadge";
import { useCached } from "../hooks/useCached";
import { useOnline } from "../hooks/useOnline";
import { useOutbox } from "../hooks/useOutbox";
import { TRAIL_EVENT } from "../lib/labels";
import { formatTime, formatWhen, fromLocalInput, toLocalInput } from "../lib/time";
import { useFamily, useSession } from "../session";
import { discard, mutate, pendingFor, submitReport } from "../sync/outbox";

/** Detalhe e registro de uma dose (seção 7.2). */
export function DosePage() {
  const { id } = useParams();
  const family = useFamily();
  const location = useLocation();
  const fromAgenda = (location.state as { occurrence?: OccurrenceView } | null)?.occurrence;
  const detail = useCached(`dose:${id}`, () => api<OccurrenceDetail>(`/families/${family.id}/occurrences/${id}`));
  const outbox = useOutbox(family.id);
  const queued = outbox.find((i) => i.occurrenceId === id && i.state === "pending");
  const pendingMutations = outbox.filter((i) => i.kind === "MUTATION" && i.entityId === id && i.state === "pending");
  // Correção ou conferência feita offline, ainda não enviada.
  const change = pendingMutations.find((i) => !i.path.endsWith("/snooze"));
  // "Lembrar daqui a pouco" ainda não enviado: vale o último.
  const snooze = pendingMutations.findLast((i) => i.path.endsWith("/snooze"));
  const navigate = useNavigate();

  const occurrence = detail.data?.occurrence ?? fromAgenda;
  if (!occurrence) {
    return detail.loading ? <Spinner /> : <div className="page"><Notice tone="error">{detail.error}</Notice></div>;
  }
  const open = occurrence.status === "PENDING" || occurrence.status === "SCHEDULED";

  return (
    <div className="page">
      <header className="screen-bar">
        <button className="round-btn light" aria-label="Voltar" onClick={() => navigate(-1)}><Icon name="back" /></button>
        <h1 className="screen-bar-title">Dose</h1>
        <span className="screen-bar-spacer" />
      </header>
      {!detail.fresh && <Notice tone="warn">Sem conexão: estes dados podem estar desatualizados.</Notice>}

      <section className="dose-hero" aria-label="Dose prevista">
        <span className="dose-hero-icon"><Icon name="pill" size={44} /></span>
        <strong className="dose-hero-name">{occurrence.treatment.name}</strong>
        <span className="muted">{occurrence.person.displayName}</span>
        <span className="row wrap dose-hero-chips">
          <span className="time-chip"><Icon name="clock" />{formatWhen(occurrence.scheduledAt)}</span>
          <StatusBadge status={occurrence.status} late={occurrence.late} queued={!!queued} />
        </span>
      </section>

      <dl className="facts-list">
        <div><dt>Horário previsto</dt><dd>{formatWhen(occurrence.scheduledAt)}</dd></div>
        <div><dt>Dose</dt><dd>{occurrence.treatment.prescribedDose} <span className="muted small">(conforme cadastro)</span></dd></div>
        {occurrence.treatment.route && <div><dt>Via</dt><dd>{occurrence.treatment.route}</dd></div>}
      </dl>

      {queued && (
        <Notice tone="warn">
          Registrado neste aparelho às {formatTime(String(queued.body.recordedAt))}
          {queued.kind === "NOT_ADMINISTERED" ? " como não administrada" : ""}. Será enviado quando houver conexão.
        </Notice>
      )}

      {change && (
        <Notice tone="warn">{change.label} guardada neste aparelho. Será enviada quando houver conexão.</Notice>
      )}
      {open && !queued && <RecordForm occurrence={occurrence} onDone={() => navigate("/")} />}
      {open && !queued && <Claim occurrence={occurrence} onChange={() => void detail.reload()} />}
      {open && !queued && <Snooze occurrence={occurrence} pending={snooze} onChange={() => void detail.reload()} />}
      {open && !queued && (
        <section className="card stack">
          <h2>Mudar horários do tratamento</h2>
          <p className="muted small">
            Se os horários mudaram de vez, altere o tratamento: você escolhe a partir de quando vale e o motivo,
            e confere antes de salvar. Doses já registradas não mudam.
          </p>
          <Link className="btn" to={`/tratamentos/${occurrence.treatment.id}/editar`}>Mudar horários do tratamento</Link>
        </section>
      )}
      {occurrence.administration && <RecordSummary detail={detail.data} occurrence={occurrence} />}
      {occurrence.status === "NOT_ADMINISTERED" && (
        <Notice>
          Registrado que não foi dada{occurrence.statusChangedBy ? ` por ${occurrence.statusChangedBy.displayName}` : ""}
          {occurrence.statusReason ? `: ${occurrence.statusReason}` : "."}
        </Notice>
      )}
      {occurrence.status === "CANCELLED" && (
        <Notice>Dose cancelada{occurrence.statusReason ? `: ${occurrence.statusReason}` : ""}.</Notice>
      )}
      {occurrence.status === "REVIEW_REQUIRED" && detail.data && !change && (
        <ConflictReview detail={detail.data} onDone={() => void detail.reload()} />
      )}
      {(occurrence.status === "ADMINISTERED" || occurrence.status === "NOT_ADMINISTERED") && !change && (
        <Correction occurrence={occurrence} onDone={() => void detail.reload()} />
      )}
      {detail.data && <Trail detail={detail.data} />}
    </div>
  );
}

/** "Estou cuidando desta dose" (seção 6.3): reduz os lembretes dos outros; não é administração. */
function Claim({ occurrence, onChange }: { occurrence: OccurrenceView; onChange: () => void }) {
  const family = useFamily();
  const { me } = useSession();
  const online = useOnline();
  const [error, setError] = useState<string | null>(null);
  const mine = occurrence.claimedBy?.id === me?.id;
  async function toggle() {
    setError(null);
    try {
      await api(`/families/${family.id}/occurrences/${occurrence.id}/claim`, { method: mine ? "DELETE" : "POST" });
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  if (occurrence.claimedBy && !mine) {
    return <Notice>{occurrence.claimedBy.displayName} está cuidando desta dose até {formatTime(occurrence.claimedUntil!)}.</Notice>;
  }
  return (
    <div className="stack">
      {error && <Notice tone="error">{error}</Notice>}
      <button className="btn" disabled={!online} onClick={() => void toggle()}>
        {mine ? `Você está cuidando até ${formatTime(occurrence.claimedUntil!)} · liberar` : "Estou cuidando desta dose"}
      </button>
      {!online && <p className="muted small">"Estou cuidando" avisa os outros na hora; sem conexão, não há como avisar.</p>}
      {!mine && <p className="muted small">Avisa os outros responsáveis e silencia os lembretes deles por alguns minutos. Não registra a dose.</p>}
    </div>
  );
}

const SNOOZE_MINUTES = [15, 30, 60];

/**
 * "Lembrar daqui a pouco": adia só o lembrete de quem pediu. A dose continua
 * no horário previsto (e fica atrasada depois da tolerância), e as próximas
 * não mudam. Funciona offline: a hora é calculada aqui e vai pela fila.
 */
function Snooze({ occurrence, pending, onChange }: { occurrence: OccurrenceView; pending?: OutboxItem; onChange: () => void }) {
  const family = useFamily();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remindAt = pending ? (pending.method === "DELETE" ? null : String(pending.body.remindAt)) : occurrence.remindAt ?? null;
  const active = remindAt !== null && new Date(remindAt) > new Date();

  async function save(minutes: number | null) {
    setBusy(true);
    setError(null);
    const at = minutes === null ? null : new Date(Date.now() + minutes * 60_000).toISOString();
    try {
      await mutate({
        familyId: family.id,
        method: at ? "PUT" : "DELETE",
        path: `/families/${family.id}/occurrences/${occurrence.id}/snooze`,
        body: at ? { remindAt: at } : undefined,
        label: at ? `Lembrete adiado para ${formatTime(at)}` : "Cancelamento do lembrete adiado",
        entityId: occurrence.id,
      });
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-label="Lembrar daqui a pouco">
      <h2>Lembrar daqui a pouco</h2>
      {error && <Notice tone="error">{error}</Notice>}
      {active && (
        <div className="row wrap">
          <span>Vamos lembrar você às <strong>{formatTime(remindAt!)}</strong>.</span>
          {pending && <span className="badge badge-queued"><Icon name="sync" />Aguardando envio</span>}
        </div>
      )}
      <div className="chips" role="group" aria-label="Lembrar de novo daqui a">
        {SNOOZE_MINUTES.map((m) => (
          <button key={m} type="button" className="chip" disabled={busy} onClick={() => void save(m)}>
            {m < 60 ? `${m} min` : "1 hora"}
          </button>
        ))}
      </div>
      {active && <button className="btn" disabled={busy} onClick={() => void save(null)}>Cancelar o adiamento</button>}
      <p className="muted small">
        Só o seu lembrete muda: a dose continua prevista para as {formatTime(occurrence.scheduledAt)} e as próximas
        doses não mudam. O lembrete chega nos seus aparelhos com notificações ativadas.
      </p>
    </section>
  );
}

function RecordForm({ occurrence, onDone }: { occurrence: OccurrenceView; onDone: () => void }) {
  const family = useFamily();
  const { deviceId } = useSession();
  const [at, setAt] = useState(() => toLocalInput(new Date()));
  // Atalho para quem deu no horário: preenche o campo, mas o registro continua
  // sendo confirmado pela pessoa. Só aparece quando o horário previsto já passou.
  const planned = new Date(occurrence.scheduledAt) <= new Date() ? toLocalInput(new Date(occurrence.scheduledAt)) : null;
  const [notes, setNotes] = useState("");
  const [notGiven, setNotGiven] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function report(kind: "ADMINISTER" | "NOT_ADMINISTERED") {
    if (!deviceId) {
      setError("Este aparelho ainda não foi registrado. Conecte-se à internet e abra o app de novo.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await submitReport({
      familyId: family.id,
      occurrenceId: occurrence.id,
      kind,
      deviceId,
      baseVersion: occurrence.version,
      administeredAt: kind === "ADMINISTER" ? fromLocalInput(at) : undefined,
      notes: kind === "ADMINISTER" ? notes.trim() || undefined : undefined,
      reason: kind === "NOT_ADMINISTERED" ? reason.trim() || undefined : undefined,
    });
    setBusy(false);
    if (result.state === "failed") {
      setError(result.error.message);
      // O erro já está na tela; não precisa ficar na fila de pendências.
      const items = await pendingFor(family.id);
      await Promise.all(items.filter((i) => i.occurrenceId === occurrence.id && i.state === "failed").map((i) => discard(i.id)));
    } else {
      // Offline, a tela Hoje mostra o registro como "Aguardando envio".
      onDone();
    }
  }

  return (
    <section className="card stack">
      <h2>Registrar administração</h2>
      {error && <Notice tone="error">{error}</Notice>}
      <label>
        Horário efetivo
        <input type="datetime-local" value={at} max={toLocalInput(new Date())} onChange={(e) => setAt(e.target.value)} />
      </label>
      {planned && (
        <div className="chips" role="group" aria-label="Atalhos de horário">
          <button type="button" className={`chip${at === planned ? " chip-on" : ""}`} aria-pressed={at === planned}
            onClick={() => setAt(planned)}>
            No horário previsto ({formatTime(occurrence.scheduledAt)})
          </button>
          <button type="button" className="chip" onClick={() => setAt(toLocalInput(new Date()))}>
            Agora
          </button>
        </div>
      )}
      <label>
        Observações <span className="muted small">(opcional)</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
      </label>
      <button className="btn btn-primary btn-big" disabled={busy || !at} onClick={() => void report("ADMINISTER")}>
        <Icon name="check" size={22} />Confirmar administração
      </button>
      {notGiven ? (
        <div className="stack">
          <label>
            Motivo <span className="muted small">(opcional)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} autoFocus />
          </label>
          <button className="btn" disabled={busy} onClick={() => void report("NOT_ADMINISTERED")}>
            Confirmar que não foi dada
          </button>
        </div>
      ) : (
        <button className="btn" disabled={busy} onClick={() => setNotGiven(true)}>Registrar que não foi dada</button>
      )}
      <p className="muted small">Ao confirmar, o registro ficará associado ao seu usuário. O aplicativo não sugere dose extra.</p>
    </section>
  );
}

function RecordSummary({ detail, occurrence }: { detail?: OccurrenceDetail; occurrence: OccurrenceView }) {
  const a = occurrence.administration!;
  return (
    <section className="card">
      <h2>{occurrence.status === "REVIEW_REQUIRED" ? "Registro atual" : "Registro"}</h2>
      <dl className="facts">
        <dt>Administrada às</dt><dd>{formatWhen(a.administeredAt)}</dd>
        <dt>Registrado por</dt><dd>{a.recordedBy?.displayName}</dd>
        <dt>Registrado às</dt><dd>{formatWhen(a.recordedAt)}</dd>
        {a.notes && (<><dt>Observações</dt><dd>{a.notes}</dd></>)}
      </dl>
      {detail && detail.records.length > 1 && (
        <p className="muted small">{detail.records.length - 1} registro(s) anterior(es) corrigido(s) — veja o histórico abaixo.</p>
      )}
    </section>
  );
}

/** Correção com motivo; preserva o registro original (seção 4.4). */
function Correction({ occurrence, onDone }: { occurrence: OccurrenceView; onDone: () => void }) {
  const family = useFamily();
  const { deviceId } = useSession();
  const online = useOnline();
  const [openForm, setOpenForm] = useState(false);
  const [target, setTarget] = useState<"ADMINISTERED" | "NOT_ADMINISTERED" | "OPEN">("ADMINISTERED");
  const [at, setAt] = useState(() =>
    toLocalInput(new Date(occurrence.administration?.administeredAt ?? Date.now())));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!openForm) {
    return <button className="btn" onClick={() => setOpenForm(true)}>Corrigir registro</button>;
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await mutate({
        familyId: family.id, method: "POST", path: `/families/${family.id}/occurrences/${occurrence.id}/correction`,
        body: {
          baseVersion: occurrence.version,
          status: target,
          reason: reason.trim(),
          administeredAt: target === "ADMINISTERED" ? fromLocalInput(at) : undefined,
          deviceId: target === "ADMINISTERED" ? deviceId : undefined,
        },
        label: `Correção da dose de ${occurrence.treatment.name}`,
        entityId: occurrence.id,
      });
      setOpenForm(false);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card stack">
      <h2>Corrigir registro</h2>
      {!online && <Notice tone="warn">Sem conexão: a correção fica guardada e é enviada quando a conexão voltar. Se a dose mudar antes disso, o servidor recusa e você decide de novo.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <fieldset className="stack">
        <legend>O que aconteceu de fato?</legend>
        <label className="radio"><input type="radio" checked={target === "ADMINISTERED"} onChange={() => setTarget("ADMINISTERED")} /> Foi administrada</label>
        <label className="radio"><input type="radio" checked={target === "NOT_ADMINISTERED"} onChange={() => setTarget("NOT_ADMINISTERED")} /> Não foi administrada</label>
        <label className="radio"><input type="radio" checked={target === "OPEN"} onChange={() => setTarget("OPEN")} /> Ainda não foi decidido (reabrir)</label>
      </fieldset>
      {target === "ADMINISTERED" && (
        <label>
          Horário efetivo
          <input type="datetime-local" value={at} max={toLocalInput(new Date())} onChange={(e) => setAt(e.target.value)} />
        </label>
      )}
      <label>
        Motivo da correção
        <input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={1000} />
      </label>
      <p className="muted small">O registro anterior é preservado no histórico.</p>
      <div className="row">
        <button className="btn btn-primary" disabled={busy || !reason.trim()} onClick={() => void save()}>Salvar correção</button>
        <button className="btn" onClick={() => setOpenForm(false)}>Cancelar</button>
      </div>
    </section>
  );
}

/** Revisão de registros divergentes (seções 7.6 e 10.3): nada é aplicado sozinho. */
function ConflictReview({ detail, onDone }: { detail: OccurrenceDetail; onDone: () => void }) {
  const family = useFamily();
  const online = useOnline();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { occurrence, conflict } = detail;

  async function resolve(status: "ADMINISTERED" | "NOT_ADMINISTERED", proposalId?: string) {
    setBusy(true);
    setError(null);
    try {
      await mutate({
        familyId: family.id, method: "POST", path: `/families/${family.id}/occurrences/${occurrence.id}/resolution`,
        body: { baseVersion: occurrence.version, status, proposalId, reason: reason.trim() },
        label: `Conferência da dose de ${occurrence.treatment.name}`,
        entityId: occurrence.id,
      });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack conflict">
      <h2>Registros divergentes</h2>
      <p>Esta dose recebeu registros que não combinam. <strong>Nenhum foi aplicado automaticamente.</strong> Confira com os
        outros responsáveis antes de decidir.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="proposal">
        <h3>Já estava registrado</h3>
        {occurrence.administration ? (
          <p>Administrada às {formatTime(occurrence.administration.administeredAt)} por {occurrence.administration.recordedBy?.displayName}</p>
        ) : (
          <p>{String(conflict?.previous?.status ?? "") === "CANCELLED" ? "Dose cancelada por alteração do tratamento" : "Não administrada"}</p>
        )}
      </div>
      {conflict?.proposals.map((p) => (
        <div className="proposal" key={p.id}>
          <h3>Registro de {p.recordedBy?.displayName}</h3>
          <p>
            {p.type === "ADMINISTER"
              ? `Administrada às ${formatTime(p.administeredAt ?? p.recordedAt ?? p.receivedAt)}`
              : `Não administrada${p.reason ? `: ${p.reason}` : ""}`}
            <span className="muted small"> · feito às {formatTime(p.recordedAt ?? p.receivedAt)}</span>
          </p>
          {p.type === "ADMINISTER" && (
            <button className="btn btn-small" disabled={busy || !reason.trim()} onClick={() => void resolve("ADMINISTERED", p.id)}>
              Valer este registro
            </button>
          )}
        </div>
      ))}
      <label>
        Como foi decidido? <span className="muted small">(obrigatório)</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="Ex.: conversamos e foi dada uma vez" />
      </label>
      <div className="row wrap">
        {occurrence.administration && (
          <button className="btn btn-primary" disabled={busy || !reason.trim()} onClick={() => void resolve("ADMINISTERED")}>
            Manter o registro atual
          </button>
        )}
        <button className="btn" disabled={busy || !reason.trim()} onClick={() => void resolve("NOT_ADMINISTERED")}>
          Não foi administrada
        </button>
      </div>
      {!online && <p className="muted small">Sem conexão: a decisão fica guardada e é enviada quando a conexão voltar.</p>}
    </section>
  );
}

function Trail({ detail }: { detail: OccurrenceDetail }) {
  if (detail.trail.length === 0) return null;
  return (
    <section className="card">
      <h2>Histórico desta dose</h2>
      <ol className="trail">
        {detail.trail.map((t, i) => (
          <li key={i}>
            <strong>{TRAIL_EVENT[t.eventType] ?? t.eventType}</strong>
            <span className="muted small"> · {formatWhen(t.occurredAt)} · {t.actor?.displayName}</span>
            {t.reason && <div className="small">Motivo: {t.reason}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}
