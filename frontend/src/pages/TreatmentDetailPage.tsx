import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, errorMessage } from "../api/client";
import type { RevisionView, TreatmentStatus, TreatmentView } from "../api/types";
import { Notice, Spinner } from "../components/Layout";
import { useCached } from "../hooks/useCached";
import { useOnline } from "../hooks/useOnline";
import { TREATMENT_KIND, TREATMENT_STATUS } from "../lib/labels";
import { describeSchedule } from "../lib/schedule";
import { formatDate, formatWhen, startOfDay } from "../lib/time";
import { useFamily } from "../session";

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
  const online = useOnline();
  const navigate = useNavigate();
  const treatment = useCached(`treatment:${id}`, () => api<TreatmentView>(`/families/${family.id}/treatments/${id}`));
  const revisions = useCached(`revisions:${id}`, () => api<RevisionView[]>(`/families/${family.id}/treatments/${id}/revisions`));
  const [pending, setPending] = useState<Action | null>(null);
  const [includeToday, setIncludeToday] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = treatment.data;
  if (!t) return treatment.loading ? <Spinner /> : <div className="page"><Notice tone="error">{treatment.error}</Notice></div>;

  async function change(action: Action) {
    setBusy(true);
    setError(null);
    try {
      // Ao ativar um rascunho, as doses de hoje anteriores ao cadastro também entram (até 24 h).
      const effectiveFrom = t!.status === "DRAFT" && action.to === "ACTIVE" && includeToday
        ? new Date(Math.max(startOfDay(new Date()).getTime(), new Date(t!.startAt).getTime(), Date.now() - 23 * 3600_000))
        : new Date();
      await api(`/families/${family.id}/treatments/${t!.id}/status`, {
        method: "POST",
        body: { status: action.to, baseVersion: t!.version, effectiveFrom: effectiveFrom.toISOString() },
      });
      setPending(null);
      await Promise.all([treatment.reload(), revisions.reload()]);
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
      {!treatment.fresh && <Notice tone="warn">Sem conexão: dados guardados neste aparelho.</Notice>}
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

      {online && t.status !== "ENDED" && (
        <div className="row wrap">
          <Link className="btn" to={`/tratamentos/${t.id}/editar`}>Editar</Link>
          {ACTIONS[t.status].map((a) => (
            <button key={a.to} className={`btn ${a.primary ? "btn-primary" : ""}`} onClick={() => setPending(a)}>{a.label}</button>
          ))}
        </div>
      )}
      {!online && t.status !== "ENDED" && <p className="muted small">Alterar o tratamento precisa de conexão.</p>}

      {pending && (
        <section className="card stack" role="dialog" aria-label="Confirmar">
          <p>{pending.confirm}</p>
          {t.status === "DRAFT" && pending.to === "ACTIVE" && (
            <label className="radio">
              <input type="checkbox" checked={includeToday} onChange={(e) => setIncludeToday(e.target.checked)} />
              Incluir as doses de hoje que já passaram (para registrar o que já foi dado)
            </label>
          )}
          <div className="row">
            <button className="btn btn-primary" disabled={busy} onClick={() => void change(pending)}>Confirmar</button>
            <button className="btn" onClick={() => setPending(null)}>Cancelar</button>
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
