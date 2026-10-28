/// <reference types="vite/client" />

/** Definido no build (vite.config.ts). */
declare const __AUTH_MODE__: "firebase" | "local";

interface ImportMetaEnv {
  /** "firebase" (padrão) ou "local" (desenvolvimento, chave de teste). */
  readonly VITE_AUTH_MODE?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
