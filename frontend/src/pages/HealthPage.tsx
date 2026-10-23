import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api, errorMessage } from "../api/client";
import type { CustomReminderView, MeasurementType, PersonView, ReferenceLineView } from "../api/types";
import { Notice, Spinner } from "../components/Layout";
import { MeasurementChart } from "../components/MeasurementChart";
import { SyncStatus } from "../components/SyncStatus";
import { useCached } from "../hooks/useCached";
import { useHealth, type MeasurementItem, type SymptomItem } from "../hooks/useHealth";
import { useOnline } from "../hooks/useOnline";
import { formatMeasurement, formatNumber, INTENSITY, MEASUREMENT_TYPES, methodLabel, parseNumber, referenceFor, TYPE_ORDER } from "../lib/health";
import { formatTime, formatWhen, fromLocalInput, toLocalInput } from "../lib/time";
import { useFamily, useSession } from "../session";

const PERIODS = [
  { hours: 24, label: "24 h" },
  { hours: 72, label: "3 dias" },
  { hours: 168, label: "7 dias" },
  { hours: 720, label: "30 dias" },
];

/** Aferições, sintomas e linha do tempo de uma pessoa. */
export function HealthPage() {
  const family = useFamily();
  const { me } = useSession();
  const [params, setParams] = useSearchParams();
  const persons = useCached(`persons:${family.id}`, () =>
    api<PersonView[]>(`/families/${family.id}/persons`, { query: { active: "true" } }));
  const personId = params.get("pessoa") ?? persons.data?.[0]?.id ?? null;
  const [hours, setHours] = useState(24);
  // Período fixado ao escolher (a chave do cache não muda a cada render).
  const [anchor, setAnchor] = useState(() => Date.now());
  const { from, to } = useMemo(() => ({ from: new Date(anchor - hours * 3_600_000), to: new Date(anchor + 60_000) }), [anchor, hours]);
  const health = useHealth(family.id, personId, from, to);
  const person = persons.data?.find((p) => p.id === personId);

  if (persons.data && persons.data.length === 0) {
    return <div className="page"><h1>Saúde</h1><p className="empty">Cadastre as pessoas acompanhadas na aba Família.</p></div>;
  }

  const types = TYPE_ORDER.filter((t) => t !== "OTHER" && (health.measurements.some((m) => m.type === t) || referenceFor(health.lines, personId ?? "", t)));
  const others = [...new Set(health.measurements.filter((m) => m.type === "OTHER").map((m) => `${m.label}|${m.unit}`))];
  const ongoing = health.symptoms.filter((s) => !s.endedAt);
  const doseMarks = health.doses.map((o) => ({ at: Date.parse(o.administration!.administeredAt), label: o.treatment.name }));

  return (
    <div className="page">
      <h1>Saúde</h1>
      <SyncStatus familyId={family.id} fresh={health.fresh} savedAt={health.savedAt} />

      <div className="chips" role="group" aria-label="Pessoa">
        {(persons.data ?? []).map((p) => (
          <button key={p.id} className={`chip ${p.id === personId ? "chip-on" : ""}`} onClick={() => setParams({ pessoa: p.id })}>
            {p.userId && p.userId === me?.id ? "Você" : p.displayName}
          </button>
        ))}
      </div>

      {personId && (
        <div className="row wrap">
          <Link className="btn btn-primary" to={`/saude/aferir?pessoa=${personId}`}>+ Aferição</Link>
          <Link className="btn" to={`/saude/sintoma?pessoa=${personId}`}>+ Sintoma</Link>
        </div>
      )}

      <div className="chips" role="group" aria-label="Período">
        {PERIODS.map((p) => (
          <button key={p.hours} className={`chip ${hours === p.hours ? "chip-on" : ""}`}
            onClick={() => { setHours(p.hours); setAnchor(Date.now()); }}>{p.label}</button>
        ))}
      </div>

      {health.error && <Notice tone="error">{health.error}</Notice>}
      {health.loading && <Spinner />}

      {ongoing.length > 0 && (
        <section className="card">
          <h2>Sintomas em andamento</h2>
          <ul className="plain">
            {ongoing.map((s) => <SymptomLine key={s.id} symptom={s} />)}
          </ul>
        </section>
      )}

      {types.map((type) => {
        const series = health.measurements.filter((m) => m.type === type);
        return (
          <ChartCard key={type} type={type} personName={person?.displayName ?? ""} personId={personId!}
            points={series} doses={doseMarks} lines={health.lines} from={from.getTime()} to={to.getTime()}
            onLinesChanged={health.reloadLines} />
        );
      })}
      {others.map((key) => {
        const [label, unit] = key.split("|");
        const series = health.measurements.filter((m) => m.type === "OTHER" && m.label === label && m.unit === unit);
        return (
          <section className="card" key={key}>
            <h2>{label} ({unit})</h2>
            <MeasurementChart title={label} unit={unit} decimals={1} from={from.getTime()} to={to.getTime()}
              points={series.map(point)} doses={doseMarks} reference={null} />
          </section>
        );
      })}
      {!health.loading && types.length === 0 && others.length === 0 && (
        <p className="empty">Nenhuma aferição neste período.</p>
      )}

      {personId && <Reminders personId={personId} />}

      <Timeline measurements={health.measurements} symptoms={health.symptoms}
        doses={health.doses.map((o) => ({ id: o.id, at: o.administration!.administeredAt, label: o.treatment.name, by: o.administration!.recordedBy?.displayName }))} />
    </div>
  );
}

function point(m: MeasurementItem) {
  return { at: Date.parse(m.measuredAt), value: m.value, value2: m.value2, pending: m.pending, by: m.recordedBy?.displayName };
}

function ChartCard(props: {
  type: MeasurementType; personId: string; personName: string; points: MeasurementItem[];
  doses: { at: number; label: string }[]; lines: ReferenceLineView[]; from: number; to: number; onLinesChanged: () => Promise<void>;
}) {
  const info = MEASUREMENT_TYPES[props.type];
  const line = referenceFor(props.lines, props.personId, props.type);
  const [editing, setEditing] = useState(false);
  return (
    <section className="card">
      <div className="title-row">
        <h2>{info.label} ({info.unit})</h2>
        <button className="link small" onClick={() => setEditing(!editing)}>{line ? "Referência" : "+ Referência"}</button>
      </div>
      {props.points.length > 0 ? (
        <MeasurementChart title={info.label} unit={info.unit} decimals={info.decimals} from={props.from} to={props.to}
          points={props.points.map(point)} doses={props.doses} seriesLabels={info.pair}
          reference={line && { value: line.value, value2: line.value2, label: line.label }} />
      ) : <p className="muted small">Nenhuma aferição neste período.</p>}
      {editing && (
        <ReferenceEditor type={props.type} personId={props.personId} personName={props.personName} current={line}
          onDone={async () => { setEditing(false); await props.onLinesChanged(); }} />
      )}
    </section>
  );
}

/** Linha de referência: definida pela família conforme orientação profissional; só visual. */
function ReferenceEditor({ type, personId, personName, current, onDone }: {
  type: MeasurementType; personId: string; personName: string; current: ReferenceLineView | null; onDone: () => Promise<void>;
}) {
  const family = useFamily();
  const online = useOnline();
  const info = MEASUREMENT_TYPES[type];
  const [value, setValue] = useState(current ? formatNumber(current.value, info.decimals) : "");
  const [value2, setValue2] = useState(current?.value2 != null ? formatNumber(current.value2, info.decimals) : "");
  const [label, setLabel] = useState(current?.label ?? "");
  const [scope, setScope] = useState<"person" | "family">(current && current.personId === null ? "family" : "person");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const v = parseNumber(value);
    const v2 = info.pair ? parseNumber(value2) : null;
    if (v === null || (info.pair && value2.trim() && v2 === null)) return setError("Valor inválido.");
    setBusy(true);
    setError(null);
    try {
      await api(`/families/${family.id}/reference-lines`, {
        method: "PUT",
        body: { type, value: v, value2: v2, label: label.trim(), personId: scope === "person" ? personId : null },
      });
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!current) return;
    setBusy(true);
    try {
      await api(`/families/${family.id}/reference-lines/${current.id}`, { method: "DELETE" });
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack reference-editor">
      <p className="muted small">
        Uma linha no gráfico, conforme a orientação do profissional de saúde. O app não interpreta os valores nem emite alertas por ela.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="row wrap">
        <label>
          {info.pair ? info.pair[0] : "Valor"} ({info.unit})
          <input inputMode="decimal" className="short" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        {info.pair && (
          <label>
            {info.pair[1]} ({info.unit}) <span className="muted small">(opcional)</span>
            <input inputMode="decimal" className="short" value={value2} onChange={(e) => setValue2(e.target.value)} />
          </label>
        )}
      </div>
      <label>
        Origem da orientação
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} placeholder="Ex.: orientação do pediatra" />
      </label>
      <fieldset className="row wrap">
        <label className="radio"><input type="radio" checked={scope === "person"} onChange={() => setScope("person")} /> Só para {personName}</label>
        <label className="radio"><input type="radio" checked={scope === "family"} onChange={() => setScope("family")} /> Para toda a família</label>
      </fieldset>
      <div className="row wrap">
        <button className="btn btn-primary btn-small" disabled={busy || !online || !value.trim() || !label.trim()} onClick={() => void save()}>
          Salvar referência
        </button>
        {current && <button className="btn btn-small" disabled={busy || !online} onClick={() => void remove()}>Remover</button>}
      </div>
      {!online && <p className="muted small">Precisa de conexão.</p>}
    </div>
  );
}

function SymptomLine({ symptom }: { symptom: SymptomItem }) {
  const content = (
    <>
      <strong>{symptom.description}</strong>
      {symptom.intensity && <span className="muted"> · {INTENSITY[symptom.intensity]}</span>}
      <span className="muted small"> · desde {formatWhen(symptom.startedAt)}</span>
      {symptom.pending && <span className="badge badge-queued">Aguardando envio</span>}
    </>
  );
  return <li>{symptom.pending ? content : <Link to={`/saude/sintomas/${symptom.id}`} state={{ symptom }} className="plain-link">{content}</Link>}</li>;
}

interface Entry {
  key: string;
  at: string;
  kind: "measurement" | "symptom" | "symptom-end" | "dose";
  title: string;
  detail?: string;
  pending?: boolean;
  to?: string;
  state?: unknown;
}

/** Linha do tempo: aferições, sintomas e doses dadas, do mais recente ao mais antigo. */
function Timeline({ measurements, symptoms, doses }: {
  measurements: MeasurementItem[]; symptoms: SymptomItem[];
  doses: { id: string; at: string; label: string; by?: string }[];
}) {
  const entries: Entry[] = [
    ...measurements.map((m): Entry => ({
      key: `m${m.id}`, at: m.measuredAt, kind: "measurement",
      title: `${m.type === "OTHER" ? m.label : MEASUREMENT_TYPES[m.type].label}: ${formatMeasurement(m)}`,
      detail: [methodLabel(m.type, m.method), m.recordedBy?.displayName, m.notes].filter(Boolean).join(" · "),
      pending: m.pending, to: m.pending ? undefined : `/saude/afericoes/${m.id}`, state: { measurement: m },
    })),
    ...symptoms.map((s): Entry => ({
      key: `s${s.id}`, at: s.startedAt, kind: "symptom",
      title: `Sintoma: ${s.description}${s.intensity ? ` (${INTENSITY[s.intensity].toLowerCase()})` : ""}`,
      detail: [s.treatmentId ? "possível reação" : null, s.recordedBy?.displayName, s.notes].filter(Boolean).join(" · "),
      pending: s.pending, to: s.pending ? undefined : `/saude/sintomas/${s.id}`, state: { symptom: s },
    })),
    ...symptoms.filter((s) => s.endedAt).map((s): Entry => ({
      key: `e${s.id}`, at: s.endedAt!, kind: "symptom-end", title: `Fim: ${s.description}`,
    })),
    ...doses.map((d): Entry => ({
      key: `d${d.id}`, at: d.at, kind: "dose", title: `Dose: ${d.label}`, detail: d.by, to: `/doses/${d.id}`,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (entries.length === 0) return null;
  return (
    <section className="card">
      <h2>Linha do tempo</h2>
      <ol className="timeline">
        {entries.map((e) => {
          const body = (
            <>
              <span className="timeline-when">{formatWhen(e.at)}</span>
              <span className={`timeline-dot timeline-${e.kind}`} aria-hidden="true" />
              <span className="timeline-body">
                <span>{e.title}</span>
                {e.detail && <span className="muted small">{e.detail}</span>}
                {e.pending && <span className="badge badge-queued">Aguardando envio</span>}
              </span>
            </>
          );
          return <li key={e.key}>{e.to ? <Link to={e.to} state={e.state} className="timeline-row">{body}</Link> : <div className="timeline-row">{body}</div>}</li>;
        })}
      </ol>
    </section>
  );
}

/** Lembretes avulsos (ex.: "medir a temperatura de novo"), enviados por notificação. */
function Reminders({ personId }: { personId: string }) {
  const family = useFamily();
  const online = useOnline();
  const list = useCached(`reminders:${family.id}:${personId}`, () =>
    api<CustomReminderView[]>(`/families/${family.id}/persons/${personId}/reminders`));
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("Medir a temperatura de novo");
  const [at, setAt] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60_000)));
  const [everyone, setEveryone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(minutes?: number) {
    setError(null);
    const remindAt = minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : fromLocalInput(at);
    try {
      await api(`/families/${family.id}/persons/${personId}/reminders`, {
        method: "POST", body: { message: message.trim(), remindAt, notifyEveryone: everyone },
      });
      setOpen(false);
      await list.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function cancel(id: string) {
    await api(`/families/${family.id}/reminders/${id}`, { method: "DELETE" }).catch((e) => setError(errorMessage(e)));
    await list.reload();
  }

  return (
    <section className="card stack">
      <div className="title-row">
        <h2>Lembretes</h2>
        {!open && <button className="link small" disabled={!online} onClick={() => setOpen(true)}>+ Lembrete</button>}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {(list.data ?? []).length > 0 && (
        <ul className="plain">
          {list.data!.map((r) => (
            <li key={r.id} className="row between">
              <span>{formatTime(r.remindAt)} · {r.message}{r.notifyEveryone ? " (todos)" : ""}</span>
              <button className="btn btn-small" disabled={!online} onClick={() => void cancel(r.id)}>Cancelar</button>
            </li>
          ))}
        </ul>
      )}
      {list.data?.length === 0 && !open && <p className="muted small">Nenhum lembrete agendado.</p>}
      {open && (
        <div className="stack">
          <label>Lembrar de <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} /></label>
          <div className="row wrap">
            {[30, 60, 120].map((m) => (
              <button key={m} className="btn btn-small" disabled={!message.trim()} onClick={() => void create(m)}>
                Em {m < 60 ? `${m} min` : `${m / 60} h`}
              </button>
            ))}
          </div>
          <div className="row wrap">
            <label>Ou às <input type="datetime-local" value={at} min={toLocalInput(new Date())} onChange={(e) => setAt(e.target.value)} /></label>
            <button className="btn btn-primary btn-small" disabled={!message.trim()} onClick={() => void create()}>Agendar</button>
          </div>
          <label className="radio"><input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> Avisar todos os responsáveis</label>
          <button className="link small" onClick={() => setOpen(false)}>Cancelar</button>
          <p className="muted small">O aviso chega por notificação; ative-as na aba Família.</p>
        </div>
      )}
    </section>
  );
}
