export type AuthMode = "firebase" | "local";

export const config = {
  authMode: __AUTH_MODE__ as AuthMode,
  firebase: {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "remedios-local",
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
  },
};
