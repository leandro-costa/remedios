import { useState } from "react";
import { Link } from "react-router";
import { api, errorMessage } from "../api/client";
import type { MemberView, OccurrenceDetail, TreatmentConflictView, TreatmentProposal, TreatmentView } from "../api/types";
import { ScreenBar } from "../components/ScreenBar";
import { Notice, Spinner } from "../components/Layout";
import { useCached } from "../hooks/useCached";
import { TREATMENT_STATUS } from "../lib/labels";
import { describeSchedule } from "../lib/schedule";
import { formatDate, formatWhen } from "../lib/time";
import { useFamily } from "../session";
import { mutate } from "../sync/outbox";

/** Doses com registros divergentes e alterações de tratamento aguardando conferência (seções 7.6 e 10.2). */
export function ConflictsPage() {
  const family = useFamily();
  const conflicts = useCached(`conflicts:${family.id}`, () => api<OccurrenceDetail[]>(`/families/${family.id}/conflicts`));
  const treatments = useCached(`treatment-conflicts:${family.id}`, () =>
    api<TreatmentConflictView[]>(`/families/${family.id}/treatments/conflicts`));
  const members = useCached(`members:${family.id}`, () => api<MemberView[]>(`/families/${family.id}/members`));
  const name = (userId: string) => members.data?.find((m) => m.userId === userId)?.displayName ?? "Outro responsável";
  const empty = conflicts.data?.length === 0 && treatments.data?.length === 0;
  return (
    <div className="page">
      <ScreenBar title="Para conferir" />
      <p className="muted">Registros e alterações feitos em aparelhos diferentes que não combinam. Nenhum foi aplicado automaticamente.</p>
      {conflicts.loading && !conflicts.data && <Spinner />}
      {conflicts.error && !conflicts.data && <Notice tone="error">{conflicts.error}</Notice>}
      {empty && <p className="empty">Nada para conferir.</p>}
      <ul className="cards">
        {(conflicts.data ?? []).map(({ occurrence, conflict }) => (
          <li key={occurrence.id}>
            <Link to={`/doses/${occurrence.id}`} className="card card-link">
              <strong>{occurrence.person.displayName} · {occurrence.treatment.name}</strong>
              <span className="muted small">Previsto {formatWhen(occurrence.scheduledAt)}</span>
              <span className="small">
                {conflict?.proposals.map((p) => p.recordedBy?.displayName).join(", ")} registrou sem ver o registro anterior
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {(treatments.data ?? []).map((c) => <TreatmentConflict key={c.id} conflict={c} name={name} />)}
    </div>
  );
}

/** O que a proposta muda em relação à versão atual, em palavras. */
function changes(current: TreatmentView, p: TreatmentProposal): string[] {
  const d = p.data;
  if (p.action === "STATUS") {
    return [`Situação: ${TREATMENT_STATUS[current.status]} → ${TREATMENT_STATUS[d.status as TreatmentView["status"]]}`];
  }
  const list: string[] = [];
  const diff = (label: string, before: unknown, after: unknown) => {
    if ((before ?? "") !== (after ?? "")) list.push(`${label}: ${before || "—"} → ${after || "—"}`);
  };
  diff("Medicamento", current.name, d.name);
  diff("Dose", current.prescribedDose, d.prescribedDose);
  diff("Via", current.route, d.route);
  diff("Instruções", current.instructions, d.instructions);
  diff("Início", formatDate(current.startAt), d.startAt ? formatDate(String(d.startAt)) : "");
  diff("Término", current.endAt ? formatDate(current.endAt) : "", d.endAt ? formatDate(String(d.endAt)) : "");
  diff("Agenda", describeSchedule(current.schedule), describeSchedule(d.schedule as TreatmentView["schedule"]));
  return list.length > 0 ? list : ["Nenhuma diferença em relação à versão atual."];
}

function TreatmentConflict({ conflict, name }: { conflict: TreatmentConflictView; name: (userId: string) => string }) {
  const family = useFamily();
  const t = conflict.treatment;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function resolve(choice: "KEEP_CURRENT" | "ADOPT", proposalId?: string) {
    setBusy(true);
    setError(null);
    try {
      await mutate({
        familyId: family.id, method: "POST", path: `/families/${family.id}/treatments/${t.id}/conflict/resolution`,
        body: { conflictId: conflict.id, choice, proposalId, baseVersion: t.version, reason: reason.trim() },
        label: `Conferência do tratamento ${t.name}`,
        entityId: t.id,
        effects: [{ key: `treatment-conflicts:${family.id}`, op: "remove", id: conflict.id }],
      });
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) return null;
  return (
    <section className="card stack conflict">
      <h2>{t.name}</h2>
      <p>
        Alteração feita sem conexão sobre uma versão anterior do tratamento. <strong>O tratamento não mudou</strong>: decida
        se a alteração deve valer. <Link to={`/tratamentos/${t.id}`}>Ver versão atual →</Link>
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {conflict.proposals.map((p) => (
        <div className="proposal" key={p.id}>
          <h3>Alteração de {name(p.proposedBy)}</h3>
          <p className="muted small">Feita sobre a versão {p.baseVersion} · versão atual {t.version} · recebida {formatWhen(p.createdAt)}</p>
          <ul className="small">{changes(t, p).map((c) => <li key={c}>{c}</li>)}</ul>
          <button className="btn btn-small" disabled={busy || !reason.trim()} onClick={() => void resolve("ADOPT", p.id)}>
            Aplicar esta alteração
          </button>
        </div>
      ))}
      <label>
        Como foi decidido? <span className="muted small">(obrigatório)</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="Ex.: conferimos a receita nova" />
      </label>
      <button className="btn btn-primary" disabled={busy || !reason.trim()} onClick={() => void resolve("KEEP_CURRENT")}>
        Manter a versão atual
      </button>
      <p className="muted small">A decisão vale a partir de agora; doses passadas e registros não mudam.</p>
    </section>
  );
}
