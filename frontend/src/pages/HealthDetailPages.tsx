import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { api, errorMessage } from "../api/client";
import type { Intensity, MeasurementView, SymptomView, TreatmentView } from "../api/types";
import { ScreenBar } from "../components/ScreenBar";
import { Notice, Spinner } from "../components/Layout";
import { useCached } from "../hooks/useCached";
import { useOnline } from "../hooks/useOnline";
import { formatMeasurement, formatNumber, INTENSITY, MEASUREMENT_TYPES, methodLabel, parseNumber } from "../lib/health";
import { formatWhen, fromLocalInput, toLocalInput } from "../lib/time";
import { mutate } from "../sync/outbox";
import { useFamily, useSession } from "../session";

/** Detalhe de uma aferição: corrigir (preserva a original) ou excluir com motivo. */
export function MeasurementDetailPage() {
  const { id } = useParams();
  const family = useFamily();
  const { deviceId } = useSession();
  const navigate = useNavigate();
  const fromList = (useLocation().state as { measurement?: MeasurementView } | null)?.measurement;
  const loaded = useCached(`measurement:${id}`, () => api<MeasurementView>(`/families/${family.id}/measurements/${id}`));
  const m = loaded.data ?? fromList;
  const [mode, setMode] = useState<"view" | "correct" | "discard">("view");
  const [value, setValue] = useState("");
  const [value2, setValue2] = useState("");
  const [at, setAt] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!m) return loaded.loading ? <Spinner /> : <div className="page"><Notice tone="error">{loaded.error}</Notice></div>;
  const info = MEASUREMENT_TYPES[m.type];
  const back = () => navigate(`/saude?pessoa=${m.personId}`, { replace: true });

  function startCorrection() {
    setValue(formatNumber(m!.value, info.decimals));
    setValue2(m!.value2 != null ? formatNumber(m!.value2, info.decimals) : "");
    setAt(toLocalInput(new Date(m!.measuredAt)));
    setMode("correct");
  }
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <ScreenBar title={(m.type === "OTHER" ? m.label : null) ?? info.label} />
      {error && <Notice tone="error">{error}</Notice>}
      <dl className="facts card">
        <dt>Valor</dt><dd className="big">{formatMeasurement(m)}</dd>
        <dt>Medida em</dt><dd>{formatWhen(m.measuredAt)}</dd>
        {m.method && (<><dt>{m.type === "TEMPERATURE" ? "Local" : "Condição"}</dt><dd>{methodLabel(m.type, m.method)}</dd></>)}
        {m.notes && (<><dt>Observações</dt><dd>{m.notes}</dd></>)}
        <dt>Registrado por</dt><dd>{m.recordedBy?.displayName} · {formatWhen(m.recordedAt)}</dd>
        {m.replacesId && (<><dt>Correção</dt><dd>Substitui um registro anterior</dd></>)}
        {m.voidedAt && (<><dt>Excluída</dt><dd>{m.voidedBy?.displayName}: {m.voidReason}</dd></>)}
      </dl>
      {!m.voidedAt && mode === "view" && (
        <div className="row wrap">
          <button className="btn" onClick={startCorrection}>Corrigir</button>
          <button className="btn" onClick={() => setMode("discard")}>Excluir</button>
        </div>
      )}
      {mode === "correct" && (
        <section className="card stack">
          <h2>Corrigir aferição</h2>
          <div className="row wrap">
            <label>{info.pair ? info.pair[0] : "Valor"} <input inputMode="decimal" className="value-input" value={value} onChange={(e) => setValue(e.target.value)} /></label>
            {info.pair && <label>{info.pair[1]} <input inputMode="decimal" className="value-input" value={value2} onChange={(e) => setValue2(e.target.value)} /></label>}
          </div>
          <label>Horário da medida <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>
          <label>Motivo <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></label>
          <p className="muted small">O registro original fica guardado no histórico.</p>
          <div className="row">
            <button className="btn btn-primary" disabled={busy || !reason.trim()} onClick={() => void run(() => {
              const v = parseNumber(value);
              if (v === null) throw new Error("Valor inválido.");
              const fixed = { value: v, value2: info.pair ? parseNumber(value2) : null, measuredAt: fromLocalInput(at) };
              return mutate({
                familyId: family.id, method: "POST", path: `/families/${family.id}/measurements/${m.id}/correction`,
                body: { deviceId, ...fixed, unit: m.unit, label: m.label, method: m.method, notes: m.notes, reason: reason.trim() },
                label: `Correção de aferição (${info.label})`,
                effects: [
                  { key: `measurements:${family.id}:${m.personId}:`, prefix: true, op: "merge", id: m.id, value: fixed },
                  { key: `measurement:${m.id}`, op: "merge", value: fixed },
                ],
              });
            })}>Salvar correção</button>
            <button className="btn" onClick={() => setMode("view")}>Cancelar</button>
          </div>
        </section>
      )}
      {mode === "discard" && (
        <section className="card stack">
          <h2>Excluir aferição</h2>
          <label>Motivo <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="Ex.: pessoa errada" /></label>
          <div className="row">
            <button className="btn btn-primary" disabled={busy || !reason.trim()} onClick={() => void run(() => mutate({
              familyId: family.id, method: "POST", path: `/families/${family.id}/measurements/${m.id}/void`, body: { reason: reason.trim() },
              label: `Exclusão de aferição (${info.label})`,
              effects: [{ key: `measurements:${family.id}:${m.personId}:`, prefix: true, op: "remove", id: m.id }],
            }))}>Excluir</button>
            <button className="btn" onClick={() => setMode("view")}>Cancelar</button>
          </div>
        </section>
      )}
    </div>
  );
}

/** Detalhe de um sintoma: registrar o fim, ajustar ou excluir com motivo. */
export function SymptomDetailPage() {
  const { id } = useParams();
  const family = useFamily();
  const online = useOnline();
  const navigate = useNavigate();
  const s = (useLocation().state as { symptom?: SymptomView } | null)?.symptom;
  const treatments = useCached(`treatments:${family.id}`, () => api<TreatmentView[]>(`/families/${family.id}/treatments`));
  const [endedAt, setEndedAt] = useState(() => toLocalInput(new Date()));
  const [intensity, setIntensity] = useState<Intensity | null>(s?.intensity ?? null);
  const [reason, setReason] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!s || s.id !== id) return <div className="page"><Notice>Abra o sintoma pela tela Saúde.</Notice></div>;
  const treatment = treatments.data?.find((t) => t.id === s.treatmentId);
  const back = () => navigate(`/saude?pessoa=${s.personId}`, { replace: true });

  async function update(patch: Partial<SymptomView>) {
    setBusy(true);
    setError(null);
    try {
      await mutate({
        familyId: family.id, method: "PUT", path: `/families/${family.id}/symptoms/${s!.id}`,
        body: { baseVersion: s!.version, description: s!.description, intensity: s!.intensity, startedAt: s!.startedAt,
          endedAt: s!.endedAt, treatmentId: s!.treatmentId, notes: s!.notes, ...patch },
        label: `Alteração do sintoma ${s!.description}`,
        effects: [{ key: `symptoms:${family.id}:${s!.personId}:`, prefix: true, op: "merge", id: s!.id, value: { ...patch, version: s!.version + 1 } }],
      });
      back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <ScreenBar title={s.description} />
      {error && <Notice tone="error">{error}</Notice>}
      <dl className="facts card">
        <dt>Início</dt><dd>{formatWhen(s.startedAt)}</dd>
        <dt>Fim</dt><dd>{s.endedAt ? formatWhen(s.endedAt) : "Em andamento"}</dd>
        {s.intensity && (<><dt>Intensidade</dt><dd>{INTENSITY[s.intensity]}</dd></>)}
        {treatment && (<><dt>Possível reação a</dt><dd>{treatment.name}</dd></>)}
        {s.notes && (<><dt>Observações</dt><dd>{s.notes}</dd></>)}
        <dt>Registrado por</dt><dd>{s.recordedBy?.displayName} · {formatWhen(s.recordedAt)}</dd>
        {s.updatedBy && (<><dt>Alterado por</dt><dd>{s.updatedBy.displayName} · {formatWhen(s.updatedAt!)}</dd></>)}
      </dl>
      {!online && <Notice tone="warn">Sem conexão: as alterações ficam guardadas e são enviadas quando a conexão voltar.</Notice>}
      {!s.endedAt && (
        <section className="card stack">
          <h2>Terminou?</h2>
          <label>Terminou em <input type="datetime-local" value={endedAt} max={toLocalInput(new Date())} onChange={(e) => setEndedAt(e.target.value)} /></label>
          <button className="btn btn-primary" disabled={busy} onClick={() => void update({ endedAt: fromLocalInput(endedAt) })}>Registrar fim</button>
        </section>
      )}
      <section className="card stack">
        <h2>Intensidade</h2>
        <div className="segmented" role="radiogroup">
          {(Object.keys(INTENSITY) as Intensity[]).map((i) => (
            <button type="button" key={i} role="radio" aria-checked={intensity === i} className={intensity === i ? "on" : ""}
              onClick={() => setIntensity(i)}>{INTENSITY[i]}</button>
          ))}
        </div>
        <button className="btn" disabled={busy || intensity === s.intensity} onClick={() => void update({ intensity })}>Salvar intensidade</button>
      </section>
      {discarding ? (
        <section className="card stack">
          <label>Motivo da exclusão <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></label>
          <div className="row">
            <button className="btn btn-primary" disabled={busy || !reason.trim()} onClick={() => void (async () => {
              setBusy(true);
              try {
                await mutate({
                  familyId: family.id, method: "POST", path: `/families/${family.id}/symptoms/${s.id}/void`, body: { reason: reason.trim() },
                  label: `Exclusão do sintoma ${s.description}`,
                  effects: [{ key: `symptoms:${family.id}:${s.personId}:`, prefix: true, op: "remove", id: s.id }],
                });
                back();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            })()}>Excluir</button>
            <button className="btn" onClick={() => setDiscarding(false)}>Cancelar</button>
          </div>
        </section>
      ) : <button className="link" onClick={() => setDiscarding(true)}>Excluir registro</button>}
    </div>
  );
}
