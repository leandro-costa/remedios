import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api } from "../api/client";
import type { Intensity, PersonView, TreatmentView } from "../api/types";
import { ScreenBar } from "../components/ScreenBar";
import { Notice } from "../components/Layout";
import { useCached } from "../hooks/useCached";
import { INTENSITY, SYMPTOM_SUGGESTIONS } from "../lib/health";
import { fromLocalInput, toLocalInput } from "../lib/time";
import { useFamily, useSession } from "../session";
import { discard, pendingFor, submitRecord } from "../sync/outbox";

/** Registro de sintoma ou possível reação; funciona offline (fila). */
export function SymptomFormPage() {
  const family = useFamily();
  const { deviceId } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [chosen, setChosen] = useState(params.get("pessoa") ?? "");
  const persons = useCached(`persons:${family.id}`, () => api<PersonView[]>(`/families/${family.id}/persons`, { query: { active: "true" } }));
  const treatments = useCached(`treatments:${family.id}`, () => api<TreatmentView[]>(`/families/${family.id}/treatments`));
  const personId = chosen || persons.data?.[0]?.id || "";
  const person = persons.data?.find((p) => p.id === personId);

  const [description, setDescription] = useState("");
  const [intensity, setIntensity] = useState<Intensity | "">("");
  const [startedAt, setStartedAt] = useState(() => toLocalInput(new Date()));
  const [ongoing, setOngoing] = useState(true);
  const [endedAt, setEndedAt] = useState(() => toLocalInput(new Date()));
  const [treatmentId, setTreatmentId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!deviceId) return setError("Este aparelho ainda não foi registrado. Conecte-se e abra o app de novo.");
    setBusy(true);
    setError(null);
    const result = await submitRecord({
      familyId: family.id, personId, kind: "SYMPTOM", deviceId,
      fields: {
        description: description.trim(), intensity: intensity || undefined, startedAt: fromLocalInput(startedAt),
        endedAt: ongoing ? undefined : fromLocalInput(endedAt), treatmentId: treatmentId || undefined,
        notes: notes.trim() || undefined,
      },
    });
    setBusy(false);
    if (result.state === "failed") {
      setError(result.error.message);
      const items = await pendingFor(family.id);
      await Promise.all(items.filter((i) => i.state === "failed" && i.kind === "SYMPTOM").map((i) => discard(i.id)));
      return;
    }
    navigate(`/saude?pessoa=${personId}`, { replace: true });
  }

  const personTreatments = (treatments.data ?? []).filter((t) => t.personId === personId && t.status !== "DRAFT");
  return (
    <form className="page stack" onSubmit={(e) => void submit(e)}>
      <ScreenBar title={`Novo sintoma${person ? ` · ${person.displayName}` : ""}`} />
      {error && <Notice tone="error">{error}</Notice>}
      {(persons.data?.length ?? 0) > 1 && (
        <label>
          Pessoa
          <select value={personId} onChange={(e) => setChosen(e.target.value)}>
            {persons.data!.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
      )}
      <label>
        O que foi observado
        <input value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={200} />
      </label>
      <div className="chips wrap" role="group" aria-label="Sugestões">
        {SYMPTOM_SUGGESTIONS.map((s) => (
          <button type="button" key={s} className={`chip ${description === s ? "chip-on" : ""}`} onClick={() => setDescription(s)}>{s}</button>
        ))}
      </div>
      <fieldset>
        <legend>Intensidade <span className="muted small">(opcional)</span></legend>
        <div className="segmented" role="radiogroup">
          {(Object.keys(INTENSITY) as Intensity[]).map((i) => (
            <button type="button" key={i} role="radio" aria-checked={intensity === i} className={intensity === i ? "on" : ""}
              onClick={() => setIntensity(intensity === i ? "" : i)}>{INTENSITY[i]}</button>
          ))}
        </div>
      </fieldset>
      <label>
        Começou em
        <input type="datetime-local" value={startedAt} max={toLocalInput(new Date())} onChange={(e) => setStartedAt(e.target.value)} required />
      </label>
      <label className="radio">
        <input type="checkbox" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} /> Ainda está acontecendo
      </label>
      {!ongoing && (
        <label>
          Terminou em
          <input type="datetime-local" value={endedAt} min={startedAt} max={toLocalInput(new Date())} onChange={(e) => setEndedAt(e.target.value)} required />
        </label>
      )}
      {personTreatments.length > 0 && (
        <label>
          Possível reação a um tratamento? <span className="muted small">(opcional)</span>
          <select value={treatmentId} onChange={(e) => setTreatmentId(e.target.value)}>
            <option value="">Não sei / não se aplica</option>
            {personTreatments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      )}
      <label>
        Observações <span className="muted small">(opcional)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} />
      </label>
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy || !personId || !description.trim()}>Salvar sintoma</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancelar</button>
      </div>
      <p className="muted small">Registrar uma possível reação não substitui avisar o profissional de saúde.</p>
    </form>
  );
}
