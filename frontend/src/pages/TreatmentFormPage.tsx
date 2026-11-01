import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError, errorMessage } from "../api/client";
import type { MedicationView, PastDoses, PersonView, PrescriptionView, TreatmentKind, TreatmentView } from "../api/types";
import { bodyFrom, CatalogSuggestions, draftFromCatalog, emptyDraft, MedicationFields, useCatalog, type MedicationDraft } from "../components/MedicationFields";
import { normalize } from "../lib/catalog";
import { describeSubstances, medicationsKey, useMedications } from "./MedicationsPage";
import { PrescriptionFields, type PrescriptionDraft } from "./PrescriptionFormPage";
import { EVENTUAL_TITLE, prescriptionStatus, prescriptionTitle, prescriptionsKey, usePrescriptions } from "../lib/prescriptions";
import { ScreenBar } from "../components/ScreenBar";
import { Notice, Spinner } from "../components/Layout";
import { ScheduleEditor } from "../components/ScheduleEditor";
import { useCached } from "../hooks/useCached";
import { useOnline } from "../hooks/useOnline";
import { TREATMENT_KIND } from "../lib/labels";
import { describeSchedule, dosesInDays, emptyScheduleForm, formFromRule, planCourse, ruleFromForm, slotsBetween, validateScheduleForm, type ScheduleForm } from "../lib/schedule";
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
  /** Medicamento da família escolhido; nulo = cadastrar um novo com {@code newMedication}. */
  medicationId: string | null;
  newMedication: MedicationDraft | null;
}

function emptyForm(): Form {
  const now = new Date();
  return {
    personId: "", name: "", kind: "CONTINUOUS", prescribedDose: "", route: "", instructions: "",
    startAt: toLocalInput(startOfDay(now)), endMode: "NONE", endAt: "", days: "", doses: "",
    schedule: emptyScheduleForm(deviceTimezone()),
    effectiveFrom: toLocalInput(now), reason: "", medicationId: null, newMedication: null,
  };
}

function formFrom(t: TreatmentView): Form {
  return {
    personId: t.personId, name: t.name, kind: t.kind, prescribedDose: t.prescribedDose, route: t.route ?? "",
    instructions: t.instructions ?? "", startAt: toLocalInput(new Date(t.startAt)),
    endMode: t.doseCount ? "DOSES" : t.endAt ? "DATE" : "NONE",
    endAt: t.endAt ? toLocalInput(new Date(t.endAt)) : "", days: "", doses: t.doseCount ? String(t.doseCount) : "",
    schedule: formFromRule(t.schedule, deviceTimezone()),
    effectiveFrom: toLocalInput(new Date()), reason: "", medicationId: t.medicationId ?? null, newMedication: null,
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
  const medications = useMedications();
  const catalog = useCatalog();
  const [typing, setTyping] = useState(false);
  /** Início antecipado num tratamento ativo: as doses do período acrescentado já foram dadas? */
  const [pastDoses, setPastDoses] = useState<PastDoses | null>(null);
  // Receita do item: uma existente da pessoa (?receita= na tela da receita) ou uma nova.
  const [params] = useSearchParams();
  const prescriptions = usePrescriptions();
  const allTreatments = useCached(editing ? null : `treatments:${family.id}`, () => api<TreatmentView[]>(`/families/${family.id}/treatments`));
  const [prescriptionId, setPrescriptionId] = useState(params.get("receita") ?? "");
  const [newPrescription, setNewPrescription] = useState<PrescriptionDraft>({ title: "", prescriber: "", prescribedOn: "", notes: "" });
  const receitaParam = params.get("receita");
  // ?receita=<id da pessoa>: o uso eventual dela, que pode ainda não existir no servidor.
  const eventualPerson = receitaParam ? persons.data?.find((p) => p.id === receitaParam) : undefined;
  const fixedPrescription: PrescriptionView | undefined = receitaParam
    ? prescriptions.data?.find((p) => p.id === receitaParam) ?? (eventualPerson ? {
      id: eventualPerson.id, personId: eventualPerson.id, kind: "EVENTUAL", title: EVENTUAL_TITLE, prescriber: null, prescribedOn: null,
      notes: null, status: "DRAFT", items: [], createdAt: "", updatedAt: "",
    } : undefined)
    : undefined;
  // No uso eventual só entram remédios "se necessário".
  const eventualChosen = !editing && Boolean(form.personId) && prescriptionId === form.personId;
  useEffect(() => {
    if (eventualChosen && form.kind !== "AS_NEEDED") {
      setForm((f) => ({ ...f, kind: "AS_NEEDED", endMode: f.endMode === "DAYS" || f.endMode === "DOSES" ? "NONE" : f.endMode }));
    }
  }, [eventualChosen, form.kind]);
  useEffect(() => {
    if (fixedPrescription && !form.personId) setForm((f) => ({ ...f, personId: fixedPrescription.personId }));
  }, [fixedPrescription, form.personId]);
  const openPrescriptions = (prescriptions.data ?? []).filter((p) => p.personId === form.personId && p.id !== p.personId
    && prescriptionStatus((allTreatments.data ?? []).filter((t) => t.prescriptionId === p.id)) !== "ENDED");

  useEffect(() => {
    if (!stored.data || current) return;
    setCurrent(stored.data);
    setForm(formFrom(stored.data));
  }, [stored.data, current]);
  useEffect(() => { if (stored.error && !stored.data) setError(stored.error); }, [stored.error, stored.data]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  if (editing && !current && !error) return <Spinner />;

  const asNeeded = form.kind === "AS_NEEDED";
  // Ativado, não pode trocar entre "se necessário" e com horários (encerre e cadastre outro).
  const kindLocked = Boolean(current && current.status !== "DRAFT");

  function review(e: FormEvent) {
    e.preventDefault();
    const problem = asNeeded ? null : validateScheduleForm(form.schedule);
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

  /** Medicamento do tratamento: o escolhido, um da família com o mesmo nome ou um novo (criado antes, na fila). */
  async function medicationFor(): Promise<string> {
    if (form.medicationId) return form.medicationId;
    const same = (medications.data ?? []).find((m) => normalize(m.name) === normalize(form.name));
    if (same) return same.id;
    const draft = { ...(form.newMedication ?? emptyDraft()), name: form.name.trim() };
    const med = bodyFrom(draft);
    const now = new Date().toISOString();
    const created: MedicationView = { ...med, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    await mutate({
      familyId: family.id, method: "POST", path: `/families/${family.id}/medications`,
      body: { ...med, id: created.id }, label: `Novo medicamento: ${med.name}`, entityId: created.id,
      effects: [{ key: medicationsKey(family.id), op: "upsert", list: true, value: { ...created } }],
    });
    return created.id;
  }

  async function save() {
    setBusy(true);
    setError(null);
    let medicationId: string;
    try {
      medicationId = await medicationFor();
    } catch (e) {
      setError(errorMessage(e));
      setReviewing(false);
      setBusy(false);
      return;
    }
    const body = {
      medicationId,
      name: form.name.trim(), kind: form.kind, prescribedDose: form.prescribedDose.trim(),
      route: form.route.trim() || null, instructions: form.instructions.trim() || null,
      startAt: fromLocalInput(form.startAt),
      endAt: form.endMode === "DATE" && form.endAt ? fromLocalInput(form.endAt) : null,
      doseCount: !asNeeded && (form.endMode === "DAYS" || form.endMode === "DOSES") ? doseCount() : null,
      schedule: asNeeded ? null : ruleFromForm(form.schedule),
    };
    try {
      if (current) {
        // Fila offline: se outro responsável alterar antes do envio, a
        // alteração fica preservada para conferência (seção 10.2).
        await mutate({
          familyId: family.id, method: "PUT", path: `/families/${family.id}/treatments/${current.id}`,
          body: {
            ...body, baseVersion: current.version, effectiveFrom: fromLocalInput(form.effectiveFrom), reason: form.reason.trim() || null,
            pastDoses: pastDoses ?? "OPEN", deviceId,
          },
          queuedBody: { preserveConflict: true, deviceId },
          label: `Alteração do tratamento ${body.name}`,
          effects: [
            { key: `treatment:${current.id}`, op: "merge", value: { ...body, version: current.version + 1 } },
            { key: `treatments:${family.id}`, op: "merge", id: current.id, value: { ...body, version: current.version + 1 } },
          ],
        });
        navigate(`/tratamentos/${current.id}`, { replace: true });
      } else {
        // Ids gerados aqui: a receita e o tratamento já podem ser abertos e ativados offline.
        const now = new Date().toISOString();
        let receita = prescriptionId;
        if (!receita) {
          receita = crypto.randomUUID();
          const data = {
            personId: form.personId, title: newPrescription.title.trim() || null, prescriber: newPrescription.prescriber.trim() || null,
            prescribedOn: newPrescription.prescribedOn || null, notes: newPrescription.notes.trim() || null,
          };
          await mutate({
            familyId: family.id, method: "POST", path: `/families/${family.id}/prescriptions`, body: { ...data, id: receita },
            label: `Nova receita${data.title ? `: ${data.title}` : ""}`, entityId: receita,
            effects: [{ key: prescriptionsKey(family.id), op: "upsert", list: true,
              value: { ...data, id: receita, status: "DRAFT", items: [], createdAt: now, updatedAt: now } }],
          });
        }
        const created: TreatmentView = {
          ...body, id: crypto.randomUUID(), personId: form.personId, status: "DRAFT", version: 1, conflictId: null,
          createdBy: me?.id ?? "", createdAt: now, updatedBy: me?.id ?? "", updatedAt: now, prescriptionId: receita,
        };
        await mutate({
          familyId: family.id, method: "POST", path: `/families/${family.id}/treatments`,
          body: { ...body, id: created.id, personId: form.personId, prescriptionId: receita },
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
  const selected = form.medicationId ? medications.data?.find((m) => m.id === form.medicationId) : undefined;
  const familyMatches = (medications.data ?? [])
    .filter((m) => normalize(m.name).includes(normalize(form.name)) && m.id !== form.medicationId).slice(0, 5);
  const count = form.endMode === "DAYS" || form.endMode === "DOSES" ? doseCount() : null;
  const plan = reviewing && !asNeeded ? planCourse(ruleFromForm(form.schedule), new Date(form.startAt), {
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

  // Início alterado num tratamento ativo: as doses são reavaliadas (o servidor
  // cancela as em aberto antes do novo início e cria as do período antecipado).
  const now = new Date();
  const oldStart = current ? new Date(current.startAt) : null;
  const newStart = new Date(form.startAt);
  const startMoved = !asNeeded && current?.status === "ACTIVE" && oldStart !== null && oldStart.getTime() !== newStart.getTime();
  const startLater = startMoved && newStart > oldStart!;
  const startEarlier = startMoved && newStart < oldStart!;
  const gapFrom = new Date(Math.max(newStart.getTime(), now.getTime() - 30 * 86_400_000 + 5 * 60_000));
  const gapTo = new Date(Math.min(oldStart?.getTime() ?? 0, now.getTime()));
  const gapSlots = startEarlier && gapFrom < gapTo ? slotsBetween(ruleFromForm(form.schedule), newStart, gapFrom, gapTo) : [];
  const askPast = startEarlier && (gapSlots === null || gapSlots.length > 0);

  if (reviewing) {
    return (
      <div className="page">
        <ScreenBar title="Confira antes de salvar" onBack={() => setReviewing(false)} />
        <dl className="facts card">
          <dt>Pessoa</dt><dd>{person?.displayName ?? "—"}</dd>
          {!current && (
            <>
              <dt>Receita</dt>
              <dd>{eventualChosen ? EVENTUAL_TITLE : prescriptionId
                ? prescriptionTitle(prescriptions.data?.find((p) => p.id === prescriptionId), (allTreatments.data ?? []).filter((t) => t.prescriptionId === prescriptionId))
                : `Nova receita${newPrescription.title.trim() ? `: ${newPrescription.title.trim()}` : ""}`}</dd>
            </>
          )}
          <dt>Medicamento</dt>
          <dd>
            {form.name}
            {(selected || form.newMedication) && (
              <><br /><span className="muted small">{describeSubstances(selected ?? bodyFrom(form.newMedication!))}</span></>
            )}
          </dd>
          <dt>Dose (da prescrição)</dt><dd>{form.prescribedDose}</dd>
          {form.route && (<><dt>Via</dt><dd>{form.route}</dd></>)}
          {form.instructions && (<><dt>Instruções</dt><dd>{form.instructions}</dd></>)}
          <dt>Tipo</dt><dd>{TREATMENT_KIND[form.kind]}</dd>
          <dt>Agenda</dt><dd>{asNeeded ? "Sem horários: registre cada dose quando der" : describeSchedule(ruleFromForm(form.schedule))}</dd>
          <dt>{asNeeded ? "Início" : "Primeira dose"}</dt><dd>{formatWhen(fromLocalInput(form.startAt))}</dd>
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
        {startLater && (
          <Notice tone="warn">
            O início passa de {formatWhen(oldStart!.toISOString())} para {formatWhen(newStart.toISOString())}: as doses sem registro antes disso
            serão canceladas. Doses já registradas continuam no histórico.
          </Notice>
        )}
        {askPast && (
          <fieldset className="stack card">
            <legend>
              O início foi antecipado para {formatWhen(newStart.toISOString())}.{" "}
              {gapSlots === null
                ? "As doses previstas desde então já foram dadas?"
                : `${gapSlots.length === 1 ? "A dose prevista" : `As ${gapSlots.length} doses previstas`} antes do início antigo já ${gapSlots.length === 1 ? "foi dada" : "foram dadas"}?`}
            </legend>
            {gapFrom > newStart && <p className="muted small">Só entram as doses dos últimos 30 dias.</p>}
            <label className="radio">
              <input type="radio" name="past" checked={pastDoses === "ADMINISTERED"} onChange={() => setPastDoses("ADMINISTERED")} />
              Sim, foram dadas nos horários previstos (registrar como administradas)
            </label>
            <label className="radio">
              <input type="radio" name="past" checked={pastDoses === "OPEN"} onChange={() => setPastDoses("OPEN")} />
              Não sei ou nem todas: deixar para registrar uma a uma
            </label>
          </fieldset>
        )}
        {current?.status === "ACTIVE" && !asNeeded && (
          <Notice>Se a agenda, o início ou o término mudaram, as doses futuras ainda não registradas serão recalculadas. Doses passadas e registros não mudam.</Notice>
        )}
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy || (askPast && !pastDoses)} onClick={() => void save()}>Salvar</button>
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

      {!editing && fixedPrescription && (
        <p className="muted">Receita: <strong>{eventualChosen ? EVENTUAL_TITLE : prescriptionTitle(fixedPrescription, (allTreatments.data ?? []).filter((t) => t.prescriptionId === fixedPrescription.id))}</strong></p>
      )}
      {!editing && !fixedPrescription && (
        <label>
          Pessoa
          <select value={form.personId} onChange={(e) => { set({ personId: e.target.value }); setPrescriptionId(""); }} required>
            <option value="">Escolha…</option>
            {(persons.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
          {persons.data?.length === 0 && <span className="small">Cadastre as pessoas na aba Família.</span>}
        </label>
      )}
      {!editing && !fixedPrescription && form.personId && (
        <fieldset className="stack">
          <legend>Receita</legend>
          <label>
            Incluir em
            <select value={prescriptionId} onChange={(e) => setPrescriptionId(e.target.value)}>
              <option value="">Nova receita</option>
              <option value={form.personId}>{EVENTUAL_TITLE} (sem receita, "se necessário")</option>
              {openPrescriptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {prescriptionTitle(p, (allTreatments.data ?? []).filter((t) => t.prescriptionId === p.id))}
                </option>
              ))}
            </select>
          </label>
          {eventualChosen && (
            <span className="muted small">Para remédios que a pessoa pode tomar quando precisar. Se uma receita ativa tiver o mesmo medicamento, vale a da receita.</span>
          )}
          {!prescriptionId && (
            <details>
              <summary>Dados da receita (título, quem prescreveu, data)</summary>
              <div className="stack">
                <PrescriptionFields value={newPrescription} onChange={setNewPrescription} />
              </div>
            </details>
          )}
        </fieldset>
      )}
      <label>
        Medicamento
        <input value={form.name} required maxLength={200} placeholder="Ex.: Tylenol, Amoxicilina"
          onFocus={() => setTyping(true)} onBlur={() => setTimeout(() => setTyping(false), 150)}
          onChange={(e) => {
            const same = (medications.data ?? []).find((m) => normalize(m.name) === normalize(e.target.value));
            set({ name: e.target.value, medicationId: same?.id ?? null });
          }} />
        <span className="muted small">Escolha um medicamento já cadastrado ou digite um novo: o app sugere do catálogo da ANVISA.</span>
      </label>
      {typing && form.name.trim().length >= 2 && (
        <>
          {familyMatches.length > 0 && (
            <div className="suggestions" role="group" aria-label="Medicamentos da família">
              <span className="muted small">Já cadastrados</span>
              {familyMatches.map((m) => (
                <button key={m.id} type="button" className="suggestion" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { set({ name: m.name, medicationId: m.id, newMedication: null }); setTyping(false); }}>
                  <strong>{m.name}</strong>
                  <span className="muted small">{[describeSubstances(m), m.form].filter(Boolean).join(" · ")}</span>
                </button>
              ))}
            </div>
          )}
          <CatalogSuggestions items={catalog} query={form.name} onPick={(item) => {
            const draft = draftFromCatalog(item, form.newMedication ?? undefined);
            const same = (medications.data ?? []).find((m) => normalize(m.name) === normalize(draft.name));
            set({ name: draft.name, medicationId: same?.id ?? null, newMedication: same ? null : draft });
            setTyping(false);
          }} />
        </>
      )}
      {selected && (
        <p className="muted small" data-testid="medication-summary">
          {[describeSubstances(selected), selected.form, selected.manufacturer].filter(Boolean).join(" · ") || "Medicamento cadastrado"}
        </p>
      )}
      {!selected && form.name.trim() && (
        <fieldset className="stack card">
          <legend>Novo medicamento: {form.name.trim()}</legend>
          <MedicationFields value={form.newMedication ?? emptyDraft(form.name)} catalog={catalog}
            familySubstances={(medications.data ?? []).flatMap((m) => m.substances.map((s) => s.substance))}
            onChange={(newMedication) => set({ newMedication })} />
          <span className="muted small">Fica salvo em Medicamentos para usar em outros tratamentos.</span>
        </fieldset>
      )}
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
        Tipo de tratamento
        <select value={form.kind} onChange={(e) => {
          const kind = e.target.value as TreatmentKind;
          // "Se necessário" não tem término por dias ou doses.
          set({ kind, endMode: kind === "AS_NEEDED" && (form.endMode === "DAYS" || form.endMode === "DOSES") ? "NONE" : form.endMode });
        }}>
          {(!kindLocked || !asNeeded) && !eventualChosen && <option value="CONTINUOUS">{TREATMENT_KIND.CONTINUOUS}</option>}
          {(!kindLocked || !asNeeded) && !eventualChosen && <option value="OCCASIONAL">{TREATMENT_KIND.OCCASIONAL}</option>}
          {(!kindLocked || asNeeded) && <option value="AS_NEEDED">{TREATMENT_KIND.AS_NEEDED}</option>}
        </select>
        {asNeeded && <span className="muted small">Para remédios dados só quando precisa (ex.: paracetamol se febre). Sem lembretes: registre cada dose quando der.</span>}
      </label>
      <label>
        {asNeeded ? "Quando dar (como na receita)" : "Instruções"} <span className="muted small">(opcional)</span>
        <textarea value={form.instructions} onChange={(e) => set({ instructions: e.target.value })} maxLength={4000} rows={3}
          placeholder={asNeeded ? "Ex.: se febre acima de 37,8 °C, no máximo de 6 em 6 horas" : undefined} />
        {asNeeded && <span className="muted small">Aparece ao lado da última dose. O app não calcula quando a próxima pode ser dada.</span>}
      </label>
      {!asNeeded && <ScheduleEditor value={form.schedule} onChange={(schedule) => set({ schedule })} />}
      <label>
        {asNeeded ? "Início (data e hora)" : "Primeira dose (data e hora)"}
        <input type="datetime-local" value={form.startAt} onChange={(e) => set({ startAt: e.target.value })} required />
        {!asNeeded && <span className="muted small">Já em andamento? Informe a primeira dose de fato: as anteriores a agora contam no total.</span>}
      </label>
      <fieldset className="stack">
        <legend>Término</legend>
        <div className="chips" role="radiogroup" aria-label="Término">
          {END_MODES.filter((m) => !asNeeded || m.value === "NONE" || m.value === "DATE").map((m) => (
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
      <div className="form-actions">
        <button className="btn btn-primary">Conferir</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancelar</button>
      </div>
    </form>
  );
}
