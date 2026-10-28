import type { AuthBackend } from "./types";

export type { AuthBackend, AuthUser } from "./types";

/** Carrega o login configurado. O modo local não entra no build do Firebase. */
export async function loadAuth(): Promise<AuthBackend> {
  if (__AUTH_MODE__ === "local") {
    return (await import("./local")).createLocalAuth();
  }
  return (await import("./firebase")).createFirebaseAuth();
}
