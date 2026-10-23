import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { api, errorMessage } from "../api/client";
import type { OccurrenceDetail, OccurrenceView } from "../api/types";
import { Notice, Spinner } from "../components/Layout";
import { StatusBadge } from "../components/StatusBadge";
import { useCached } from "../hooks/useCached";
import { useOnline } from "../hooks/useOnline";
import { useOutbox } from "../hooks/useOutbox";
import { TRAIL_EVENT } from "../lib/labels";
import { formatTime, formatWhen, fromLocalInput, toLocalInput } from "../lib/time";
import { useFamily, useSession } from "../session";
import { discard, pendingFor, submitReport } from "../sync/outbox";

/** Detalhe e registro de uma dose (seção 7.2). */
export function DosePage() {
  const { id } = useParams();
  const family = useFamily();
  const location = useLocation();
  const fromAgenda = (location.state as { occurrence?: OccurrenceView } | null)?.occurrence;
  const detail = useCached(`dose:${id}`, () => api<OccurrenceDetail>(`/families/${family.id}/occurrences/${id}`));
  const outbox = useOutbox(family.id);
  const queued = outbox.find((i) => i.occurrenceId === id && i.state === "pending");
  const navigate = useNavigate();

  const occurrence = detail.data?.occurrence ?? fromAgenda;
  if (!occurrence) {
    return detail.loading ? <Spinner /> : <div className="page"><Notice tone="error">{detail.error}</Notice></div>;
  }
  const open = occurrence.status === "PENDING" || occurrence.status === "SCHEDULED";

  return (
    <div className="page">
      <button className="link back" onClick={() => navigate(-1)}>← Voltar</button>
      <h1>Dose</h1>
      {!detail.fresh && <Notice tone="warn">Sem conexão: estes dados podem estar desatualizados.</Notice>}

      <dl className="facts card">
        <dt>Pessoa</dt><dd>{occurrence.person.displayName}</dd>
        <dt>Medicamento</dt><dd>{occurrence.treatment.name}</dd>
        <dt>Horário previsto</dt><dd>{formatWhen(occurrence.scheduledAt)}</dd>
        <dt>Dose</dt><dd>{occurrence.treatment.prescribedDose} <span className="muted small">(conforme cadastro)</span></dd>
        {occurrence.treatment.route && (<><dt>Via</dt><dd>{occurrence.treatment.route}</dd></>)}
        <dt>Situação</dt><dd><StatusBadge status={occurrence.status} late={occurrence.late} queued={!!queued} /></dd>
      </dl>

      {queued && (
        <Notice tone="warn">
          Registrado neste aparelho às {formatTime(queued.body.recordedAt)}
          {queued.kind === "NOT_ADMINISTERED" ? " como não administrada" : ""}. Será enviado quando houver conexão.
        </Notice>
      )}

      {open && !queued && <RecordForm occurrence={occurrence} onDone={() => navigate("/")} />}
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
      {occurrence.status === "REVIEW_REQUIRED" && detail.data && (
        <ConflictReview detail={detail.data} onDone={() => void detail.reload()} />
      )}
      {(occurrence.status === "ADMINISTERED" || occurrence.status === "NOT_ADMINISTERED") && (
        <Correction occurrence={occurrence} onDone={() => void detail.reload()} />
      )}
      {detail.data && <Trail detail={detail.data} />}
    </div>
  );
}

function RecordForm({ occurrence, onDone }: { occurrence: OccurrenceView; onDone: () => void }) {
  const family = useFamily();
  const { deviceId } = useSession();
  const [at, setAt] = useState(() => toLocalInput(new Date()));
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
      <label>
        Observações <span className="muted small">(opcional)</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
      </label>
      <button className="btn btn-primary btn-big" disabled={busy || !at} onClick={() => void report("ADMINISTER")}>
        Confirmar administração
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
      await api(`/families/${family.id}/occurrences/${occurrence.id}/correction`, {
        method: "POST",
        body: {
          baseVersion: occurrence.version,
          status: target,
          reason: reason.trim(),
          administeredAt: target === "ADMINISTERED" ? fromLocalInput(at) : undefined,
          deviceId: target === "ADMINISTERED" ? deviceId : undefined,
        },
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
      {!online && <Notice tone="warn">A correção precisa de conexão.</Notice>}
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
        <button className="btn btn-primary" disabled={busy || !online || !reason.trim()} onClick={() => void save()}>Salvar correção</button>
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
      await api(`/families/${family.id}/occurrences/${occurrence.id}/resolution`, {
        method: "POST",
        body: { baseVersion: occurrence.version, status, proposalId, reason: reason.trim() },
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
            <button className="btn btn-small" disabled={busy || !online || !reason.trim()} onClick={() => void resolve("ADMINISTERED", p.id)}>
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
          <button className="btn btn-primary" disabled={busy || !online || !reason.trim()} onClick={() => void resolve("ADMINISTERED")}>
            Manter o registro atual
          </button>
        )}
        <button className="btn" disabled={busy || !online || !reason.trim()} onClick={() => void resolve("NOT_ADMINISTERED")}>
          Não foi administrada
        </button>
      </div>
      {!online && <p className="muted small">A conferência precisa de conexão.</p>}
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
