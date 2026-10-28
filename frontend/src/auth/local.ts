// Modo local, só para desenvolvimento: gera tokens no formato do Firebase
// assinados com a chave de TESTE do repositório (a mesma de
// scripts/token-local.sh). Este arquivo só entra no build quando
// VITE_AUTH_MODE=local; nunca use esse build em produção.
import privateKeyPem from "../../../backend/src/test/resources/privateKey.pem?raw";
import { config } from "../config";
import type { AuthBackend, AuthUser } from "./types";

const STORAGE_KEY = "remedios.localUser";

function base64Url(data: ArrayBuffer | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signingKey(): Promise<CryptoKey> {
  // O navegador só libera a criptografia em endereço seguro (localhost ou HTTPS).
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      `O modo local só funciona em endereço seguro. Abra http://localhost${location.port ? `:${location.port}` : ""} ` +
      "no computador que roda o Docker, ou use HTTPS.",
    );
  }
  const body = privateKeyPem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

export async function localToken(user: AuthUser, projectId: string, now = Math.floor(Date.now() / 1000)) {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: `https://securetoken.google.com/${projectId}`,
      aud: projectId,
      sub: user.uid,
      user_id: user.uid,
      name: user.name,
      auth_time: now,
      iat: now,
      exp: now + 3600,
    }),
  );
  const key = await signingKey();
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(signature)}`;
}

export function createLocalAuth(): AuthBackend {
  const listeners = new Set<(user: AuthUser | null) => void>();
  let cached: { token: string; expires: number } | null = null;
  const read = (): AuthUser | null => {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  };
  const emit = () => listeners.forEach((l) => l(read()));

  return {
    mode: "local",
    onChange(listener) {
      listeners.add(listener);
      listener(read());
      return () => listeners.delete(listener);
    },
    async token() {
      const user = read();
      if (!user) return null;
      if (!cached || cached.expires < Date.now() + 60_000) {
        cached = { token: await localToken(user, config.firebase.projectId), expires: Date.now() + 3_600_000 };
      }
      return cached.token;
    },
    async signOut() {
      localStorage.removeItem(STORAGE_KEY);
      cached = null;
      emit();
    },
    async signInLocal(name) {
      const uid = "local-" + name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-");
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ uid, name, email: null }));
      cached = null;
      emit();
    },
  };
}
