import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../api/client";
import { cached } from "../db/cache";
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
 * Lê da API com cópia offline. Recarrega quando a fila de registros muda
 * (ex.: um registro offline foi enviado).
 */
export function useCached<T>(key: string | null, fetcher: () => Promise<T>): CachedState<T> {
  const [state, setState] = useState<Omit<CachedState<T>, "reload">>({
    data: undefined, fresh: true, savedAt: null, loading: true, error: null,
  });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async () => {
    if (!key) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const result = await cached(key, () => fetcherRef.current());
      setState({ data: result.data, fresh: result.fresh, savedAt: result.savedAt, loading: false, error: null });
    } catch (error) {
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
