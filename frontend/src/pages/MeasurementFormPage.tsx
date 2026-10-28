import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { MeasurementType, PersonView } from "../api/types";
import { api } from "../api/client";
import { ScreenBar } from "../components/ScreenBar";
import { Notice } from "../components/Layout";
import { useCached } from "../hooks/useCached";
import { MEASUREMENT_TYPES, parseNumber, TYPE_ORDER } from "../lib/health";
import { fromLocalInput, toLocalInput } from "../lib/time";
import { useFamily, useSession } from "../session";
import { discard, pendingFor, submitRecord } from "../sync/outbox";

/** Registro de aferição; funciona offline (fila). */
export function MeasurementFormPage() {
  const family = useFamily();
  const { deviceId } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [chosen, setChosen] = useState(params.get("pessoa") ?? "");
  const persons = useCached(`persons:${family.id}`, () => api<PersonView[]>(`/families/${family.id}/persons`, { query: { active: "true" } }));
  const personId = chosen || persons.data?.[0]?.id || "";
  const person = persons.data?.find((p) => p.id === personId);

  const [type, setType] = useState<MeasurementType>((params.get("tipo") as MeasurementType) ?? "TEMPERATURE");
  const [value, setValue] = useState("");
  const [value2, setValue2] = useState("");
  const [label, setLabel] = useState("");
  const [unit, setUnit] = useState("");
  const [method, setMethod] = useState("");
  const [at, setAt] = useState(() => toLocalInput(new Date()));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const info = MEASUREMENT_TYPES[type];

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = parseNumber(value);
    const v2 = info.pair ? parseNumber(value2) : null;
    if (v === null || (info.pair && v2 === null)) return setError("Digite o valor medido (use vírgula ou ponto).");
    if (!deviceId) return setError("Este aparelho ainda não foi registrado. Conecte-se e abra o app de novo.");
    setBusy(true);
    setError(null);
    const result = await submitRecord({
      familyId: family.id, personId, kind: "MEASUREMENT", deviceId,
      fields: {
        type, value: v, value2: v2, measuredAt: fromLocalInput(at), notes: notes.trim() || undefined,
        method: method || undefined,
        ...(type === "OTHER" ? { label: label.trim(), unit: unit.trim() } : { unit: info.unit }),
      },
    });
    setBusy(false);
    if (result.state === "failed") {
      setError(result.error.message);
      const items = await pendingFor(family.id);
      await Promise.all(items.filter((i) => i.state === "failed" && i.kind === "MEASUREMENT").map((i) => discard(i.id)));
      return;
    }
    navigate(`/saude?pessoa=${personId}`, { replace: true });
  }

  return (
    <form className="page stack" onSubmit={(e) => void submit(e)}>
      <ScreenBar title={`Nova aferição${person ? ` · ${person.displayName}` : ""}`} />
      {error && <Notice tone="error">{error}</Notice>}
      {(persons.data?.length ?? 0) > 1 && (
        <label>
          Pessoa
          <select value={personId} onChange={(e) => setChosen(e.target.value)}>
            {persons.data!.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
      )}
      <div className="type-grid" role="radiogroup" aria-label="Tipo de aferição">
        {TYPE_ORDER.map((t) => (
          <button type="button" key={t} role="radio" aria-checked={type === t} className={`chip ${type === t ? "chip-on" : ""}`}
            onClick={() => { setType(t); setMethod(""); }}>
            {MEASUREMENT_TYPES[t].label}
          </button>
        ))}
      </div>

      {type === "OTHER" && (
        <div className="row wrap">
          <label className="grow">
            O que foi medido
            <input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={80} placeholder="Ex.: evacuações no dia" />
          </label>
          <label>
            Unidade
            <input className="short" value={unit} onChange={(e) => setUnit(e.target.value)} required maxLength={20} placeholder="vezes" />
          </label>
        </div>
      )}

      <div className="row wrap">
        <label>
          {info.pair ? info.pair[0] : "Valor"}{info.unit ? ` (${info.unit})` : ""}
          <input inputMode="decimal" className="value-input" value={value} onChange={(e) => setValue(e.target.value)} required autoFocus
            placeholder={type === "TEMPERATURE" ? "36,5" : ""} />
        </label>
        {info.pair && (
          <label>
            {info.pair[1]} ({info.unit})
            <input inputMode="decimal" className="value-input" value={value2} onChange={(e) => setValue2(e.target.value)} required />
          </label>
        )}
      </div>

      {info.methods && (
        <label>
          {type === "TEMPERATURE" ? "Onde foi medida" : "Condição"} <span className="muted small">(opcional)</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">—</option>
            {info.methods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
      )}
      <label>
        Horário da medida
        <input type="datetime-local" value={at} max={toLocalInput(new Date())} onChange={(e) => setAt(e.target.value)} required />
      </label>
      <label>
        Observações <span className="muted small">(opcional)</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
      </label>
      <div className="row">
        <button className="btn btn-primary" disabled={busy || !personId}>Salvar aferição</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancelar</button>
      </div>
      <p className="muted small">O app guarda e mostra os valores; não os interpreta. Em caso de dúvida, procure orientação profissional.</p>
    </form>
  );
}
