import { useState } from "react";
import { Link } from "react-router";
import { errorMessage } from "../api/client";
import type { OccurrenceView, TreatmentView } from "../api/types";
import { doseLabel } from "../lib/labels";
import { isPending } from "../db/cache";
import { useCached } from "../hooks/useCached";
import { queries } from "../lib/queries";
import { formatAgo, formatWhen, fromLocalInput, toLocalInput } from "../lib/time";
import { mutate } from "../sync/outbox";
import { useFamily, useSession } from "../session";
import { Icon } from "./Icon";
import { Notice } from "./Layout";

const DAY_MS = 86_400_000;

/** Chave das doses consolidadas por pessoa e medicamento (ver queries.asNeeded). */
export const asNeededKey = (t: Pick<TreatmentView, "id" | "personId" | "medicationId">) => queries.asNeeded("", t).key;

/** Doses registradas, da mais recente para a mais antiga. */
export function useAsNeededDoses(t: TreatmentView) {
  const family = useFamily();
  const query = queries.asNeeded(family.id, t);
  return useCached(query.key, query.fetch);
}

/** Última dose dada e quantas nas últimas 24 h. Só conta; não diz quando dar a próxima. */
export function summarize(doses: OccurrenceView[] | undefined, now = Date.now()) {
  const given = (doses ?? []).filter((o) => o.status === "ADMINISTERED")
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  const last24h = given.filter((o) => now - new Date(o.scheduledAt).getTime() < DAY_MS).length;
  return { given, last: given[0] ?? null, last24h };
}

export function countLabel(n: number) {
  return n === 1 ? "1 dose nas últimas 24 h" : `${n} doses nas últimas 24 h`;
}

/**
 * Cartão de um tratamento "se necessário": a última dose, a contagem de 24 h
 * e o registro de uma dose. O app nunca diz quando a próxima pode ser dada:
 * mostra a orientação da receita e quem decide é o responsável (seção 1).
 */
export function AsNeededCard({ treatment, personName, compact = false }: {
  treatment: TreatmentView; personName?: string; compact?: boolean;
}) {
  const family = useFamily();
  const { me, deviceId } = useSession();
  const doses = useAsNeededDoses(treatment);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(true);
  const [at, setAt] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { given, last, last24h } = summarize(doses.data);
  const canRecord = treatment.status === "ACTIVE" && Boolean(deviceId);

  function start() {
    setOpen(true);
    setNow(true);
    setAt(toLocalInput(new Date()));
    setNotes("");
    setError(null);
  }

  async function record() {
    if (!deviceId) return;
    const administeredAt = now ? new Date().toISOString() : fromLocalInput(at);
    if (new Date(administeredAt).getTime() > Date.now() + 60_000) return setError("O horário não pode estar no futuro.");
    setBusy(true);
    setError(null);
    const id = crypto.randomUUID();
    const recordedAt = new Date().toISOString();
    const local: OccurrenceView = {
      id, scheduledAt: administeredAt, status: "ADMINISTERED", late: false, version: 1,
      person: { id: treatment.personId, displayName: personName ?? "" },
      treatment: {
        id: treatment.id, name: treatment.name, prescribedDose: treatment.prescribedDose, route: treatment.route, kind: "AS_NEEDED",
        medicationId: treatment.medicationId ?? null, medicationName: treatment.name,
      },
      administration: {
        id, administeredAt, recordedAt, receivedAt: recordedAt, deviceId,
        recordedBy: me ? { id: me.id, displayName: me.displayName } : null, notes: notes.trim() || null,
        voidedAt: null, voidedBy: null, voidReason: null,
      },
      statusReason: null, statusChangedBy: me ? { id: me.id, displayName: me.displayName } : null,
      statusChangedAt: recordedAt, claimedBy: null, claimedUntil: null,
    };
    try {
      await mutate({
        familyId: family.id, method: "POST", path: `/families/${family.id}/treatments/${treatment.id}/doses`,
        body: { id, deviceId, administeredAt, notes: notes.trim() || null, recordedAt },
        label: `Dose de ${treatment.name}`,
        entityId: id,
        effects: [{ key: asNeededKey(treatment), op: "upsert", value: { ...local }, list: true }],
      });
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack as-needed" aria-label={`Se necessário: ${treatment.name}`}>
      <div className="title-row">
        <span className="tile"><Icon name="pill" /></span>
        <span className="dose-main">
          <strong>{treatment.name}</strong>
          <span className="muted small">{personName ? `${personName} · ` : ""}{treatment.prescribedDose} · se necessário</span>
        </span>
      </div>
      {treatment.instructions && <p className="small pre">Na receita: {treatment.instructions}</p>}
      <p data-testid="as-needed-last">
        {last
          ? <>Última dose: <strong>{formatWhen(last.scheduledAt)}</strong> ({formatAgo(new Date(last.scheduledAt).getTime())})
            {last.administration?.recordedBy?.displayName ? `, por ${last.administration.recordedBy.displayName}` : ""}
            {isPending(last) && <span className="badge badge-queued"> Aguardando envio</span>}</>
          : doses.loading ? "Carregando…" : "Nenhuma dose registrada."}
      </p>
      <p className="small" data-testid="as-needed-count"><strong>{countLabel(last24h)}</strong></p>
      {!doses.fresh && <p className="muted small">Sem conexão: contagem com os dados guardados neste aparelho.</p>}
      {error && <Notice tone="error">{error}</Notice>}

      {open ? (
        <div className="stack" role="group" aria-label="Registrar dose">
          <label className="radio">
            <input type="radio" name={`when-${treatment.id}`} checked={now} onChange={() => setNow(true)} /> Dada agora
          </label>
          <label className="radio">
            <input type="radio" name={`when-${treatment.id}`} checked={!now} onChange={() => setNow(false)} /> Dada em outro horário
          </label>
          {!now && (
            <label>
              Horário em que foi dada
              <input type="datetime-local" value={at} max={toLocalInput(new Date())} onChange={(e) => setAt(e.target.value)} required />
            </label>
          )}
          <label>
            Observação <span className="muted small">(opcional)</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="Ex.: febre de 38,4 °C" />
          </label>
          <p className="muted small">Dose: {treatment.prescribedDose}, como na receita. Confira antes de dar.</p>
          <div className="row">
            <button className="btn btn-primary" disabled={busy || (!now && !at)} onClick={() => void record()}>Confirmar dose</button>
            <button className="btn" onClick={() => setOpen(false)}>Cancelar</button>
          </div>
        </div>
      ) : canRecord && (
        <button className="btn btn-primary" onClick={start}><Icon name="check" />Registrar dose</button>
      )}

      {!compact && given.length > 0 && (
        <>
          <h3 className="small">Doses registradas deste medicamento</h3>
          <ul className="doses">
            {given.slice(0, 10).map((o) => (
              <li key={o.id} className="dose-row">
                <Link to={`/doses/${o.id}`} state={{ occurrence: o }} className="dose">
                  <span className="dose-main">
                    <strong>{formatWhen(o.scheduledAt)}</strong>
                    <span className="muted small">
                      {[o.treatment.id !== treatment.id ? doseLabel(o) : null, o.administration?.recordedBy?.displayName,
                        o.administration?.notes].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {isPending(o) && <span className="dose-side"><span className="badge badge-queued">Aguardando envio</span></span>}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
