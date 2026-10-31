import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, OfflineError } from "../api/client";
import { applyLocal, cached } from "../db/cache";
import { db } from "../db/db";
import { onOutboxChange } from "../sync/outbox";

export interface CachedState<T> {
  data: T | undefined;
  fresh: boolean;
  savedAt: number | null;
  loading: boolean;
  error: string | null;
  reload(): Promise<void>;
}

/**
 * Lê da API com cópia offline e aplica por cima as gravações deste aparelho
 * ainda não enviadas (o que foi feito offline aparece na hora). Recarrega
 * quando a fila muda (ex.: um registro offline foi enviado).
 */
export function useCached<T>(key: string | null, fetcher: () => Promise<T>): CachedState<T> {
  const [state, setState] = useState<Omit<CachedState<T>, "reload">>({
    data: undefined, fresh: true, savedAt: null, loading: true, error: null,
  });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // Recargas podem se sobrepor (a fila muda enquanto uma busca está no ar): só
  // a mais recente vale, para uma resposta antiga não apagar um registro novo.
  const latest = useRef(0);

  const reload = useCallback(async () => {
    if (!key) return;
    const run = ++latest.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const result = await cached(key, () => fetcherRef.current());
      const items = await db.outbox.orderBy("createdAt").toArray();
      if (run !== latest.current) return;
      setState({ data: applyLocal(key, result.data, items), fresh: result.fresh, savedAt: result.savedAt, loading: false, error: null });
    } catch (error) {
      if (error instanceof OfflineError) {
        // Nada guardado desta consulta, mas pode haver um cadastro feito offline.
        const local = applyLocal<T>(key, undefined, await db.outbox.orderBy("createdAt").toArray());
        if (run !== latest.current) return;
        if (local !== undefined) {
          setState({ data: local, fresh: false, savedAt: null, loading: false, error: null });
          return;
        }
      }
      if (run !== latest.current) return;
      setState((s) => ({ ...s, loading: false, error: errorMessage(error) }));
    }
  }, [key]);

  useEffect(() => {
    setState({ data: undefined, fresh: true, savedAt: null, loading: true, error: null });
    void reload();
  }, [reload]);

  useEffect(() => onOutboxChange(() => void reload()), [reload]);

  return { ...state, reload };
}
