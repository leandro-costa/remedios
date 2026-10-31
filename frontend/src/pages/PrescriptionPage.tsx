import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, errorMessage } from "../api/client";
import type { PersonView, TreatmentStatus, TreatmentView } from "../api/types";
import { Icon } from "../components/Icon";
import { Notice, Spinner } from "../components/Layout";
import { ScreenBar } from "../components/ScreenBar";
import { isPending } from "../db/cache";
import { useCached } from "../hooks/useCached";
import { TREATMENT_STATUS } from "../lib/labels";
import { prescriptionStatus, prescriptionTitle, PRESCRIPTION_STATUS, prescriptionsKey, usePrescriptions } from "../lib/prescriptions";
import { describeSchedule } from "../lib/schedule";
import { formatDate } from "../lib/time";
import { mutate } from "../sync/outbox";
import { useFamily } from "../session";

interface Action {
  to: TreatmentStatus;
  label: string;
  confirm: string;
}

/** Receita: dados, itens e ações que valem para todos os itens de uma vez. */
export function PrescriptionPage() {
  const { id } = useParams();
  const family = useFamily();
  const navigate = useNavigate();
  const prescriptions = usePrescriptions();
  const treatments = useCached(`treatments:${family.id}`, () => api<TreatmentView[]>(`/families/${family.id}/treatments`));
  const persons = useCached(`persons-all:${family.id}`, () => api<PersonView[]>(`/families/${family.id}/persons`));
  const [pending, setPending] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const p = prescriptions.data?.find((x) => x.id === id);
  if (!p) return prescriptions.loading ? <Spinner /> : <div className="page"><Notice tone="error">Receita não encontrada.</Notice></div>;
  const items = (treatments.data ?? []).filter((t) => t.prescriptionId === p.id);
  const status = prescriptionStatus(items);
  const person = persons.data?.find((x) => x.id === p.personId);
  const actions: Action[] = [
    ...(items.some((i) => i.status === "ACTIVE") ? [{ to: "SUSPENDED" as const, label: "Suspender receita", confirm: "Suspender todos os itens ativos? As doses futuras ainda não registradas serão canceladas." }] : []),
    ...(items.some((i) => i.status === "SUSPENDED") ? [{ to: "ACTIVE" as const, label: "Reativar receita", confirm: "Reativar os itens suspensos a partir de agora?" }] : []),
    ...(status !== "ENDED" && items.length > 0 ? [{ to: "ENDED" as const, label: "Encerrar receita", confirm: "Encerrar todos os itens, inclusive os \"se necessário\"? As doses futuras ainda não registradas serão canceladas." }] : []),
  ];

  async function change(action: Action) {
    setBusy(true);
    setError(null);
    const from: TreatmentStatus[] = action.to === "SUSPENDED" ? ["ACTIVE"] : action.to === "ACTIVE" ? ["SUSPENDED"] : ["DRAFT", "ACTIVE", "SUSPENDED"];
    try {
      await mutate({
        familyId: family.id, method: "POST", path: `/families/${family.id}/prescriptions/${p!.id}/status`,
        body: { status: action.to, reason: reason.trim() || null },
        label: `${action.label}: ${prescriptionTitle(p, items)}`, entityId: p!.id,
        effects: items.filter((i) => from.includes(i.status)).flatMap((i) => [
          { key: `treatments:${family.id}`, op: "merge" as const, id: i.id, value: { status: action.to, version: i.version + 1 } },
          { key: `treatment:${i.id}`, op: "merge" as const, value: { status: action.to, version: i.version + 1 } },
        ]),
      });
      setPending(null);
      setReason("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await mutate({
        familyId: family.id, method: "POST", path: `/families/${family.id}/prescriptions/${p!.id}/deletion`,
        body: { reason: reason.trim() }, label: `Excluir receita: ${prescriptionTitle(p, items)}`, entityId: p!.id,
        effects: [
          { key: prescriptionsKey(family.id), op: "remove", id: p!.id },
          ...items.map((i) => ({ key: `treatments:${family.id}`, op: "remove" as const, id: i.id })),
        ],
      });
      navigate("/tratamentos", { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <ScreenBar title="Receita" onBack={() => navigate("/tratamentos")} />
      <section className="dose-hero">
        <span className="dose-hero-icon"><Icon name="pill" size={44} /></span>
        <strong className="dose-hero-name">{prescriptionTitle(p, items)}</strong>
        <span className={`badge badge-t-${status.toLowerCase()}`}>{PRESCRIPTION_STATUS[status]}</span>
      </section>
      {!prescriptions.fresh && <Notice tone="warn">Sem conexão: dados guardados neste aparelho.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <dl className="facts card">
        <dt>Pessoa</dt><dd>{person?.displayName ?? "—"}</dd>
        {p.prescriber && (<><dt>Quem prescreveu</dt><dd>{p.prescriber}</dd></>)}
        {p.prescribedOn && (<><dt>Data da receita</dt><dd>{formatDate(p.prescribedOn + "T12:00:00")}</dd></>)}
        {p.notes && (<><dt>Observações</dt><dd className="pre">{p.notes}</dd></>)}
      </dl>
      <p className="muted small">
        A receita termina quando acabam os itens com horário; os itens "se necessário" terminam junto.
      </p>

      <section className="stack" aria-label="Itens da receita">
        <h2>Itens</h2>
        {items.length === 0 && <p className="empty">Nenhum remédio nesta receita.</p>}
        <ul className="cards">
          {items.map((t) => (
            <li key={t.id}>
              <Link to={`/tratamentos/${t.id}`} className="item">
                <span className="tile"><Icon name="pill" /></span>
                <span className="item-main">
                  <strong className="item-title">{t.name}</strong>
                  <span className="muted small">{t.prescribedDose} · {t.kind === "AS_NEEDED" ? "se necessário" : describeSchedule(t.schedule)}</span>
                  <span className="row wrap">
                    <span className={`badge badge-t-${t.status.toLowerCase()}`}>{TREATMENT_STATUS[t.status]}</span>
                    {isPending(t) && <span className="badge badge-queued"><Icon name="sync" />Aguardando envio</span>}
                  </span>
                </span>
                <span className="item-chevron"><Icon name="chevron" /></span>
              </Link>
            </li>
          ))}
        </ul>
        {status !== "ENDED" && (
          <Link className="btn btn-primary" to={`/tratamentos/novo?receita=${p.id}`}>+ Adicionar remédio</Link>
        )}
      </section>

      <div className="row wrap">
        <Link className="btn" to={`/receitas/${p.id}/editar`}>Editar dados</Link>
        {actions.map((a) => (
          <button key={a.to} className="btn" disabled={busy} onClick={() => { setPending(a); setDeleting(false); }}>{a.label}</button>
        ))}
        {family.myRole === "ADMIN" && (
          <button className="btn" disabled={busy} onClick={() => { setDeleting(true); setPending(null); }}>Excluir (cadastrada por engano)</button>
        )}
      </div>
      {(pending || deleting) && (
        <section className="card stack" role="dialog" aria-label="Confirmar">
          <p>{pending ? pending.confirm : "Use só para uma receita cadastrada por engano: ela e os itens deixam de aparecer. Nada é apagado; fica guardado na auditoria."}</p>
          <label>
            Motivo {pending && <span className="muted small">(opcional)</span>}
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} required={deleting} />
          </label>
          <div className="row">
            <button className="btn btn-primary" disabled={busy || (deleting && !reason.trim())}
              onClick={() => void (pending ? change(pending) : remove())}>{pending ? "Confirmar" : "Excluir receita"}</button>
            <button className="btn" onClick={() => { setPending(null); setDeleting(false); }}>Cancelar</button>
          </div>
        </section>
      )}
    </div>
  );
}
