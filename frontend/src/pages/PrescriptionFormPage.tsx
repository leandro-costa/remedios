import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { errorMessage } from "../api/client";
import { Notice, Spinner } from "../components/Layout";
import { ScreenBar } from "../components/ScreenBar";
import { prescriptionsKey, usePrescriptions } from "../lib/prescriptions";
import { mutate } from "../sync/outbox";
import { useFamily } from "../session";

/** Dados da receita: título, quem prescreveu, data e observações. */
export function PrescriptionFormPage() {
  const { id } = useParams();
  const family = useFamily();
  const navigate = useNavigate();
  const prescriptions = usePrescriptions();
  const current = prescriptions.data?.find((p) => p.id === id);
  const [form, setForm] = useState({ title: "", prescriber: "", prescribedOn: "", notes: "" });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (current && !loaded) {
      setForm({ title: current.title ?? "", prescriber: current.prescriber ?? "", prescribedOn: current.prescribedOn ?? "", notes: current.notes ?? "" });
      setLoaded(true);
    }
  }, [current, loaded]);
  if (!current) return prescriptions.loading ? <Spinner /> : <div className="page"><Notice tone="error">Receita não encontrada.</Notice></div>;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      personId: current!.personId, title: form.title.trim() || null, prescriber: form.prescriber.trim() || null,
      prescribedOn: form.prescribedOn || null, notes: form.notes.trim() || null,
    };
    try {
      await mutate({
        familyId: family.id, method: "PUT", path: `/families/${family.id}/prescriptions/${current!.id}`, body,
        label: "Alteração da receita", entityId: current!.id,
        effects: [{ key: prescriptionsKey(family.id), op: "merge", id: current!.id, value: { ...body } }],
      });
      navigate(`/receitas/${current!.id}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="page stack" onSubmit={save}>
      <ScreenBar title="Dados da receita" />
      {error && <Notice tone="error">{error}</Notice>}
      <PrescriptionFields value={form} onChange={setForm} />
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy}>Salvar</button>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Cancelar</button>
      </div>
    </form>
  );
}

export interface PrescriptionDraft {
  title: string;
  prescriber: string;
  prescribedOn: string;
  notes: string;
}

export function PrescriptionFields({ value, onChange }: { value: PrescriptionDraft; onChange: (v: PrescriptionDraft) => void }) {
  const set = (patch: Partial<PrescriptionDraft>) => onChange({ ...value, ...patch });
  return (
    <>
      <label>
        Título da receita <span className="muted small">(opcional)</span>
        <input value={value.title} maxLength={200} placeholder="Ex.: Infecção de garganta" onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label>
        Quem prescreveu <span className="muted small">(opcional)</span>
        <input value={value.prescriber} maxLength={200} placeholder="Ex.: Dra. Lima" onChange={(e) => set({ prescriber: e.target.value })} />
      </label>
      <label>
        Data da receita <span className="muted small">(opcional)</span>
        <input type="date" value={value.prescribedOn} onChange={(e) => set({ prescribedOn: e.target.value })} />
      </label>
      <label>
        Observações da receita <span className="muted small">(opcional)</span>
        <textarea value={value.notes} maxLength={2000} rows={2} onChange={(e) => set({ notes: e.target.value })} />
      </label>
    </>
  );
}
