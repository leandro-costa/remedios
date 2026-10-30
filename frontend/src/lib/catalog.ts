import { api, ApiError } from "../api/client";
import { db } from "../db/db";

/** Medicamento registrado na ANVISA: nome, substâncias (separadas por vírgula), fabricante e categoria. */
export interface CatalogItem {
  name: string;
  substances: string[];
  manufacturer: string | null;
  category: string | null;
}

interface Stored {
  version: string | null;
  items: [string, string | null, string | null, string | null][];
}

const KEY = "anvisa-catalog";
let loaded: Promise<CatalogItem[]> | null = null;

/** Sem acentos e em minúsculas, para buscar "dipirona" em "Dipirona Monoidratada". */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function toItems(stored: Stored | undefined): CatalogItem[] {
  return (stored?.items ?? []).map(([name, substances, manufacturer, category]) => ({
    name, manufacturer, category,
    substances: substances ? substances.split(",").map((s) => s.trim()).filter(Boolean) : [],
  }));
}

/**
 * Catálogo guardado no aparelho (funciona sem conexão). Uma vez por sessão,
 * pergunta ao servidor se há versão nova e só baixa quando mudou.
 */
export function loadCatalog(): Promise<CatalogItem[]> {
  loaded ??= (async () => {
    const entry = await db.cache.get(KEY);
    const local = entry?.value as Stored | undefined;
    try {
      const remote = await api<Stored>("/catalog/medications", {
        headers: local?.version ? { "If-None-Match": `"${local.version}"` } : undefined,
      });
      if (remote?.items?.length) {
        await db.cache.put({ key: KEY, value: remote, savedAt: Date.now() });
        return toItems(remote);
      }
    } catch (e) {
      // 304: o guardado já é o atual. Sem conexão: fica o guardado.
      if (!(e instanceof ApiError && e.status === 304)) loaded = null;
    }
    const items = toItems(local);
    // Ainda sem catálogo (servidor recém-instalado): tenta de novo na próxima vez.
    if (items.length === 0) loaded = null;
    return items;
  })();
  return loaded;
}

/** Até {@code limit} itens: nomes que começam com o texto primeiro, depois os que contêm (nome ou substância). */
export function searchCatalog(items: CatalogItem[], query: string, limit = 8): CatalogItem[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const starts: CatalogItem[] = [];
  const contains: CatalogItem[] = [];
  for (const item of items) {
    const name = normalize(item.name);
    if (name.startsWith(q)) starts.push(item);
    else if (name.includes(q) || item.substances.some((s) => normalize(s).includes(q))) contains.push(item);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

/** Substâncias conhecidas (catálogo + as já usadas na família) que começam com o texto. */
export function searchSubstances(items: CatalogItem[], extra: string[], query: string, limit = 6): string[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...extra, ...items.flatMap((i) => i.substances)]) {
    const n = normalize(s);
    if (n.startsWith(q) && !seen.has(n)) {
      seen.add(n);
      out.push(s);
      if (out.length >= limit) break;
    }
  }
  return out;
}
