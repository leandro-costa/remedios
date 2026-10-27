import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, errorMessage } from "../api/client";
import type { PastDoses, RevisionView, TreatmentStatus, TreatmentView } from "../api/types";
import { Notice, Spinner } from "../components/Layout";
import { useCached } from "../hooks/useCached";
import { TREATMENT_KIND, TREATMENT_STATUS } from "../lib/labels";
import { isPending } from "../db/cache";
import { describeSchedule, slotsBetween } from "../lib/schedule";
import { formatDate, formatWhen } from "../lib/time";
import { mutate } from "../sync/outbox";
import { useFamily, useSession } from "../session";

/** O servidor aceita ativar com início até 30 dias no passado. */
const MAX_BACKDATE_MS = 30 * 86_400_000 - 5 * 60_000;

/** Ao ativar um rascunho que começou no passado (pergunta obrigatória, sem resposta presumida). */
type PastChoice = "ADMINISTERED" | "OPEN" | "SKIP";

interface Action {
  to: TreatmentStatus;
  label: string;
  confirm: string;
  primary?: boolean;
}

const ACTIONS: Record<TreatmentStatus, Action[]> = {
  DRAFT: [
    { to: "ACTIVE", label: "Ativar agenda", confirm: "Conferiu horários e instruções? As doses passam a aparecer em Hoje.", primary: true },
    { to: "ENDED", label: "Descartar rascunho", confirm: "Encerrar este rascunho?" },
  ],
  ACTIVE: [
    { to: "SUSPENDED", label: "Suspender", confirm: "Suspender? As doses futuras ainda não registradas serão canceladas." },
    { to: "ENDED", label: "Encerrar", confirm: "Encerrar o tratamento? As doses futuras ainda não registradas serão canceladas." },
  ],
  SUSPENDED: [
    { to: "ACTIVE", label: "Reativar", confirm: "Reativar a agenda a partir de agora?", primary: true },
    { to: "ENDED", label: "Encerrar", confirm: "Encerrar o tratamento?" },
  ],
  ENDED: [],
};

export function TreatmentDetailPage() {
  const { id } = useParams();
  const family = useFamily();
  const navigate = useNavigate();
  const treatment = useCached(`treatment:${id}`, () => api<TreatmentView>(`/families/${family.id}/treatments/${id}`));
  const revisions = useCached(`revisions:${id}`, () => api<RevisionView[]>(`/families/${family.id}/treatments/${id}/revisions`));
  const { deviceId } = useSession();
  const [pending, setPending] = useState<Action | null>(null);
  const [past, setPast] = useState<PastChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = treatment.data;
  if (!t) return treatment.loading ? <Spinner /> : <div className="page"><Notice tone="error">{treatment.error}</Notice></div>;

  // Rascunho que começa no passado: as doses anteriores a agora.
  const now = new Date();
  const activating = t.status === "DRAFT" && pending?.to === "ACTIVE";
  const pastFrom = new Date(Math.max(new Date(t.startAt).getTime(), now.getTime() - MAX_BACKDATE_MS));
  const startsInPast = new Date(t.startAt) < now;
  const pastSlots = startsInPast ? slotsBetween(t.schedule, new Date(t.startAt), pastFrom, now) : [];
  const askPast = activating && startsInPast && (pastSlots === null || pastSlots.length > 0);

  async function change(action: Action) {
    setBusy(true);
    setError(null);
    try {
      const fromStart = t!.status === "DRAFT" && action.to === "ACTIVE" && askPast && past !== "SKIP";
      const effectiveFrom = fromStart ? pastFrom : new Date();
      const pastDoses: PastDoses = fromStart && past === "ADMINISTERED" ? "ADMINISTERED" : "OPEN";
      await mutate({
        familyId: family.id, method: "POST", path: `/families/${family.id}/treatments/${t!.id}/status`,
        body: { status: action.to, baseVersion: t!.version, effectiveFrom: effectiveFrom.toISOString(), pastDoses, deviceId },
        // Fila offline: se o tratamento mudar antes do envio, vai para conferência.
        queuedBody: { preserveConflict: true },
        label: `${action.label}: ${t!.name}`,
        effects: [
          { key: `treatment:${t!.id}`, op: "merge", value: { status: action.to, version: t!.version + 1 } },
          { key: `treatments:${family.id}`, op: "merge", id: t!.id, value: { status: action.to, version: t!.version + 1 } },
        ],
      });
      setPending(null);
      setPast(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <button className="link back" onClick={() => navigate("/tratamentos")}>← Tratamentos</button>
      <div className="title-row">
        <h1>{t.name}</h1>
        <span className={`badge badge-t-${t.status.toLowerCase()}`}>{TREATMENT_STATUS[t.status]}</span>
      </div>
      {!treatment.fresh && <Notice tone="warn">Sem conexão: dados guardados neste aparelho. Alterações ficam guardadas e são enviadas quando a conexão voltar.</Notice>}
      {isPending(t) && <Notice tone="warn">Alteração aguardando envio. As doses aparecem depois que o servidor confirmar.</Notice>}
      {t.conflictId && (
        <Notice tone="warn">
          Há uma alteração feita sem conexão aguardando conferência. <Link to="/conflitos">Conferir →</Link>
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      <dl className="facts card">
        <dt>Dose (da prescrição)</dt><dd>{t.prescribedDose}</dd>
        {t.route && (<><dt>Via</dt><dd>{t.route}</dd></>)}
        {t.instructions && (<><dt>Instruções</dt><dd className="pre">{t.instructions}</dd></>)}
        <dt>Agenda</dt><dd>{describeSchedule(t.schedule)}</dd>
        <dt>Tipo</dt><dd>{TREATMENT_KIND[t.kind]}</dd>
        <dt>Período</dt><dd>{formatDate(t.startAt)} {t.endAt ? `até ${formatDate(t.endAt)}` : "· sem término"}</dd>
        <dt>Versão</dt><dd>{t.version}</dd>
      </dl>

      {!t.conflictId && t.status !== "ENDED" && (
        <div className="row wrap">
          <Link className="btn" to={`/tratamentos/${t.id}/editar`}>Editar</Link>
          {ACTIONS[t.status].map((a) => (
            <button key={a.to} className={`btn ${a.primary ? "btn-primary" : ""}`} onClick={() => setPending(a)}>{a.label}</button>
          ))}
        </div>
      )}

      {pending && (
        <section className="card stack" role="dialog" aria-label="Confirmar">
          <p>{pending.confirm}</p>
          {askPast && (
            <fieldset className="stack">
              <legend>
                Este tratamento começou em {formatDate(t.startAt)}.{" "}
                {pastSlots === null
                  ? "As doses previstas até agora já foram dadas?"
                  : `${pastSlots.length === 1 ? "A dose prevista" : `As ${pastSlots.length} doses previstas`} até agora já ${pastSlots.length === 1 ? "foi dada" : "foram dadas"}?`}
              </legend>
              {pastFrom.getTime() > new Date(t.startAt).getTime() && (
                <p className="muted small">Só entram as doses dos últimos 30 dias.</p>
              )}
              <label className="radio">
                <input type="radio" name="past" checked={past === "ADMINISTERED"} onChange={() => setPast("ADMINISTERED")} />
                {pastSlots?.length === 1
                  ? "Sim, foi dada no horário previsto (registrar como administrada)"
                  : "Sim, todas foram dadas nos horários previstos (registrar como administradas)"}
              </label>
              <label className="radio">
                <input type="radio" name="past" checked={past === "OPEN"} onChange={() => setPast("OPEN")} />
                Não sei ou nem todas: deixar para registrar uma a uma
              </label>
              <label className="radio">
                <input type="radio" name="past" checked={past === "SKIP"} onChange={() => setPast("SKIP")} />
                Ignorar as anteriores: a agenda começa agora
              </label>
            </fieldset>
          )}
          <div className="row">
            <button className="btn btn-primary" disabled={busy || (askPast && !past)} onClick={() => void change(pending)}>Confirmar</button>
            <button className="btn" onClick={() => { setPending(null); setPast(null); }}>Cancelar</button>
          </div>
        </section>
      )}

      {revisions.data && revisions.data.length > 0 && (
        <section className="card">
          <h2>Versões</h2>
          <ol className="trail">
            {[...revisions.data].reverse().map((r) => (
              <li key={r.version}>
                <strong>Versão {r.version}</strong>
                <span className="muted small"> · {formatWhen(r.createdAt)}</span>
                <div className="small">
                  {String(r.snapshot.prescribedDose)} · {TREATMENT_STATUS[r.snapshot.status as TreatmentStatus]}
                  {r.changeReason ? ` · ${r.changeReason}` : ""}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
