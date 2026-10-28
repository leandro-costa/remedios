import { initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { config } from "../config";
import type { AuthBackend, AuthUser } from "./types";

function toUser(user: User | null): AuthUser | null {
  return user && { uid: user.uid, name: user.displayName, email: user.email };
}

/** Mensagens do Firebase em português. */
function translate(error: unknown): Error {
  const code = (error as { code?: string }).code ?? "";
  const messages: Record<string, string> = {
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/user-not-found": "E-mail ou senha incorretos.",
    "auth/email-already-in-use": "Já existe uma conta com este e-mail.",
    "auth/weak-password": "Use uma senha com pelo menos 6 caracteres.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/network-request-failed": "Sem conexão. O login precisa de internet.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente de novo.",
    "auth/popup-closed-by-user": "Login cancelado.",
    "auth/cancelled-popup-request": "Login cancelado.",
    // Erros de configuração: dizem a quem instala o que ajustar no Firebase.
    "auth/unauthorized-domain":
      `Este endereço (${location.hostname}) não está autorizado no Firebase: adicione-o em Authentication → Configurações → Domínios autorizados.`,
    "auth/operation-not-allowed":
      "Este tipo de login não está ativado no Firebase: ative-o em Authentication → Método de login.",
    "auth/invalid-api-key": "A chave do Firebase (VITE_FIREBASE_API_KEY) está errada ou vazia no .env.",
    "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
      "A chave do Firebase (VITE_FIREBASE_API_KEY) está errada ou vazia no .env.",
    "auth/configuration-not-found":
      "O projeto do Firebase não foi encontrado: confira FIREBASE_PROJECT_ID e VITE_FIREBASE_* no .env.",
  };
  if (!messages[code]) console.error("Falha no login do Firebase", error);
  return new Error(messages[code] ?? `Não foi possível entrar. Tente novamente.${code ? ` (${code})` : ""}`);
}

export function createFirebaseAuth(): AuthBackend {
  const app = initializeApp(config.firebase);
  const auth = getAuth(app);
  auth.languageCode = "pt-BR";

  return {
    mode: "firebase",
    onChange: (listener) => onIdTokenChanged(auth, (user) => listener(toUser(user))),
    token: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
    signOut: () => signOut(auth),
    async signInWithGoogle() {
      const provider = new GoogleAuthProvider();
      try {
        await signInWithPopup(auth, provider);
      } catch (error) {
        // Em PWA instalado (sobretudo no iPhone) o popup pode ser bloqueado.
        if ((error as { code?: string }).code === "auth/popup-blocked") {
          await signInWithRedirect(auth, provider);
          return;
        }
        throw translate(error);
      }
    },
    async signInWithEmail(email, password) {
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (error) {
        throw translate(error);
      }
    },
    async signUpWithEmail(name, email, password) {
      try {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(credential.user, { displayName: name });
        await credential.user.getIdToken(true);
      } catch (error) {
        throw translate(error);
      }
    },
    async resetPassword(email) {
      try {
        await sendPasswordResetEmail(auth, email);
      } catch (error) {
        throw translate(error);
      }
    },
  };
}
