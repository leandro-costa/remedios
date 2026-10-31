import { OfflineError } from "../api/client";
import { db, type Effect, type OutboxItem } from "./db";

export interface Cached<T> {
  data: T;
  /** false: veio do aparelho porque o servidor não respondeu. */
  fresh: boolean;
  savedAt: number;
}

/**
 * Busca na API e guarda o resultado; sem conexão, devolve a última versão
 * guardada (seção 1.2: transparência offline — a tela avisa que pode estar
 * desatualizada).
 */
export async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<Cached<T>> {
  try {
    const data = await fetcher();
    const savedAt = Date.now();
    await db.cache.put({ key, value: data, savedAt });
    return { data, fresh: true, savedAt };
  } catch (error) {
    if (error instanceof OfflineError) {
      const entry = await db.cache.get(key);
      if (entry) return { data: entry.value as T, fresh: false, savedAt: entry.savedAt };
    }
    throw error;
  }
}

/** Apaga os dados guardados (ao sair da conta). */
export async function clearLocalData() {
  await db.cache.clear();
  await db.outbox.clear();
}

/** Marca de um registro que ainda está só neste aparelho. */
export interface LocalMark {
  _pending?: boolean;
}

export function isPending(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as LocalMark)._pending === true;
}

type Row = Record<string, unknown>;

/** Membros são identificados por userId; os demais registros, por id. */
const rowId = (r: Row) => r.id ?? r.userId;

function matches(effect: Effect, key: string) {
  return effect.prefix ? key.startsWith(effect.key) : effect.key === key;
}

/**
 * Aplica sobre os dados de uma consulta as gravações deste aparelho ainda
 * não confirmadas, na ordem em que foram feitas. Sem dados guardados (nunca
 * consultado), a consulta passa a existir se alguma gravação a cria.
 */
export function applyLocal<T>(key: string, base: T | undefined, items: OutboxItem[]): T | undefined {
  let data: unknown = base;
  for (const item of items) {
    if (item.state !== "pending") continue;
    for (const effect of item.effects ?? []) {
      if (matches(effect, key)) data = applyEffect(data, effect);
    }
  }
  return data as T | undefined;
}

/**
 * Registro confirmado pelo servidor: os efeitos passam para a cópia guardada,
 * sem a marca de pendente. Assim ele não some se a conexão cair antes de a
 * tela buscar os dados de novo.
 */
export async function commitEffects(effects: Effect[]): Promise<void> {
  if (effects.length === 0) return;
  const entries = await db.cache.toArray();
  for (const entry of entries) {
    const mine = effects.filter((e) => matches(e, entry.key));
    if (mine.length === 0) continue;
    const value = mine.reduce((data, e) => applyEffect(data, e, false), entry.value);
    await db.cache.put({ ...entry, value });
  }
}

function applyEffect(data: unknown, effect: Effect, pending = true): unknown {
  const mark = pending ? { _pending: true } : {};
  if (Array.isArray(data) || (data === undefined && effect.op === "upsert" && effect.list)) {
    const rows = (data ?? []) as Row[];
    switch (effect.op) {
      case "upsert": {
        const id = rowId(effect.value);
        const found = rows.some((r) => rowId(r) === id);
        const value = { ...effect.value, ...mark };
        return found ? rows.map((r) => (rowId(r) === id ? { ...r, ...value } : r)) : [...rows, value];
      }
      case "merge":
        return rows.map((r) => (rowId(r) === effect.id ? { ...r, ...effect.value, ...mark } : r));
      case "remove":
        return rows.filter((r) => rowId(r) !== effect.id);
    }
  }
  switch (effect.op) {
    case "upsert":
      return { ...((data as Row) ?? {}), ...effect.value, ...mark };
    case "merge":
      return data === undefined ? undefined : { ...(data as Row), ...effect.value, ...mark };
    case "remove":
      return data;
  }
}
