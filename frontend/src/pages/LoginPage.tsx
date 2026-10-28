import { useState, type FormEvent } from "react";
import { Mark } from "../components/Icon";
import { Notice } from "../components/Layout";
import { useSession } from "../session";

export function LoginPage() {
  const { auth } = useSession();
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (auth.mode === "local") return run(() => auth.signInLocal!(name.trim()));
    if (mode === "signup") return run(() => auth.signUpWithEmail!(name.trim(), email.trim(), password));
    if (mode === "reset") {
      return run(async () => {
        await auth.resetPassword!(email.trim());
        setInfo("Enviamos um e-mail com o link para criar uma nova senha.");
        setMode("signin");
      });
    }
    return run(() => auth.signInWithEmail!(email.trim(), password));
  }

  return (
    <div className="page narrow login">
      <div className="brand">
        <Mark className="brand-mark" />
        <h1>Remédios da Família</h1>
        <p className="brand-tagline">O cuidado da família, dose a dose</p>
      </div>
      <p className="muted">Agenda e registro de medicamentos, compartilhados entre os responsáveis.</p>

      {error && <Notice tone="error">{error}</Notice>}
      {info && <Notice tone="ok">{info}</Notice>}

      {auth.mode === "local" ? (
        <form onSubmit={submit} className="stack">
          <Notice tone="warn">Modo local de desenvolvimento: sem Firebase, qualquer nome entra.</Notice>
          <label>
            Seu nome
            <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </label>
          <button className="btn btn-primary" disabled={busy || !name.trim()}>Entrar</button>
        </form>
      ) : (
        <>
          <button className="btn btn-google" disabled={busy} onClick={() => void run(() => auth.signInWithGoogle!())}>
            Entrar com Google
          </button>
          <p className="divider"><span>ou com e-mail</span></p>
          <form onSubmit={submit} className="stack">
            {mode === "signup" && (
              <label>
                Seu nome
                <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              </label>
            )}
            <label>
              E-mail
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </label>
            {mode !== "reset" && (
              <label>
                Senha
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                  minLength={6} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
              </label>
            )}
            <button className="btn btn-primary" disabled={busy}>
              {mode === "signup" ? "Criar conta" : mode === "reset" ? "Enviar link" : "Entrar"}
            </button>
          </form>
          <p className="links">
            {mode !== "signin" && <button className="link" onClick={() => setMode("signin")}>Já tenho conta</button>}
            {mode !== "signup" && <button className="link" onClick={() => setMode("signup")}>Criar conta</button>}
            {mode === "signin" && <button className="link" onClick={() => setMode("reset")}>Esqueci a senha</button>}
          </p>
        </>
      )}
      <p className="muted small">
        Este aplicativo organiza informações e lembretes. Não substitui a prescrição nem a orientação de um profissional de saúde.
      </p>
    </div>
  );
}
