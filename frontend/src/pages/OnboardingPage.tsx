import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api, errorMessage } from "../api/client";
import type { FamilyView } from "../api/types";
import { Notice } from "../components/Layout";
import { useSession } from "../session";

/** Primeira família: criar uma nova ou entrar com o código de convite. */
export function OnboardingPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [name, setName] = useState("");
  const [code, setCode] = useState(params.get("codigo") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      const familyId = await action();
      session.selectFamily(familyId);
      await session.refresh();
      navigate("/", { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const create = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => (await api<FamilyView>("/families", { method: "POST", body: { name: name.trim() } })).id);
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    void run(async () =>
      (await api<{ familyId: string }>("/invitations/accept", { method: "POST", body: { code: code.trim() } })).familyId);
  };

  return (
    <div className="page narrow">
      <h1>Olá, {session.me?.displayName}</h1>
      {error && <Notice tone="error">{error}</Notice>}

      <section className="card">
        <h2>Recebi um convite</h2>
        <form onSubmit={join} className="stack">
          <label>
            Código do convite
            <input value={code} onChange={(e) => setCode(e.target.value)} required autoComplete="off" />
          </label>
          <button className="btn btn-primary" disabled={busy || !code.trim()}>Entrar na família</button>
        </form>
      </section>

      <section className="card">
        <h2>Começar uma família</h2>
        <p className="muted">Você será o administrador e poderá convidar os outros responsáveis.</p>
        <form onSubmit={create} className="stack">
          <label>
            Nome da família
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ex.: Família Costa" />
          </label>
          <button className="btn" disabled={busy || !name.trim()}>Criar família</button>
        </form>
      </section>

      {session.families.length > 0 && (
        <button className="link" onClick={() => navigate("/")}>Voltar</button>
      )}
      <button className="link" onClick={() => void session.signOut()}>Sair da conta</button>
    </div>
  );
}
