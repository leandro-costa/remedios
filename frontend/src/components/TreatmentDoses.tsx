import { useState } from "react";
import { Link } from "react-router";
import { errorMessage } from "../api/client";
import type { OccurrenceView, TreatmentView } from "../api/types";
import { isPending } from "../db/cache";
import { useCached } from "../hooks/useCached";
import { useOutbox } from "../hooks/useOutbox";
import { queries } from "../lib/queries";
import { formatWhen } from "../lib/time";
import { useFamily } from "../session";
import { mutate } from "../sync/outbox";
import { Notice, Spinner } from "./Layout";
import { StatusBadge } from "./StatusBadge";

/** Quantas doses anteriores aparecem antes de "Mostrar todas". */
const PAST_PAGE = 20;
/** Próximas doses mostradas (as demais seguem na agenda). */
const NEXT = 5;

/**
 * Todas as doses do tratamento: as próximas e as anteriores, cada uma com o
 * detalhe (registrar, corrigir) e, para administradores, a exclusão de uma
 * dose gerada ou registrada por engano (com motivo; nada é apagado).
 */
export function TreatmentDoses({ treatment }: { treatment: TreatmentView }) {
  const family = useFamily();
  const query = queries.treatmentDoses(family.id, treatment.id);
  const doses = useCached(query.key, query.fetch);
  const [showAll, setShowAll] = useState(false);
  const [excluding, setExcluding] = useState<OccurrenceView | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admin = family.myRole === "ADMIN";
  // Registros desta tela ou de Hoje ainda na fila: aparecem como "Aguardando envio".
  const outbox = useOutbox(family.id);
  const queued = new Set(outbox.filter((i) => i.state === "pending").map((i) => i.occurrenceId ?? i.entityId).filter(Boolean));

  const now = Date.now();
  const all = doses.data ?? [];
  const upcoming = all.filter((o) => new Date(o.scheduledAt).getTime() >= now && o.status !== "CANCELLED").slice(0, NEXT);
  const past = all.filter((o) => new Date(o.scheduledAt).getTime() < now).reverse();
  const shownPast = showAll ? past : past.slice(0, PAST_PAGE);
  const canExclude = (o: OccurrenceView) => admin && o.status !== "CANCELLED" && o.status !== "REVIEW_REQUIRED";

  async function exclude(o: OccurrenceView) {
    setBusy(true);
    setError(null);
    const change = { status: "CANCELLED" as const, statusReason: reason.trim(), administration: null, version: o.version + 1 };
    try {
      await mutate({
        familyId: family.id, method: "POST", path: `/families/${family.id}/occurrences/${o.id}/exclusion`,
        body: { baseVersion: o.version, reason: reason.trim() },
        label: `Excluir dose de ${treatment.name} (${formatWhen(o.scheduledAt)})`, entityId: o.id,
        effects: [
          { key: query.key, op: "merge", id: o.id, value: change },
          { key: `agenda:${family.id}:`, prefix: true, op: "merge", id: o.id, value: change },
          { key: `dose:${o.id}`, op: "merge", value: { occurrence: { ...o, ...change } } },
        ],
      });
      setExcluding(null);
      setReason("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const row = (o: OccurrenceView) => (
    <li key={o.id} className="dose-row treatment-dose">
      <Link to={`/doses/${o.id}`} state={{ occurrence: o }} className="item">
        <span className="item-main">
          <strong>{formatWhen(o.scheduledAt)}</strong>
          {o.administration && (
            <span className="muted small">
              Dada {formatWhen(o.administration.administeredAt)}
              {o.administration.recordedBy?.displayName ? ` · ${o.administration.recordedBy.displayName}` : ""}
            </span>
          )}
          {o.status === "CANCELLED" && o.statusReason && <span className="muted small">{o.statusReason}</span>}
          <span className="row wrap">
            <StatusBadge status={o.status} late={o.late} queued={queued.has(o.id) || isPending(o)} />
          </span>
        </span>
      </Link>
      {canExclude(o) && (
        <button type="button" className="btn btn-small btn-danger" aria-label={`Excluir a dose de ${formatWhen(o.scheduledAt)}`}
          disabled={busy} onClick={() => { setExcluding(o); setReason(""); setError(null); }}>Excluir</button>
      )}
    </li>
  );

  return (
    <section className="card stack" aria-label="Doses do tratamento">
      <h2>Doses</h2>
      {!doses.fresh && <p className="muted small">Sem conexão: doses guardadas neste aparelho.</p>}
      {doses.loading && !doses.data && <Spinner />}
      {doses.error && !doses.data && <Notice tone="error">{doses.error}</Notice>}
      {doses.data && all.length === 0 && <p className="empty">Nenhuma dose gerada ainda.</p>}

      {excluding && (
        <div className="stack" role="dialog" aria-label="Excluir dose">
          <p>
            Excluir a dose de <strong>{formatWhen(excluding.scheduledAt)}</strong>? Use para uma dose gerada ou registrada
            por engano: ela deixa de aparecer e de contar no andamento
            {excluding.administration ? ", e o registro de administração é invalidado" : ""}. Nada é apagado: fica na
            auditoria, com o motivo.
            {treatment.doseCount ? " Neste tratamento por número de doses, a agenda segue até completar o total da receita." : ""}
          </p>
          {error && <Notice tone="error">{error}</Notice>}
          <label>
            Motivo
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} required
              placeholder="Ex.: dose gerada no horário errado" />
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn-primary" disabled={busy || !reason.trim()} onClick={() => void exclude(excluding)}>
              Excluir dose
            </button>
            <button type="button" className="btn" onClick={() => setExcluding(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <>
          <h3 className="group-title">Próximas</h3>
          <ul className="cards">{upcoming.map(row)}</ul>
        </>
      )}
      {past.length > 0 && (
        <>
          <h3 className="group-title">Anteriores</h3>
          <ul className="cards">{shownPast.map(row)}</ul>
          {!showAll && past.length > PAST_PAGE && (
            <button type="button" className="btn" onClick={() => setShowAll(true)}>Mostrar todas ({past.length})</button>
          )}
        </>
      )}
    </section>
  );
}
