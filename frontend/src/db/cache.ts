import { OfflineError } from "../api/client";
import { db } from "./db";

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
