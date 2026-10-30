import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { errorMessage } from "../api/client";
import type { MedicationView } from "../api/types";
import { Notice, Spinner } from "../components/Layout";
import { bodyFrom, CatalogSuggestions, draftFrom, draftFromCatalog, emptyDraft, MedicationFields, useCatalog, type MedicationDraft } from "../components/MedicationFields";
import { ScreenBar } from "../components/ScreenBar";
import { mutate } from "../sync/outbox";
import { useFamily, useSession } from "../session";
import { medicationsKey, useMedications } from "./MedicationsPage";

/** Cadastro e alteração de um medicamento da família, com sugestões do catálogo da ANVISA. */
export function MedicationFormPage() {
  const { id } = useParams();
  const family = useFamily();
  const { me } = useSession();
  const navigate = useNavigate();
  const medications = useMedications();
  const catalog = useCatalog();
  const current = id ? medications.data?.find((m) => m.id === id) : undefined;
  const [draft, setDraft] = useState<MedicationDraft>(emptyDraft);
  const [loaded, setLoaded] = useState(!id);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (current && !loaded) {
      setDraft(draftFrom(current));
      setLoaded(true);
    }
  }, [current, loaded]);

  if (id && !loaded) return medications.loading ? <Spinner /> : <div className="page"><Notice tone="error">Medicamento não encontrado.</Notice></div>;

  const familySubstances = (medications.data ?? []).flatMap((m) => m.substances.map((s) => s.substance));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = bodyFrom(draft);
    try {
      if (current) {
        await mutate({
          familyId: family.id, method: "PUT", path: `/families/${family.id}/medications/${current.id}`, body,
          label: `Alteração do medicamento ${body.name}`, entityId: current.id,
          effects: [{ key: medicationsKey(family.id), op: "merge", id: current.id, value: { ...body } }],
        });
      } else {
        const now = new Date().toISOString();
        const created: MedicationView = { ...body, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
        await mutate({
          familyId: family.id, method: "POST", path: `/families/${family.id}/medications`,
          body: { ...body, id: created.id }, label: `Novo medicamento: ${body.name}`, entityId: created.id,
          effects: [{ key: medicationsKey(family.id), op: "upsert", list: true, value: { ...created, createdBy: me?.id } }],
        });
      }
      navigate("/medicamentos", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="page stack" onSubmit={save}>
      <ScreenBar title={current ? "Alterar medicamento" : "Novo medicamento"} />
      {error && <Notice tone="error">{error}</Notice>}
      <label>
        Nome do medicamento
        <input value={draft.name} required maxLength={200} placeholder="Ex.: Tylenol, Amoxicilina"
          onFocus={() => setTyping(true)} onBlur={() => setTimeout(() => setTyping(false), 150)}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <span className="muted small">Comercial ou genérico, como vocês chamam. Ao digitar, o app sugere do catálogo da ANVISA.</span>
      </label>
      {typing && <CatalogSuggestions items={catalog} query={draft.name} onPick={(item) => { setDraft(draftFromCatalog(item, draft)); setTyping(false); }} />}
      {draft.category && <p className="muted small">Categoria na ANVISA: {draft.category}</p>}
      <MedicationFields value={draft} onChange={setDraft} catalog={catalog} familySubstances={familySubstances} />
      <label>
        Observações <span className="muted small">(opcional)</span>
        <textarea value={draft.notes} maxLength={2000} rows={2} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
      </label>
      <div className="row">
        <button className="btn btn-primary" disabled={busy || !draft.name.trim()}>Salvar</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancelar</button>
      </div>
    </form>
  );
}
