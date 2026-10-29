import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { api, ApiError, errorMessage } from "../api/client";
import type { PersonView, TreatmentKind, TreatmentView } from "../api/types";
import { ScreenBar } from "../components/ScreenBar";
import { Notice, Spinner } from "../components/Layout";
import { ScheduleEditor } from "../components/ScheduleEditor";
import { useCached } from "../hooks/useCached";
import { useOnline } from "../hooks/useOnline";
import { TREATMENT_KIND } from "../lib/labels";
import { describeSchedule, dosesInDays, emptyScheduleForm, formFromRule, planCourse, ruleFromForm, validateScheduleForm, type ScheduleForm } from "../lib/schedule";
import { deviceTimezone, formatWhen, fromLocalInput, startOfDay, toLocalInput } from "../lib/time";
import { mutate } from "../sync/outbox";
import { useFamily, useSession } from "../session";

type EndMode = "NONE" | "DATE" | "DAYS" | "DOSES";

const END_MODES: { value: EndMode; label: string }[] = [
  { value: "NONE", label: "Sem término" },
  { value: "DATE", label: "Até uma data" },
  { value: "DAYS", label: "Por dias" },
  { value: "DOSES", label: "Por doses" },
];

interface Form {
  personId: string;
  name: string;
  kind: TreatmentKind;
  prescribedDose: string;
  route: string;
  instructions: string;
  startAt: string;
  /** Término: sem, até uma data, por N dias (vira doses pela agenda) ou por N doses. */
  endMode: EndMode;
  endAt: string;
  days: string;
  doses: string;
  schedule: ScheduleForm;
  effectiveFrom: string;
  reason: string;
}

function emptyForm(): Form {
  const now = new Date();
  return {
    personId: "", name: "", kind: "CONTINUOUS", prescribedDose: "", route: "", instructions: "",
    startAt: toLocalInput(startOfDay(now)), endMode: "NONE", endAt: "", days: "", doses: "",
    schedule: emptyScheduleForm(deviceTimezone()),
    effectiveFrom: toLocalInput(now), reason: "",
  };
}

function formFrom(t: TreatmentView): Form {
  return {
    personId: t.personId, name: t.name, kind: t.kind, prescribedDose: t.prescribedDose, route: t.route ?? "",
    instructions: t.instructions ?? "", startAt: toLocalInput(new Date(t.startAt)),
    endMode: t.doseCount ? "DOSES" : t.endAt ? "DATE" : "NONE",
    endAt: t.endAt ? toLocalInput(new Date(t.endAt)) : "", days: "", doses: t.doseCount ? String(t.doseCount) : "",
    schedule: formFromRule(t.schedule, deviceTimezone()),
    effectiveFrom: toLocalInput(new Date()), reason: "",
  };
}

/** Cadastro e alteração de tratamento, com conferência antes de salvar (seção 4.5). */
export function TreatmentFormPage() {
  const { id } = useParams();
  const family = useFamily();
  const navigate = useNavigate();
  const online = useOnline();
  const { me, deviceId } = useSession();
  const editing = Boolean(id);
  const persons = useCached(`persons:${family.id}`, () => api<PersonView[]>(`/families/${family.id}/persons`, { query: { active: "true" } }));
  // A versão guardada no aparelho serve de base também sem conexão.
  const stored = useCached(id ? `treatment:${id}` : null, () => api<TreatmentView>(`/families/${family.id}/treatments/${id}`));
  const [current, setCurrent] = useState<TreatmentView | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!stored.data || current) return;
    setCurrent(stored.data);
    setForm(formFrom(stored.data));
  }, [stored.data, current]);
  useEffect(() => { if (stored.error && !stored.data) setError(stored.error); }, [stored.error, stored.data]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  if (editing && !current && !error) return <Spinner />;

  function review(e: FormEvent) {
    e.preventDefault();
    const problem = validateScheduleForm(form.schedule);
    if (problem) return setError(problem);
    if (form.endMode === "DATE" && !form.endAt) return setError("Informe a data de término.");
    if (form.endMode === "DATE" && new Date(form.endAt) <= new Date(form.startAt)) return setError("O término deve ser depois do início.");
    if (form.endMode !== "NONE" && form.endMode !== "DATE") {
      const count = doseCount();
      if (count === null) return setError("Não foi possível contar as doses desta agenda neste aparelho: informe o término por número de doses.");
      if (count < 1 || count > 2000) return setError(form.endMode === "DAYS" ? "Informe de 1 a 2000 doses (confira os dias)." : "Informe de 1 a 2000 doses.");
    }
    setError(null);
    setReviewing(true);
  }

  /** Total de doses: o informado, ou o que cabe em N dias a partir da primeira dose. */
  function doseCount(): number | null {
    if (form.endMode === "DOSES") return Number(form.doses) || 0;
    if (form.endMode === "DAYS") {
      const days = Number(form.days);
      if (!days || days < 1) return 0;
      return dosesInDays(ruleFromForm(form.schedule), new Date(form.startAt), days);
    }
    return null;
  }

  async function save() {
    setBusy(true);
    setError(null);
    const body = {
      name: form.name.trim(), kind: form.kind, prescribedDose: form.prescribedDose.trim(),
      route: form.route.trim() || null, instructions: form.instructions.trim() || null,
      startAt: fromLocalInput(form.startAt),
      endAt: form.endMode === "DATE" && form.endAt ? fromLocalInput(form.endAt) : null,
      doseCount: form.endMode === "DAYS" || form.endMode === "DOSES" ? doseCount() : null,
      schedule: ruleFromForm(form.schedule),
    };
    try {
      if (current) {
        // Fila offline: se outro responsável alterar antes do envio, a
        // alteração fica preservada para conferência (seção 10.2).
        await mutate({
          familyId: family.id, method: "PUT", path: `/families/${family.id}/treatments/${current.id}`,
          body: { ...body, baseVersion: current.version, effectiveFrom: fromLocalInput(form.effectiveFrom), reason: form.reason.trim() || null },
          queuedBody: { preserveConflict: true, deviceId },
          label: `Alteração do tratamento ${body.name}`,
          effects: [
            { key: `treatment:${current.id}`, op: "merge", value: { ...body, version: current.version + 1 } },
            { key: `treatments:${family.id}`, op: "merge", id: current.id, value: { ...body, version: current.version + 1 } },
          ],
        });
        navigate(`/tratamentos/${current.id}`, { replace: true });
      } else {
        // Id gerado aqui: o tratamento já pode ser aberto e ativado offline.
        const now = new Date().toISOString();
        const created: TreatmentView = {
          ...body, id: crypto.randomUUID(), personId: form.personId, status: "DRAFT", version: 1, conflictId: null,
          createdBy: me?.id ?? "", createdAt: now, updatedBy: me?.id ?? "", updatedAt: now,
        };
        await mutate({
          familyId: family.id, method: "POST", path: `/families/${family.id}/treatments`,
          body: { ...body, id: created.id, personId: form.personId },
          label: `Novo tratamento: ${body.name}`,
          effects: [
            { key: `treatment:${created.id}`, op: "upsert", value: { ...created } },
            { key: `treatments:${family.id}`, op: "upsert", value: { ...created }, list: true },
          ],
        });
        navigate(`/tratamentos/${created.id}`, { replace: true });
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "STALE_VERSION") setStale(true);
      setError(errorMessage(e));
      setReviewing(false);
    } finally {
      setBusy(false);
    }
  }

  const person = persons.data?.find((p) => p.id === form.personId);
  const count = form.endMode === "DAYS" || form.endMode === "DOSES" ? doseCount() : null;
  const plan = reviewing ? planCourse(ruleFromForm(form.schedule), new Date(form.startAt), {
    doseCount: count, endAt: form.endMode === "DATE" && form.endAt ? new Date(form.endAt) : null,
  }) : null;
  const describeEnd = () => {
    switch (form.endMode) {
      case "NONE": return "Sem término";
      case "DATE": return formatWhen(fromLocalInput(form.endAt));
      case "DAYS": return `Por ${form.days} ${Number(form.days) === 1 ? "dia" : "dias"} (${count} doses)`;
      case "DOSES": return `Após ${form.doses} ${Number(form.doses) === 1 ? "dose" : "doses"}`;
    }
  };

  if (reviewing) {
    return (
      <div className="page">
        <ScreenBar title="Confira antes de salvar" onBack={() => setReviewing(false)} />
        <dl className="facts card">
          <dt>Pessoa</dt><dd>{person?.displayName ?? "—"}</dd>
          <dt>Medicamento</dt><dd>{form.name}</dd>
          <dt>Dose (da prescrição)</dt><dd>{form.prescribedDose}</dd>
          {form.route && (<><dt>Via</dt><dd>{form.route}</dd></>)}
          {form.instructions && (<><dt>Instruções</dt><dd>{form.instructions}</dd></>)}
          <dt>Tipo</dt><dd>{TREATMENT_KIND[form.kind]}</dd>
          <dt>Agenda</dt><dd>{describeSchedule(ruleFromForm(form.schedule))}</dd>
          <dt>Primeira dose</dt><dd>{formatWhen(fromLocalInput(form.startAt))}</dd>
          <dt>Término</dt><dd>{describeEnd()}</dd>
          {plan && plan.count > 0 && (
            <>
              <dt>Duração</dt>
              <dd data-testid="course-plan">
                {plan.count} {plan.count === 1 ? "dose" : "doses"} · {plan.days} {plan.days === 1 ? "dia" : "dias"}
                <br /><span className="muted small">primeira {formatWhen(plan.first!.toISOString())} · última {formatWhen(plan.last!.toISOString())}</span>
              </dd>
            </>
          )}
          {current && (<><dt>Vale a partir de</dt><dd>{new Date(form.effectiveFrom).toLocaleString("pt-BR")}</dd></>)}
        </dl>
        {!online && <Notice tone="warn">Sem conexão: fica guardado neste aparelho e é enviado quando a conexão voltar.</Notice>}
        {current?.status === "ACTIVE" && (
          <Notice>Se a agenda, o início ou o término mudaram, as doses futuras ainda não registradas serão recalculadas. Doses passadas e registros não mudam.</Notice>
        )}
        <div className="row">
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Salvar</button>
          <button className="btn" onClick={() => setReviewing(false)}>Voltar e editar</button>
        </div>
      </div>
    );
  }

  return (
    <form className="page stack" onSubmit={review}>
      <ScreenBar title={editing ? "Alterar tratamento" : "Novo tratamento"} />
      {error && <Notice tone="error">{error}</Notice>}
      {stale && (
        <Notice tone="warn">
          Outro responsável alterou este tratamento. Sua proposta continua no formulário; recarregue a versão atual para comparar.
          <button type="button" className="btn btn-small" onClick={() => {
            void api<TreatmentView>(`/families/${family.id}/treatments/${id}`)
              .then((t) => { setCurrent(t); setStale(false); setError(null); })
              .catch((e) => setError(errorMessage(e)));
          }}>Usar a versão atual como base</button>
        </Notice>
      )}

      {!editing && (
        <label>
          Pessoa
          <select value={form.personId} onChange={(e) => set({ personId: e.target.value })} required>
            <option value="">Escolha…</option>
            {(persons.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
          {persons.data?.length === 0 && <span className="small">Cadastre as pessoas na aba Família.</span>}
        </label>
      )}
      <label>
        Medicamento
        <input value={form.name} onChange={(e) => set({ name: e.target.value })} required maxLength={200} />
      </label>
      <label>
        Dose conforme a prescrição
        <input value={form.prescribedDose} onChange={(e) => set({ prescribedDose: e.target.value })} required maxLength={500}
          placeholder="Ex.: 5 ml, 1 comprimido" />
        <span className="muted small">Transcreva exatamente o que está na receita. O app não calcula doses.</span>
      </label>
      <label>
        Via <span className="muted small">(opcional)</span>
        <input value={form.route} onChange={(e) => set({ route: e.target.value })} maxLength={200} placeholder="Ex.: oral" />
      </label>
      <label>
        Instruções <span className="muted small">(opcional)</span>
        <textarea value={form.instructions} onChange={(e) => set({ instructions: e.target.value })} maxLength={4000} rows={3} />
      </label>
      <label>
        Tipo
        <select value={form.kind} onChange={(e) => set({ kind: e.target.value as TreatmentKind })}>
          <option value="CONTINUOUS">{TREATMENT_KIND.CONTINUOUS}</option>
          <option value="OCCASIONAL">{TREATMENT_KIND.OCCASIONAL}</option>
        </select>
      </label>
      <ScheduleEditor value={form.schedule} onChange={(schedule) => set({ schedule })} />
      <label>
        Primeira dose (data e hora)
        <input type="datetime-local" value={form.startAt} onChange={(e) => set({ startAt: e.target.value })} required />
        <span className="muted small">Já em andamento? Informe a primeira dose de fato: as anteriores a agora contam no total.</span>
      </label>
      <fieldset className="stack">
        <legend>Término</legend>
        <div className="chips" role="radiogroup" aria-label="Término">
          {END_MODES.map((m) => (
            <button key={m.value} type="button" role="radio" aria-checked={form.endMode === m.value}
              className={`chip ${form.endMode === m.value ? "chip-on" : ""}`} onClick={() => set({ endMode: m.value })}>
              {m.label}
            </button>
          ))}
        </div>
        {form.endMode === "DATE" && (
          <label>
            Data e hora do término
            <input type="datetime-local" value={form.endAt} onChange={(e) => set({ endAt: e.target.value })} required />
          </label>
        )}
        {form.endMode === "DAYS" && (
          <label>
            Quantos dias
            <input type="number" inputMode="numeric" min={1} max={365} className="short" value={form.days}
              onChange={(e) => set({ days: e.target.value })} required />
            <span className="muted small">Contados a partir da primeira dose; o app transforma em número de doses pela agenda.</span>
          </label>
        )}
        {form.endMode === "DOSES" && (
          <label>
            Quantas doses no total
            <input type="number" inputMode="numeric" min={1} max={2000} className="short" value={form.doses}
              onChange={(e) => set({ doses: e.target.value })} required />
            <span className="muted small">Como na receita (ex.: 5 dias, 2 vezes ao dia = 10). Dose não dada conta e não é reposta.</span>
          </label>
        )}
      </fieldset>
      {current && (
        <>
          <label>
            A alteração vale a partir de
            <input type="datetime-local" value={form.effectiveFrom} min={toLocalInput(new Date())}
              onChange={(e) => set({ effectiveFrom: e.target.value })} required />
          </label>
          <label>
            Motivo da alteração <span className="muted small">(opcional)</span>
            <input value={form.reason} onChange={(e) => set({ reason: e.target.value })} maxLength={1000} placeholder="Ex.: nova receita" />
          </label>
        </>
      )}
      <div className="row">
        <button className="btn btn-primary">Conferir</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancelar</button>
      </div>
    </form>
  );
}
