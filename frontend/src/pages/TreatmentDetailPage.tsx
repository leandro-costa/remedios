import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, errorMessage } from "../api/client";
import type { PastDoses, RevisionView, TreatmentProgressView, TreatmentStatus, TreatmentView } from "../api/types";
import { AsNeededCard } from "../components/AsNeeded";
import { Icon } from "../components/Icon";
import { ScreenBar } from "../components/ScreenBar";
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
  const progressList = useCached(`treatment-progress:${family.id}`, () =>
    api<TreatmentProgressView[]>(`/families/${family.id}/treatments/progress`));
  const revisions = useCached(`revisions:${id}`, () => api<RevisionView[]>(`/families/${family.id}/treatments/${id}/revisions`));
  const { deviceId } = useSession();
  const [pending, setPending] = useState<Action | null>(null);
  const [past, setPast] = useState<PastChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = treatment.data;
  const progress = progressList.data?.find((p) => p.treatmentId === t?.id && !isPending(t));
  if (!t) return treatment.loading ? <Spinner /> : <div className="page"><Notice tone="error">{treatment.error}</Notice></div>;

  // Rascunho que começa no passado: as doses anteriores a agora.
  const now = new Date();
  const activating = t.status === "DRAFT" && pending?.to === "ACTIVE";
  const pastFrom = new Date(Math.max(new Date(t.startAt).getTime(), now.getTime() - MAX_BACKDATE_MS));
  const startsInPast = new Date(t.startAt) < now;
  const pastSlots = startsInPast ? slotsBetween(t.schedule, new Date(t.startAt), pastFrom, now) : [];
  const asNeeded = t.kind === "AS_NEEDED";
  const askPast = !asNeeded && activating && startsInPast && (pastSlots === null || pastSlots.length > 0);
  // "Se necessário" não tem agenda: os textos falam do tratamento, não das doses previstas.
  const actions = ACTIONS[t.status].map((a) => !asNeeded ? a : {
    ...a,
    label: a.label === "Ativar agenda" ? "Ativar" : a.label,
    confirm: a.to === "ACTIVE" ? "Ativar? O tratamento passa a aparecer em Hoje para registrar as doses quando forem dadas."
      : a.to === "SUSPENDED" ? "Suspender? Não será possível registrar novas doses até reativar."
      : a.confirm.replace(" As doses futuras ainda não registradas serão canceladas.", ""),
  });

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
      <ScreenBar title={t.name} onBack={() => navigate("/tratamentos")} />
      <section className="dose-hero">
        <span className="dose-hero-icon"><Icon name="pill" size={44} /></span>
        <strong className="dose-hero-name">{t.name}</strong>
        <span className={`badge badge-t-${t.status.toLowerCase()}`}>{TREATMENT_STATUS[t.status]}</span>
      </section>
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
        <dt>Agenda</dt><dd>{asNeeded ? "Sem horários" : describeSchedule(t.schedule)}</dd>
        <dt>Tipo</dt><dd>{TREATMENT_KIND[t.kind]}</dd>
        <dt>{asNeeded ? "Início" : "Primeira dose"}</dt><dd>{formatWhen(t.startAt)}</dd>
        <dt>Término</dt>
        <dd>{t.doseCount ? `Após ${t.doseCount} ${t.doseCount === 1 ? "dose" : "doses"}` : t.endAt ? formatWhen(t.endAt) : "Sem término"}</dd>
        <dt>Versão</dt><dd>{t.version}</dd>
      </dl>

      {asNeeded && t.status !== "DRAFT" && <AsNeededCard treatment={t} />}
      {progress && !asNeeded && <Progress p={progress} />}

      {!t.conflictId && t.status !== "ENDED" && (
        <div className="row wrap">
          <Link className="btn" to={`/tratamentos/${t.id}/editar`}>Editar</Link>
          {actions.map((a) => (
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
                {t.doseCount
                  ? `A primeira dose ainda não foi dada: as ${t.doseCount} doses contam a partir de agora`
                  : "Ignorar as anteriores: a agenda começa agora"}
              </label>
            </fieldset>
          )}
          <div className="row">
            <button className="btn btn-primary" disabled={busy || (askPast && !past)} onClick={() => void change(pending)}>Confirmar</button>
            <button className="btn" onClick={() => { setPending(null); setPast(null); }}>Cancelar</button>
          </div>
        </section>
      )}

      {family.myRole === "ADMIN" && !t.conflictId && <DeleteTreatment treatment={t} />}

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

/** Andamento: dadas, não dadas, sem registro e a dar. Só conta; dose perdida não é reposta. */
function Progress({ p }: { p: TreatmentProgressView }) {
  const recorded = p.administered + p.notAdministered;
  return (
    <section className="card stack" aria-label="Andamento do tratamento">
      <div className="title-row">
        <h2>Andamento</h2>
        {p.total !== null && <span className="muted small">{recorded} de {p.total} registradas</span>}
      </div>
      <dl className="tally">
        <div><dt>Dadas</dt><dd>{p.administered}</dd></div>
        <div><dt>Não dadas</dt><dd>{p.notAdministered}</dd></div>
        <div><dt>Sem registro</dt><dd>{p.unrecorded}</dd></div>
        <div><dt>A dar</dt><dd>{p.upcoming ?? "—"}</dd></div>
      </dl>
      {p.review > 0 && <p className="small">{p.review} para conferir.</p>}
      {p.lastAt && <p className="muted small">Última dose prevista: {formatWhen(p.lastAt)}</p>}
      {p.notAdministered + p.unrecorded > 0 && (
        <p className="muted small">Doses não dadas não são repostas pelo app. Em caso de dúvida, fale com quem prescreveu.</p>
      )}
    </section>
  );
}

/**
 * Exclusão de um tratamento cadastrado por engano (só administradores, em
 * qualquer situação). Some das telas e contagens; fica guardado na auditoria.
 */
function DeleteTreatment({ treatment: t }: { treatment: TreatmentView }) {
  const family = useFamily();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await mutate({
        familyId: family.id, method: "POST", path: `/families/${family.id}/treatments/${t.id}/deletion`,
        body: { baseVersion: t.version, reason: reason.trim() },
        label: `Excluir tratamento: ${t.name}`,
        entityId: t.id,
        effects: [{ key: `treatments:${family.id}`, op: "remove", id: t.id }],
      });
      navigate("/tratamentos", { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="row">
        <button className="btn" onClick={() => setOpen(true)}>Excluir (cadastrado por engano)</button>
      </div>
    );
  }
  return (
    <section className="card stack" role="dialog" aria-label="Excluir tratamento">
      <h2>Excluir tratamento</h2>
      <p>
        Use só para um tratamento cadastrado por engano. Ele e as doses registradas deixam de aparecer em Hoje, no
        Histórico, nas listas e nas contagens. Nada é apagado: fica guardado na auditoria e na exportação da família.
      </p>
      <p className="muted small">Para um tratamento que terminou de verdade, use "Encerrar": o histórico continua visível.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <label>
        Motivo
        <input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={1000}
          placeholder="Ex.: cadastrado na pessoa errada" />
      </label>
      <div className="row">
        <button className="btn btn-primary" disabled={busy || !reason.trim()} onClick={() => void remove()}>Excluir tratamento</button>
        <button className="btn" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </section>
  );
}
