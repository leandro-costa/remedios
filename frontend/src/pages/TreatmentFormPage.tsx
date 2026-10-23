import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { api, ApiError, errorMessage } from "../api/client";
import type { PersonView, TreatmentKind, TreatmentView } from "../api/types";
import { Notice, Spinner } from "../components/Layout";
import { ScheduleEditor } from "../components/ScheduleEditor";
import { useCached } from "../hooks/useCached";
import { useOnline } from "../hooks/useOnline";
import { TREATMENT_KIND } from "../lib/labels";
import { describeSchedule, emptyScheduleForm, formFromRule, ruleFromForm, validateScheduleForm, type ScheduleForm } from "../lib/schedule";
import { deviceTimezone, formatDate, fromLocalInput, startOfDay, toLocalInput } from "../lib/time";
import { useFamily } from "../session";

interface Form {
  personId: string;
  name: string;
  kind: TreatmentKind;
  prescribedDose: string;
  route: string;
  instructions: string;
  startAt: string;
  endAt: string;
  schedule: ScheduleForm;
  effectiveFrom: string;
  reason: string;
}

function emptyForm(): Form {
  const now = new Date();
  return {
    personId: "", name: "", kind: "CONTINUOUS", prescribedDose: "", route: "", instructions: "",
    startAt: toLocalInput(startOfDay(now)), endAt: "", schedule: emptyScheduleForm(deviceTimezone()),
    effectiveFrom: toLocalInput(now), reason: "",
  };
}

function formFrom(t: TreatmentView): Form {
  return {
    personId: t.personId, name: t.name, kind: t.kind, prescribedDose: t.prescribedDose, route: t.route ?? "",
    instructions: t.instructions ?? "", startAt: toLocalInput(new Date(t.startAt)),
    endAt: t.endAt ? toLocalInput(new Date(t.endAt)) : "", schedule: formFromRule(t.schedule, deviceTimezone()),
    effectiveFrom: toLocalInput(new Date()), reason: "",
  };
}

/** Cadastro e alteração de tratamento, com conferência antes de salvar (seção 4.5). */
export function TreatmentFormPage() {
  const { id } = useParams();
  const family = useFamily();
  const navigate = useNavigate();
  const online = useOnline();
  const editing = Boolean(id);
  const persons = useCached(`persons:${family.id}`, () => api<PersonView[]>(`/families/${family.id}/persons`, { query: { active: "true" } }));
  const [current, setCurrent] = useState<TreatmentView | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!id) return;
    api<TreatmentView>(`/families/${family.id}/treatments/${id}`)
      .then((t) => { setCurrent(t); setForm(formFrom(t)); })
      .catch((e) => setError(errorMessage(e)));
  }, [id, family.id]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  if (editing && !current && !error) return <Spinner />;

  function review(e: FormEvent) {
    e.preventDefault();
    const problem = validateScheduleForm(form.schedule);
    if (problem) return setError(problem);
    if (form.endAt && new Date(form.endAt) <= new Date(form.startAt)) return setError("O término deve ser depois do início.");
    setError(null);
    setReviewing(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const body = {
      name: form.name.trim(), kind: form.kind, prescribedDose: form.prescribedDose.trim(),
      route: form.route.trim() || null, instructions: form.instructions.trim() || null,
      startAt: fromLocalInput(form.startAt), endAt: form.endAt ? fromLocalInput(form.endAt) : null,
      schedule: ruleFromForm(form.schedule),
    };
    try {
      if (current) {
        await api(`/families/${family.id}/treatments/${current.id}`, {
          method: "PUT",
          body: { ...body, baseVersion: current.version, effectiveFrom: fromLocalInput(form.effectiveFrom), reason: form.reason.trim() || null },
        });
        navigate(`/tratamentos/${current.id}`, { replace: true });
      } else {
        const created = await api<TreatmentView>(`/families/${family.id}/treatments`, { method: "POST", body: { ...body, personId: form.personId } });
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

  if (reviewing) {
    return (
      <div className="page">
        <h1>Confira antes de salvar</h1>
        <dl className="facts card">
          <dt>Pessoa</dt><dd>{person?.displayName ?? "—"}</dd>
          <dt>Medicamento</dt><dd>{form.name}</dd>
          <dt>Dose (da prescrição)</dt><dd>{form.prescribedDose}</dd>
          {form.route && (<><dt>Via</dt><dd>{form.route}</dd></>)}
          {form.instructions && (<><dt>Instruções</dt><dd>{form.instructions}</dd></>)}
          <dt>Tipo</dt><dd>{TREATMENT_KIND[form.kind]}</dd>
          <dt>Agenda</dt><dd>{describeSchedule(ruleFromForm(form.schedule))}</dd>
          <dt>Início</dt><dd>{formatDate(fromLocalInput(form.startAt))}</dd>
          <dt>Término</dt><dd>{form.endAt ? formatDate(fromLocalInput(form.endAt)) : "Sem término"}</dd>
          {current && (<><dt>Vale a partir de</dt><dd>{new Date(form.effectiveFrom).toLocaleString("pt-BR")}</dd></>)}
        </dl>
        {current?.status === "ACTIVE" && (
          <Notice>Se a agenda, o início ou o término mudaram, as doses futuras ainda não registradas serão recalculadas. Doses passadas e registros não mudam.</Notice>
        )}
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !online} onClick={() => void save()}>Salvar</button>
          <button className="btn" onClick={() => setReviewing(false)}>Voltar e editar</button>
        </div>
      </div>
    );
  }

  return (
    <form className="page stack" onSubmit={review}>
      <h1>{editing ? "Alterar tratamento" : "Novo tratamento"}</h1>
      {!online && <Notice tone="warn">Cadastrar e alterar tratamentos precisa de conexão.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {stale && (
        <Notice tone="warn">
          Outro responsável alterou este tratamento. Sua proposta continua no formulário; recarregue a versão atual para comparar.
          <button type="button" className="btn btn-small" onClick={() => {
            void api<TreatmentView>(`/families/${family.id}/treatments/${id}`).then((t) => { setCurrent(t); setStale(false); setError(null); });
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
      <div className="row wrap">
        <label>
          Início
          <input type="datetime-local" value={form.startAt} onChange={(e) => set({ startAt: e.target.value })} required />
        </label>
        <label>
          Término <span className="muted small">(opcional)</span>
          <input type="datetime-local" value={form.endAt} onChange={(e) => set({ endAt: e.target.value })} />
        </label>
      </div>
      <ScheduleEditor value={form.schedule} onChange={(schedule) => set({ schedule })} />
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
        <button className="btn btn-primary" disabled={!online}>Conferir</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancelar</button>
      </div>
    </form>
  );
}
