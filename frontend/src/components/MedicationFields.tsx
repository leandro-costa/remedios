import { useEffect, useState } from "react";
import type { MedicationView, SubstanceView } from "../api/types";
import { loadCatalog, searchCatalog, searchSubstances, type CatalogItem } from "../lib/catalog";

/** Medicamento em edição (cadastro próprio ou dentro do tratamento). */
export interface MedicationDraft {
  name: string;
  form: string;
  manufacturer: string;
  category: string;
  notes: string;
  substances: { substance: string; concentration: string }[];
}

export const FORMS = [
  "Comprimido", "Comprimido revestido", "Cápsula", "Drágea", "Gotas", "Solução oral", "Suspensão oral", "Xarope",
  "Pó para suspensão", "Pomada", "Creme", "Gel", "Spray nasal", "Colírio", "Injetável", "Supositório", "Adesivo",
  "Aerossol (bombinha)",
];

export function emptyDraft(name = ""): MedicationDraft {
  return { name, form: "", manufacturer: "", category: "", notes: "", substances: [{ substance: "", concentration: "" }] };
}

export function draftFrom(m: MedicationView): MedicationDraft {
  return {
    name: m.name, form: m.form ?? "", manufacturer: m.manufacturer ?? "", category: m.category ?? "", notes: m.notes ?? "",
    substances: m.substances.length
      ? m.substances.map((s) => ({ substance: s.substance, concentration: s.concentration ?? "" }))
      : [{ substance: "", concentration: "" }],
  };
}

/** "TYLENOL SINUS" → "Tylenol Sinus" (o catálogo da ANVISA vem em maiúsculas). */
export function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Preenche com um item do catálogo: nome, substâncias e fabricante. A concentração fica para a pessoa. */
export function draftFromCatalog(item: CatalogItem, current?: MedicationDraft): MedicationDraft {
  return {
    ...(current ?? emptyDraft()),
    name: titleCase(item.name),
    manufacturer: item.manufacturer ? titleCase(item.manufacturer) : "",
    category: item.category ?? "",
    substances: item.substances.length
      ? item.substances.map((s) => ({ substance: s, concentration: "" }))
      : [{ substance: "", concentration: "" }],
  };
}

export function bodyFrom(d: MedicationDraft) {
  return {
    name: d.name.trim(), form: d.form.trim() || null, manufacturer: d.manufacturer.trim() || null,
    category: d.category.trim() || null, notes: d.notes.trim() || null,
    substances: d.substances.filter((s) => s.substance.trim())
      .map((s): SubstanceView => ({ substance: s.substance.trim(), concentration: s.concentration.trim() || null })),
  };
}

export function useCatalog(): CatalogItem[] {
  const [items, setItems] = useState<CatalogItem[]>([]);
  useEffect(() => { void loadCatalog().then(setItems); }, []);
  return items;
}

/** Sugestões do catálogo da ANVISA para o nome digitado. */
export function CatalogSuggestions({ items, query, onPick }: {
  items: CatalogItem[]; query: string; onPick: (item: CatalogItem) => void;
}) {
  const found = searchCatalog(items, query);
  if (found.length === 0) return null;
  return (
    <div className="suggestions" role="group" aria-label="Sugestões do catálogo da ANVISA">
      <span className="muted small">Catálogo da ANVISA</span>
      {found.map((item, i) => (
        <button key={`${item.name}-${item.manufacturer}-${i}`} type="button" className="suggestion" onClick={() => onPick(item)}>
          <strong>{titleCase(item.name)}</strong>
          <span className="muted small">
            {item.substances.join(" + ") || "sem substância informada"}
            {item.manufacturer ? ` · ${titleCase(item.manufacturer)}` : ""}{item.category ? ` · ${item.category}` : ""}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Forma, fabricante e substâncias com a concentração do rótulo. O nome fica
 * com quem usa o componente (no tratamento, ele também escolhe o medicamento).
 */
export function MedicationFields({ value, onChange, catalog, familySubstances = [] }: {
  value: MedicationDraft; onChange: (d: MedicationDraft) => void; catalog: CatalogItem[]; familySubstances?: string[];
}) {
  const [focused, setFocused] = useState<number | null>(null);
  const set = (patch: Partial<MedicationDraft>) => onChange({ ...value, ...patch });
  const setSubstance = (i: number, patch: Partial<MedicationDraft["substances"][number]>) =>
    set({ substances: value.substances.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <div className="stack">
      <fieldset className="stack">
        <legend>Substâncias (princípios ativos)</legend>
        {value.substances.map((s, i) => (
          <div key={i} className="stack">
            <div className="row wrap">
              <label className="grow">
                {`Substância ${i + 1}`}
                <input value={s.substance} maxLength={200} placeholder="Ex.: paracetamol"
                  onFocus={() => setFocused(i)} onBlur={() => setTimeout(() => setFocused(null), 150)}
                  onChange={(e) => setSubstance(i, { substance: e.target.value })} />
              </label>
              <label>
                {`Concentração ${i + 1}`}
                <input className="short" value={s.concentration} maxLength={100} placeholder="Ex.: 750 mg"
                  onChange={(e) => setSubstance(i, { concentration: e.target.value })} />
              </label>
              {value.substances.length > 1 && (
                <button type="button" className="btn btn-small" aria-label={`Remover substância ${i + 1}`}
                  onClick={() => set({ substances: value.substances.filter((_, j) => j !== i) })}>Remover</button>
              )}
            </div>
            {focused === i && (
              <div className="suggestions" role="group" aria-label="Substâncias conhecidas">
                {searchSubstances(catalog, familySubstances, s.substance).map((name) => (
                  <button key={name} type="button" className="suggestion" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setSubstance(i, { substance: name }); setFocused(null); }}>{name}</button>
                ))}
              </div>
            )}
          </div>
        ))}
        <button type="button" className="btn btn-small" onClick={() => set({ substances: [...value.substances, { substance: "", concentration: "" }] })}>
          + Adicionar substância
        </button>
        <span className="muted small">Concentração como no rótulo ou na receita. O app não calcula nem compara doses.</span>
      </fieldset>
      <label>
        Forma farmacêutica <span className="muted small">(opcional)</span>
        <input list="formas" value={value.form} maxLength={100} onChange={(e) => set({ form: e.target.value })} placeholder="Ex.: comprimido, gotas" />
        <datalist id="formas">{FORMS.map((f) => <option key={f} value={f} />)}</datalist>
      </label>
      <label>
        Fabricante / laboratório <span className="muted small">(opcional)</span>
        <input value={value.manufacturer} maxLength={200} onChange={(e) => set({ manufacturer: e.target.value })} />
      </label>
    </div>
  );
}
