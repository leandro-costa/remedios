export interface AuthUser {
  uid: string;
  name: string | null;
  email: string | null;
}

/** Login do app: Firebase Authentication ou, em desenvolvimento, o modo local. */
export interface AuthBackend {
  readonly mode: "firebase" | "local";
  onChange(listener: (user: AuthUser | null) => void): () => void;
  token(): Promise<string | null>;
  signOut(): Promise<void>;
  signInWithGoogle?(): Promise<void>;
  signInWithEmail?(email: string, password: string): Promise<void>;
  signUpWithEmail?(name: string, email: string, password: string): Promise<void>;
  resetPassword?(email: string): Promise<void>;
  signInLocal?(name: string): Promise<void>;
}
