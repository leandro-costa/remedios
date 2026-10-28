import type { ScheduleType } from "../api/types";
import { WEEKDAYS, type ScheduleForm } from "../lib/schedule";

const TYPES: { value: ScheduleType; label: string }[] = [
  { value: "DAILY", label: "Horários fixos" },
  { value: "WEEKLY", label: "Dias da semana" },
  { value: "INTERVAL", label: "A cada N horas" },
];

/** Editor da agenda: transcreva os horários da prescrição. */
export function ScheduleEditor({ value, onChange }: { value: ScheduleForm; onChange: (form: ScheduleForm) => void }) {
  const set = (patch: Partial<ScheduleForm>) => onChange({ ...value, ...patch });
  const setTime = (index: number, time: string) => set({ times: value.times.map((t, i) => (i === index ? time : t)) });

  return (
    <fieldset className="stack schedule-editor">
      <legend>Agenda</legend>
      <div className="segmented" role="radiogroup" aria-label="Tipo de agenda">
        {TYPES.map((t) => (
          <button type="button" key={t.value} role="radio" aria-checked={value.type === t.value}
            className={value.type === t.value ? "on" : ""} onClick={() => set({ type: t.value })}>
            {t.label}
          </button>
        ))}
      </div>

      {value.type === "WEEKLY" && (
        <div className="chips" role="group" aria-label="Dias da semana">
          {WEEKDAYS.map((d) => {
            const on = value.daysOfWeek.includes(d.value);
            return (
              <button type="button" key={d.value} className={`chip ${on ? "chip-on" : ""}`} aria-pressed={on}
                onClick={() => set({ daysOfWeek: on ? value.daysOfWeek.filter((x) => x !== d.value) : [...value.daysOfWeek, d.value] })}>
                {d.short}
              </button>
            );
          })}
        </div>
      )}

      {value.type !== "INTERVAL" ? (
        <>
          <div className="stack">
            {value.times.map((time, index) => (
              <div className="row" key={index}>
                <label className="grow">
                  {index === 0 ? "Horários" : <span className="sr-only">Horário {index + 1}</span>}
                  <input type="time" value={time} required onChange={(e) => setTime(index, e.target.value)} aria-label={`Horário ${index + 1}`} />
                </label>
                {value.times.length > 1 && (
                  <button type="button" className="icon-btn" aria-label={`Remover horário ${index + 1}`}
                    onClick={() => set({ times: value.times.filter((_, i) => i !== index) })}>×</button>
                )}
              </div>
            ))}
            <button type="button" className="link" onClick={() => set({ times: [...value.times, ""] })}>+ Adicionar horário</button>
          </div>
          {value.type === "DAILY" && (
            <label>
              Repetir a cada
              <span className="row">
                <input type="number" min={1} max={365} value={value.everyDays} className="short"
                  onChange={(e) => set({ everyDays: Number(e.target.value) })} /> dia(s)
              </span>
            </label>
          )}
        </>
      ) : (
        <div className="row wrap">
          <label>
            A cada
            <span className="row">
              <input type="number" min={1} max={168} value={value.everyHours} className="short"
                onChange={(e) => set({ everyHours: Number(e.target.value) })} /> horas
            </span>
          </label>
          <label>
            Primeira dose às
            <input type="time" value={value.firstDoseAt} required onChange={(e) => set({ firstDoseAt: e.target.value })} />
          </label>
        </div>
      )}
      <p className="muted small">Fuso horário: {value.timezone}. Os horários seguem a prescrição; o app não sugere intervalos.</p>
    </fieldset>
  );
}
