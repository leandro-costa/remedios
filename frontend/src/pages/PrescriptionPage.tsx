import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, errorMessage } from "../api/client";
import type { PersonView, PrescriptionView, TreatmentStatus, TreatmentView } from "../api/types";
import { Icon } from "../components/Icon";
import { Notice, Spinner } from "../components/Layout";
import { ScreenBar } from "../components/ScreenBar";
import { isPending } from "../db/cache";
import { useCached } from "../hooks/useCached";
import { TREATMENT_STATUS } from "../lib/labels";
import { dismiss, keepInEventual, undecided } from "../lib/eventual";
import {
  EVENTUAL_TITLE, hiddenEventual, prescriptionStatus, prescriptionTitle, PRESCRIPTION_STATUS, prescriptionsKey, usePrescriptions,
} from "../lib/prescriptions";
import { describeSchedule } from "../lib/schedule";
import { formatDate } from "../lib/time";
import { mutate } from "../sync/outbox";
import { useFamily, useSession } from "../session";

interface Action {
  to: TreatmentStatus;
  label: string;
  confirm: string;
}

/** Receita: dados, itens e ações que valem para todos os itens de uma vez. */
export function PrescriptionPage() {
  const { id } = useParams();
  const family = useFamily();
  const { deviceId } = useSession();
  const navigate = useNavigate();
  const prescriptions = usePrescriptions();
  const treatments = useCached(`treatments:${family.id}`, () => api<TreatmentView[]>(`/families/${family.id}/treatments`));
  const persons = useCached(`persons-all:${family.id}`, () => api<PersonView[]>(`/families/${family.id}/persons`));
  const [pending, setPending] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Itens "se necessário" a manter no uso eventual ao encerrar (marcados por padrão).
  const [keep, setKeep] = useState<Set<string> | null>(null);
  const [, setDecided] = useState(0);

  const eventualOf = persons.data?.find((x) => x.id === id);
  // O uso eventual tem o id da pessoa e é criado no primeiro item: antes disso, existe só aqui.
  const p: PrescriptionView | undefined = prescriptions.data?.find((x) => x.id === id)
    ?? (eventualOf ? {
      id: eventualOf.id, personId: eventualOf.id, kind: "EVENTUAL", title: null, prescriber: null, prescribedOn: null, notes: null,
      status: "DRAFT", items: [], createdAt: "", updatedAt: "",
    } : undefined);
  if (!p) return prescriptions.loading || persons.loading ? <Spinner /> : <div className="page"><Notice tone="error">Receita não encontrada.</Notice></div>;
  const person = persons.data?.find((x) => x.id === p.personId);
  const all = treatments.data ?? [];
  const items = all.filter((t) => t.prescriptionId === p.id);
  const eventual = p.kind === "EVENTUAL" || p.id === p.personId;
  const status = prescriptionStatus(items);
  const title = eventual ? EVENTUAL_TITLE : prescriptionTitle(p, items);
  const hidden = hiddenEventual(all);
  const toDecide = eventual ? [] : undecided(items, all);
  const actions: Action[] = eventual ? [] : [
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
        label: `${action.label}: ${title}`, entityId: p!.id,
        effects: items.filter((i) => from.includes(i.status)).flatMap((i) => [
          { key: `treatments:${family.id}`, op: "merge" as const, id: i.id, value: { status: action.to, version: i.version + 1 } },
          { key: `treatment:${i.id}`, op: "merge" as const, value: { status: action.to, version: i.version + 1 } },
        ]),
      });
      if (action.to === "ENDED") await decideOnEnd();
      setPending(null);
      setReason("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /** Depois de encerrar: os marcados vão para o uso eventual; os outros não perguntam mais. */
  async function decideOnEnd() {
    for (const t of toDecide) {
      if (keep === null || keep.has(t.id)) await keepInEventual(family.id, t, deviceId);
      else dismiss(t.id);
    }
    setKeep(null);
  }

  async function keepOne(t: TreatmentView) {
    setBusy(true);
    setError(null);
    try {
      await keepInEventual(family.id, t, deviceId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function dismissOne(t: TreatmentView) {
    dismiss(t.id);
    setDecided((n) => n + 1);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await mutate({
        familyId: family.id, method: "POST", path: `/families/${family.id}/prescriptions/${p!.id}/deletion`,
        body: { reason: reason.trim() }, label: `Excluir receita: ${title}`, entityId: p!.id,
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
        <strong className="dose-hero-name">{title}</strong>
        {!eventual && <span className={`badge badge-t-${status.toLowerCase()}`}>{PRESCRIPTION_STATUS[status]}</span>}
      </section>
      {!prescriptions.fresh && <Notice tone="warn">Sem conexão: dados guardados neste aparelho.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <dl className="facts card">
        <dt>Pessoa</dt><dd>{person?.displayName ?? "—"}</dd>
        {p.prescriber && (<><dt>Quem prescreveu</dt><dd>{p.prescriber}</dd></>)}
        {p.prescribedOn && (<><dt>Data da receita</dt><dd>{formatDate(p.prescribedOn + "T12:00:00")}</dd></>)}
        {p.notes && (<><dt>Observações</dt><dd className="pre">{p.notes}</dd></>)}
      </dl>
      {eventual ? (
        <p className="muted small">
          Remédios "se necessário" que a pessoa pode tomar a qualquer momento, sem receita em andamento (ex.: paracetamol se febre).
          Quando uma receita ativa tem o mesmo medicamento, o item daqui fica oculto e vale o da receita.
        </p>
      ) : (
        <p className="muted small">
          A receita termina quando acabam os itens com horário; os itens "se necessário" terminam junto.
        </p>
      )}
      {!eventual && status === "ENDED" && toDecide.length > 0 && (
        <section className="card stack" aria-label="Manter no uso eventual">
          <p>A receita terminou. Manter no uso eventual de {person?.displayName ?? "a pessoa"}, para registrar quando precisar?</p>
          <ul className="stack">
            {toDecide.map((t) => (
              <li key={t.id} className="row wrap">
                <span className="item-main"><strong>{t.name}</strong> <span className="muted small">{t.prescribedDose} · se necessário</span></span>
                <button className="btn btn-small btn-primary" disabled={busy} aria-label={`Manter ${t.name} no uso eventual`} onClick={() => void keepOne(t)}>Manter</button>
                <button className="btn btn-small" disabled={busy} aria-label={`Não manter ${t.name}`} onClick={() => dismissOne(t)}>Não manter</button>
              </li>
            ))}
          </ul>
        </section>
      )}

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
                  {hidden.has(t.id) && <span className="muted small">Oculto enquanto a receita com {hidden.get(t.id)!.name} estiver ativa</span>}
                </span>
                <span className="item-chevron"><Icon name="chevron" /></span>
              </Link>
            </li>
          ))}
        </ul>
        {(eventual || status !== "ENDED") && (
          <Link className="btn btn-primary" to={`/tratamentos/novo?receita=${p.id}`}>+ Adicionar remédio</Link>
        )}
      </section>

      <div className="row wrap">
        {!eventual && <Link className="btn" to={`/receitas/${p.id}/editar`}>Editar dados</Link>}
        {actions.map((a) => (
          <button key={a.to} className="btn" disabled={busy} onClick={() => { setPending(a); setDeleting(false); }}>{a.label}</button>
        ))}
        {!eventual && family.myRole === "ADMIN" && (
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
          {pending?.to === "ENDED" && toDecide.length > 0 && (
            <fieldset className="stack">
              <legend>Manter no uso eventual de {person?.displayName ?? "a pessoa"}?</legend>
              {toDecide.map((t) => (
                <label key={t.id} className="radio">
                  <input type="checkbox" checked={keep === null || keep.has(t.id)} onChange={(e) => {
                    const next = new Set(keep ?? toDecide.map((x) => x.id));
                    if (e.target.checked) next.add(t.id); else next.delete(t.id);
                    setKeep(next);
                  }} /> {t.name} ({t.prescribedDose})
                </label>
              ))}
            </fieldset>
          )}
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
