import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, errorMessage } from "../api/client";
import type {
  DeviceView, FamilySettings, InvitationView, IssuedInvitation, MemberView, NotificationSettings, PersonView, Role,
} from "../api/types";
import { Notice } from "../components/Layout";
import { useCached } from "../hooks/useCached";
import { useOnline } from "../hooks/useOnline";
import { ROLE } from "../lib/labels";
import { formatDate, formatWhen } from "../lib/time";
import { useFamily, useSession } from "../session";

/** Família e configurações (seção 7.5). */
export function FamilyPage() {
  const family = useFamily();
  const session = useSession();
  const online = useOnline();
  const isAdmin = family.myRole === "ADMIN";
  return (
    <div className="page">
      <h1>Família e configurações</h1>
      {!online && <Notice tone="warn">Sem conexão: as alterações desta tela precisam de internet.</Notice>}
      {session.families.length > 1 && (
        <label>
          Família
          <select value={family.id} onChange={(e) => session.selectFamily(e.target.value)}>
            {session.families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
      )}
      <Members isAdmin={isAdmin} />
      <Persons />
      <Defaults isAdmin={isAdmin} />
      <Preferences />
      <Devices />
      <section className="card stack">
        <h2>Conta</h2>
        <p>{session.me?.displayName} <span className="muted small">({session.auth.mode === "local" ? "modo local" : session.user?.email})</span></p>
        <Link to="/entrar-na-familia" className="btn">Entrar em outra família ou criar uma</Link>
        <button className="btn" onClick={() => void session.signOut()}>Sair da conta neste aparelho</button>
        <p className="muted small">Ao sair, os dados guardados neste aparelho são apagados.</p>
      </section>
    </div>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Members({ isAdmin }: { isAdmin: boolean }) {
  const family = useFamily();
  const session = useSession();
  const members = useCached(`members:${family.id}`, () => api<MemberView[]>(`/families/${family.id}/members`));
  const [invites, setInvites] = useState<InvitationView[]>([]);
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [role, setRole] = useState<Role>("MEMBER");
  const { busy, error, run } = useAction();

  const loadInvites = () => isAdmin && api<InvitationView[]>(`/families/${family.id}/invitations`).then(setInvites).catch(() => {});
  useEffect(() => { void loadInvites(); }, [family.id, isAdmin]);

  const link = issued ? `${location.origin}/entrar-na-familia?codigo=${encodeURIComponent(issued.code)}` : "";
  async function share() {
    const text = `Entre na família "${family.name}" no app Remédios: ${link}`;
    if (navigator.share) await navigator.share({ title: "Convite", text }).catch(() => {});
    else await navigator.clipboard.writeText(text);
  }

  return (
    <section className="card stack">
      <h2>Membros</h2>
      {error && <Notice tone="error">{error}</Notice>}
      <ul className="plain">
        {(members.data ?? []).map((m) => (
          <li key={m.userId} className="row between">
            <span>{m.displayName} · <span className="muted">{ROLE[m.role]}</span></span>
            <span className="row">
              {isAdmin && m.userId !== session.me?.id && (
                <>
                  <button className="btn btn-small" disabled={busy} onClick={() => void run(async () => {
                    await api(`/families/${family.id}/members/${m.userId}/role`, { method: "PUT", body: { role: m.role === "ADMIN" ? "MEMBER" : "ADMIN" } });
                    await members.reload();
                  })}>{m.role === "ADMIN" ? "Tornar membro" : "Tornar administrador"}</button>
                  <button className="btn btn-small" disabled={busy} onClick={() => confirm(`Remover ${m.displayName} da família?`) && void run(async () => {
                    await api(`/families/${family.id}/members/${m.userId}`, { method: "DELETE" });
                    await members.reload();
                  })}>Remover</button>
                </>
              )}
              {m.userId === session.me?.id && (
                <button className="btn btn-small" disabled={busy} onClick={() => confirm("Sair desta família?") && void run(async () => {
                  await api(`/families/${family.id}/members/${m.userId}`, { method: "DELETE" });
                  await session.refresh();
                })}>Sair</button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {isAdmin && (
        <>
          <div className="row wrap">
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Papel do convidado">
              <option value="MEMBER">Convidar como membro</option>
              <option value="ADMIN">Convidar como administrador</option>
            </select>
            <button className="btn btn-primary" disabled={busy} onClick={() => void run(async () => {
              setIssued(await api<IssuedInvitation>(`/families/${family.id}/invitations`, { method: "POST", body: { role } }));
              await loadInvites();
            })}>Convidar responsável</button>
          </div>
          {issued && (
            <Notice tone="ok">
              <p>Código do convite (vale até {formatDate(issued.expiresAt)}, uso único):</p>
              <p className="code" data-testid="invite-code">{issued.code}</p>
              <button className="btn btn-small" onClick={() => void share()}>Compartilhar link</button>
            </Notice>
          )}
          {invites.length > 0 && (
            <ul className="plain small">
              {invites.map((i) => (
                <li key={i.id} className="row between">
                  <span>Convite pendente ({ROLE[i.role]}) · até {formatDate(i.expiresAt)}</span>
                  <button className="btn btn-small" onClick={() => void run(async () => {
                    await api(`/families/${family.id}/invitations/${i.id}`, { method: "DELETE" });
                    await loadInvites();
                  })}>Revogar</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Persons() {
  const family = useFamily();
  const { me } = useSession();
  const persons = useCached(`persons-all:${family.id}`, () => api<PersonView[]>(`/families/${family.id}/persons`));
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [isMe, setIsMe] = useState(false);
  const { busy, error, run } = useAction();
  const hasMe = (persons.data ?? []).some((p) => p.userId === me?.id);

  async function add(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() => api(`/families/${family.id}/persons`, {
      method: "POST", body: { displayName: name.trim(), birthDate: birthDate || null, userId: isMe ? me?.id : null },
    }));
    if (ok) {
      setName(""); setBirthDate(""); setIsMe(false);
      await persons.reload();
    }
  }
  const update = (p: PersonView, patch: Partial<PersonView>) => run(async () => {
    await api(`/families/${family.id}/persons/${p.id}`, { method: "PUT", body: { ...p, ...patch } });
    await persons.reload();
  });

  return (
    <section className="card stack">
      <h2>Pessoas acompanhadas</h2>
      {error && <Notice tone="error">{error}</Notice>}
      <ul className="plain">
        {(persons.data ?? []).map((p) => (
          <li key={p.id} className="row between">
            <span className={p.active ? "" : "muted"}>
              {p.displayName}{p.userId === me?.id ? " (você)" : ""}{p.birthDate ? ` · ${formatDate(p.birthDate + "T12:00:00")}` : ""}
              {!p.active && " · inativo"}
            </span>
            <span className="row">
              <button className="btn btn-small" disabled={busy} onClick={() => {
                const newName = prompt("Nome", p.displayName);
                if (newName?.trim()) void update(p, { displayName: newName.trim() });
              }}>Renomear</button>
              <button className="btn btn-small" disabled={busy} onClick={() => void update(p, { active: !p.active })}>
                {p.active ? "Desativar" : "Reativar"}
              </button>
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => void add(e)} className="stack">
        <div className="row wrap">
          <label className="grow">
            Nome
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="Ex.: Gabriel" />
          </label>
          <label>
            Nascimento <span className="muted small">(opcional)</span>
            <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </label>
        </div>
        {!hasMe && (
          <label className="radio">
            <input type="checkbox" checked={isMe} onChange={(e) => setIsMe(e.target.checked)} /> Esta pessoa sou eu (adulto em tratamento)
          </label>
        )}
        <button className="btn" disabled={busy || !name.trim()}>Adicionar pessoa</button>
      </form>
    </section>
  );
}

function Defaults({ isAdmin }: { isAdmin: boolean }) {
  const family = useFamily();
  const settings = useCached(`settings:${family.id}`, () => api<FamilySettings>(`/families/${family.id}/settings`));
  const [draft, setDraft] = useState<FamilySettings | null>(null);
  const { busy, error, run } = useAction();
  const s = draft ?? settings.data;
  if (!s) return null;
  const field = (key: keyof FamilySettings, label: string, unit: string) => (
    <label>
      {label}
      <span className="row">
        <input type="number" className="short" value={s[key] as number} disabled={!draft}
          onChange={(e) => setDraft({ ...s, [key]: Number(e.target.value) })} /> {unit}
      </span>
    </label>
  );
  return (
    <section className="card stack">
      <h2>Padrões da família</h2>
      <p className="muted small">Valem para novos tratamentos e para todos os responsáveis. Não alteram tratamentos já ativados.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="row wrap">
        {field("reminderBeforeMinutes", "Lembrete antecipado", "min antes")}
        {field("repeatIntervalMinutes", "Repetir a cada", "min")}
        {field("repeatLimit", "Limite de repetições", "vezes")}
        {field("lateToleranceMinutes", "Considerar atrasada após", "min")}
      </div>
      {isAdmin && !draft && <button className="btn" onClick={() => setDraft(s)}>Editar padrões</button>}
      {draft && (
        <div className="row">
          <button className="btn btn-primary" disabled={busy} onClick={() => void run(async () => {
            await api(`/families/${family.id}/settings`, { method: "PUT", body: { ...draft, baseVersion: draft.version } });
            setDraft(null);
            await settings.reload();
          })}>Salvar padrões</button>
          <button className="btn" onClick={() => setDraft(null)}>Cancelar</button>
        </div>
      )}
    </section>
  );
}

function Preferences() {
  const { me } = useSession();
  const prefs = useCached(`prefs:${me?.id}`, () => api<NotificationSettings>("/me/notification-settings"));
  const { busy, error, run } = useAction();
  if (!prefs.data) return null;
  const p = prefs.data;
  const toggle = (key: keyof NotificationSettings, label: string) => (
    <label className="switch">
      <span>{label}</span>
      <input type="checkbox" checked={Boolean(p[key])} disabled={busy}
        onChange={(e) => void run(async () => {
          await api("/me/notification-settings", { method: "PUT", body: { ...p, [key]: e.target.checked } });
          await prefs.reload();
        })} />
    </label>
  );
  return (
    <section className="card stack">
      <h2>Suas preferências</h2>
      <p className="muted small">Valem só para você. Os lembretes por notificação chegam na próxima versão do app.</p>
      {error && <Notice tone="error">{error}</Notice>}
      {toggle("earlyReminderEnabled", "Lembrete antecipado")}
      {toggle("soundEnabled", "Som")}
      {toggle("vibrationEnabled", "Vibração")}
      {toggle("confirmationNotifications", "Avisar a cada dose registrada por outro responsável")}
      {toggle("lockScreenDetails", "Mostrar nome do medicamento na tela bloqueada")}
    </section>
  );
}

function Devices() {
  const { deviceId } = useSession();
  const devices = useCached("devices", () => api<DeviceView[]>("/me/devices"));
  const { busy, error, run } = useAction();
  const active = (devices.data ?? []).filter((d) => d.status === "ACTIVE");
  return (
    <section className="card stack">
      <h2>Seus aparelhos</h2>
      {error && <Notice tone="error">{error}</Notice>}
      <ul className="plain">
        {active.map((d) => (
          <li key={d.id} className="row between">
            <span>{d.name ?? "Aparelho"}{d.id === deviceId ? " (este)" : ""}
              <span className="muted small"> · usado {d.lastSeenAt ? formatWhen(d.lastSeenAt) : "—"}</span></span>
            {d.id !== deviceId && (
              <button className="btn btn-small" disabled={busy} onClick={() => confirm("Desconectar este aparelho? Ele não poderá mais registrar doses.") && void run(async () => {
                await api(`/me/devices/${d.id}`, { method: "DELETE" });
                await devices.reload();
              })}>Desconectar</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
