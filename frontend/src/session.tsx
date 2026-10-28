import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, OfflineError, setTokenProvider } from "./api/client";
import type { FamilyView, UserView } from "./api/types";
import type { AuthBackend, AuthUser } from "./auth";
import { cached, clearLocalData } from "./db/cache";
import { ensureDeviceRegistered, forgetDeviceRegistration } from "./sync/device";
import { startAutoFlush } from "./sync/outbox";
import { syncPush } from "./sync/push";

const FAMILY_KEY = "remedios.familyId";

export interface Session {
  auth: AuthBackend;
  user: AuthUser | null;
  /** Conta local na API (criada no primeiro acesso). */
  me: UserView | null;
  families: FamilyView[];
  family: FamilyView | null;
  deviceId: string | null;
  loading: boolean;
  error: string | null;
  selectFamily(id: string): void;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession fora de SessionProvider");
  return session;
}

/** Sessão com família escolhida (telas internas). */
export function useFamily(): FamilyView {
  const { family } = useSession();
  if (!family) throw new Error("Nenhuma família selecionada");
  return family;
}

export function SessionProvider({ auth, children }: { auth: AuthBackend; children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [me, setMe] = useState<UserView | null>(null);
  const [families, setFamilies] = useState<FamilyView[]>([]);
  const [familyId, setFamilyId] = useState<string | null>(() => localStorage.getItem(FAMILY_KEY));
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTokenProvider(() => auth.token());
    return auth.onChange(setUser);
  }, [auth]);

  const load = useCallback(async (current: AuthUser) => {
    setError(null);
    try {
      const [meResult, familiesResult] = await Promise.all([
        cached(`me:${current.uid}`, () => api<UserView>("/me")),
        cached(`families:${current.uid}`, () => api<FamilyView[]>("/families")),
      ]);
      setMe(meResult.data);
      setFamilies(familiesResult.data);
      try {
        const id = await ensureDeviceRegistered(meResult.data.id);
        setDeviceId(id);
        void syncPush(id);
      } catch (e) {
        if (!(e instanceof OfflineError)) throw e;
        setDeviceId(localStorage.getItem("remedios.deviceId"));
      }
    } catch (e) {
      setError(e instanceof OfflineError
        ? "Sem conexão e sem dados guardados neste aparelho. Conecte-se para entrar pela primeira vez."
        : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user === undefined) return;
    if (user === null) {
      setMe(null);
      setFamilies([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void load(user);
    return startAutoFlush();
  }, [user, load]);

  const family = families.find((f) => f.id === familyId) ?? families[0] ?? null;

  const value = useMemo<Session>(() => ({
    auth,
    user: user ?? null,
    me,
    families,
    family,
    deviceId,
    loading: loading || user === undefined,
    error,
    selectFamily(id) {
      localStorage.setItem(FAMILY_KEY, id);
      setFamilyId(id);
    },
    async refresh() {
      if (user) await load(user);
    },
    async signOut() {
      await clearLocalData();
      forgetDeviceRegistration();
      localStorage.removeItem(FAMILY_KEY);
      await auth.signOut();
    },
  }), [auth, user, me, families, family, deviceId, loading, error, load]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
