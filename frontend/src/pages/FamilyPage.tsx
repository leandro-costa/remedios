import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, errorMessage } from "../api/client";
import type {
  DeviceView, FamilySettings, InvitationView, IssuedInvitation, MemberView, NotificationSettings, OccurrenceView, PersonView, Role,
} from "../api/types";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Layout";
import { PageHeader } from "../components/PageHeader";
import { ProgressRing } from "../components/ProgressRing";
import { useCached } from "../hooks/useCached";
import { useOnline } from "../hooks/useOnline";
import { ROLE } from "../lib/labels";
import { addDays, formatDate, formatTime, formatWhen, sameDay, startOfDay } from "../lib/time";
import { disablePush, enablePush, pushState, testPush, type PushState } from "../sync/push";
import { isPending } from "../db/cache";
import { mutate } from "../sync/outbox";
import { useFamily, useSession } from "../session";

/** Família e configurações (seção 7.5). */
export function FamilyPage() {
  const family = useFamily();
  const session = useSession();
  const online = useOnline();
  const isAdmin = family.myRole === "ADMIN";
  // Atalho do sino na tela Hoje: rola até as notificações.
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, []);
  return (
    <div className="page">
      <PageHeader title={family.name} subtitle="Doses de hoje por pessoa"
        action={<a href="#nova-pessoa" className="round-btn" aria-label="Nova pessoa" title="Nova pessoa"><Icon name="plus" /></a>} />
      {!online && <Notice tone="warn">Sem conexão: as alterações ficam guardadas neste aparelho e são enviadas quando a conexão voltar. Convites e notificações precisam de internet.</Notice>}
      {session.families.length > 1 && (
        <label>
          Família
          <select value={family.id} onChange={(e) => session.selectFamily(e.target.value)}>
            {session.families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
      )}
      <Persons />
      <Members isAdmin={isAdmin} />
      <h2 className="section-title">Configurações</h2>
      <Defaults isAdmin={isAdmin} />
      <PushSettings />
      <Preferences />
      <Devices />
      {isAdmin && <ExportData />}
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
  const online = useOnline();
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
      <h2 className="eyebrow">Responsáveis</h2>
      {error && <Notice tone="error">{error}</Notice>}
      <ul className="people">
        {(members.data ?? []).map((m) => (
          <li key={m.userId} className="person-row">
            <Avatar name={m.displayName} id={m.userId} size={40} />
            <span className="item-main">
              <strong>{m.displayName}{m.userId === session.me?.id ? " (você)" : ""}</strong>
              <span className="muted small">{ROLE[m.role]}</span>
            </span>
            <span className="row wrap person-actions">
              {isAdmin && m.userId !== session.me?.id && (
                <>
                  <button className="btn btn-small" disabled={busy} onClick={() => void run(async () => {
                    const newRole = m.role === "ADMIN" ? "MEMBER" : "ADMIN";
                    await mutate({
                      familyId: family.id, method: "PUT", path: `/families/${family.id}/members/${m.userId}/role`, body: { role: newRole },
                      label: `Papel de ${m.displayName}`,
                      effects: [{ key: `members:${family.id}`, op: "merge", id: m.userId, value: { role: newRole } }],
                    });
                  })}>{m.role === "ADMIN" ? "Tornar membro" : "Tornar administrador"}</button>
                  <button className="btn btn-small" disabled={busy} onClick={() => confirm(`Remover ${m.displayName} da família?`) && void run(() => mutate({
                    familyId: family.id, method: "DELETE", path: `/families/${family.id}/members/${m.userId}`,
                    label: `Remover ${m.displayName} da família`,
                    effects: [{ key: `members:${family.id}`, op: "remove", id: m.userId }],
                  }))}>Remover</button>
                </>
              )}
              {m.userId === session.me?.id && (
                <button className="btn btn-small" disabled={busy || !online} onClick={() => confirm("Sair desta família?") && void run(async () => {
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
            <button className="btn btn-primary" disabled={busy || !online} onClick={() => void run(async () => {
              setIssued(await api<IssuedInvitation>(`/families/${family.id}/invitations`, { method: "POST", body: { role } }));
              await loadInvites();
            })}>Convidar responsável</button>
          </div>
          {!online && <p className="muted small">O convite precisa de conexão: o código só vale depois de registrado no servidor.</p>}
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
                    await mutate({ familyId: family.id, method: "DELETE", path: `/families/${family.id}/invitations/${i.id}`, label: "Revogar convite" });
                    setInvites((list) => list.filter((x) => x.id !== i.id));
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
    // Id gerado aqui: a pessoa já pode receber tratamentos e aferições offline.
    const person: PersonView = { id: crypto.randomUUID(), displayName: name.trim(), birthDate: birthDate || null, userId: isMe ? me?.id ?? null : null, active: true };
    const ok = await run(() => mutate({
      familyId: family.id, method: "POST", path: `/families/${family.id}/persons`, body: { ...person },
      label: `Nova pessoa: ${person.displayName}`,
      effects: [
        { key: `persons-all:${family.id}`, op: "upsert", value: { ...person }, list: true },
        { key: `persons:${family.id}`, op: "upsert", value: { ...person }, list: true },
      ],
    }));
    if (ok) {
      setName(""); setBirthDate(""); setIsMe(false);
    }
  }
  const update = (p: PersonView, patch: Partial<PersonView>) => run(() => {
    const next = { ...p, ...patch };
    return mutate({
      familyId: family.id, method: "PUT", path: `/families/${family.id}/persons/${p.id}`,
      body: { displayName: next.displayName, birthDate: next.birthDate, userId: next.userId, active: next.active },
      label: `Alteração de ${p.displayName}`,
      effects: [
        { key: `persons-all:${family.id}`, op: "merge", id: p.id, value: patch },
        next.active
          ? { key: `persons:${family.id}`, op: "upsert", value: { ...next }, list: true }
          : { key: `persons:${family.id}`, op: "remove", id: p.id },
      ],
    });
  });

  const today = startOfDay(new Date());
  const agenda = useCached(`agenda:${family.id}:${today.toISOString()}`, () =>
    api<OccurrenceView[]>(`/families/${family.id}/occurrences`, {
      query: { from: addDays(today, -1).toISOString(), to: addDays(today, 3).toISOString() },
    }));
  const todays = (agenda.data ?? []).filter((o) => sameDay(new Date(o.scheduledAt), today) && o.status !== "CANCELLED");
  const summary = (personId: string) => {
    const doses = todays.filter((o) => o.person.id === personId);
    const given = doses.filter((o) => o.status === "ADMINISTERED").length;
    const open = doses.filter((o) => o.status === "PENDING" || o.status === "SCHEDULED")
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const late = open.filter((o) => o.late).length;
    const detail = doses.length === 0 ? "Sem doses hoje"
      : late > 0 ? `${open[0].treatment.name} · ${late} ${late === 1 ? "atrasada" : "atrasadas"}`
      : open.length > 0 ? `${open[0].treatment.name} · próxima às ${formatTime(open[0].scheduledAt)}`
      : "Tudo certo hoje";
    return { total: doses.length, given, detail };
  };
  const active = (persons.data ?? []).filter((p) => p.active);
  const inactive = (persons.data ?? []).filter((p) => !p.active);

  return (
    <section className="stack">
      <h2 className="sr-only">Pessoas acompanhadas</h2>
      {error && <Notice tone="error">{error}</Notice>}
      <ul className="people-cards">
        {[...active, ...inactive].map((p) => {
          const day = summary(p.id);
          return (
            <li key={p.id} className={`item person-card ${p.active ? "" : "inactive"}`}>
              <Avatar name={p.displayName} id={p.id} size={52} />
              <span className="item-main">
                <strong className="item-title">{p.userId === me?.id ? `${p.displayName} (você)` : p.displayName}</strong>
                <span className="muted small">
                  {p.active ? day.detail : "Inativo"}{p.birthDate ? ` · nasceu em ${formatDate(p.birthDate + "T12:00:00")}` : ""}
                </span>
                {isPending(p) && <span className="badge badge-queued"><Icon name="sync" />Aguardando envio</span>}
                <span className="row wrap person-actions">
                  <button className="link small" disabled={busy} onClick={() => {
                    const newName = prompt("Nome", p.displayName);
                    if (newName?.trim()) void update(p, { displayName: newName.trim() });
                  }}>Renomear</button>
                  <button className="link small" disabled={busy} onClick={() => void update(p, { active: !p.active })}>
                    {p.active ? "Desativar" : "Reativar"}
                  </button>
                </span>
              </span>
              {p.active && day.total > 0 && (
                <ProgressRing light size={60} done={day.given} total={day.total}
                  label={`${p.displayName}: ${day.given} de ${day.total} doses de hoje dadas`} />
              )}
            </li>
          );
        })}
      </ul>
      <div className="card stack" id="nova-pessoa">
      <h3>Nova pessoa</h3>
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
      </div>
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
      {isPending(s) && <span className="badge badge-queued">Aguardando envio</span>}
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
            const { version, ...values } = draft;
            await mutate({
              familyId: family.id, method: "PUT", path: `/families/${family.id}/settings`, body: { ...values, baseVersion: version },
              label: "Padrões da família",
              // A próxima alteração parte da versão que esta vai criar.
              effects: [{ key: `settings:${family.id}`, op: "merge", value: { ...values, version: version + 1 } }],
            });
            setDraft(null);
          })}>Salvar padrões</button>
          <button className="btn" onClick={() => setDraft(null)}>Cancelar</button>
        </div>
      )}
    </section>
  );
}

function Preferences() {
  const { me } = useSession();
  const family = useFamily();
  const prefs = useCached(`prefs:${me?.id}`, () => api<NotificationSettings>("/me/notification-settings"));
  const { busy, error, run } = useAction();
  if (!prefs.data) return null;
  const p = prefs.data;
  const save = (patch: Partial<NotificationSettings>) => void run(() => {
    return mutate({
      familyId: family.id, method: "PUT", path: "/me/notification-settings", body: { ...p, ...patch },
      label: "Suas preferências de aviso",
      effects: [{ key: `prefs:${me?.id}`, op: "merge", value: patch }],
    });
  });
  const toggle = (key: keyof NotificationSettings, label: string) => (
    <label className="switch">
      <span>{label}</span>
      <input type="checkbox" checked={Boolean(p[key])} disabled={busy} onChange={(e) => save({ [key]: e.target.checked })} />
    </label>
  );
  return (
    <section className="card stack">
      <h2>Suas preferências de aviso</h2>
      <p className="muted small">Valem só para você e não mudam a agenda nem os horários dos tratamentos.</p>
      {error && <Notice tone="error">{error}</Notice>}
      {toggle("earlyReminderEnabled", "Lembrete antes do horário")}
      <label>
        Repetir lembrete de dose pendente
        <select value={p.repeatIntervalMinutes ?? ""} disabled={busy}
          onChange={(e) => save({ repeatIntervalMinutes: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Como definido no tratamento</option>
          {[5, 10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>A cada {m} min</option>)}
        </select>
      </label>
      {toggle("soundEnabled", "Som")}
      {toggle("vibrationEnabled", "Vibração")}
      {toggle("confirmationNotifications", "Avisar a cada dose registrada por outro responsável")}
      {toggle("lockScreenDetails", "Mostrar pessoa e medicamento no aviso (tela bloqueada)")}
      <label className="switch">
        <span>Horário de silêncio</span>
        {/* Ligar já leva início e fim (o servidor exige os dois); a pessoa ajusta em seguida. */}
        <input type="checkbox" checked={Boolean(p.quietHoursEnabled)} disabled={busy}
          onChange={(e) => save(e.target.checked
            ? { quietHoursEnabled: true, quietHoursStart: p.quietHoursStart ?? "22:00", quietHoursEnd: p.quietHoursEnd ?? "07:00" }
            : { quietHoursEnabled: false })} />
      </label>
      {p.quietHoursEnabled && (
        <div className="row wrap">
          {/* Campo apagado (meio de uma edição) não é enviado: ficaria sem início ou fim. */}
          <label>Início do silêncio <input type="time" value={p.quietHoursStart?.slice(0, 5) ?? ""}
            onChange={(e) => e.target.value && save({ quietHoursStart: e.target.value })} /></label>
          <label>Fim do silêncio <input type="time" value={p.quietHoursEnd?.slice(0, 5) ?? ""}
            onChange={(e) => e.target.value && save({ quietHoursEnd: e.target.value })} /></label>
        </div>
      )}
      {p.quietHoursEnabled && <p className="muted small">No horário de silêncio você não recebe lembretes de dose. Conflitos e lembretes que você mesmo criou continuam chegando.</p>}
    </section>
  );
}

/** Ativação das notificações neste aparelho (Web Push). */
function PushSettings() {
  const { deviceId } = useSession();
  const online = useOnline();
  const [state, setState] = useState<PushState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  useEffect(() => { void pushState().then(setState); }, []);

  const descriptions: Record<PushState, string> = {
    unsupported: "Este navegador não recebe notificações. No Android, use o Chrome; no computador, Chrome, Edge ou Firefox.",
    "install-required": "No iPhone, as notificações só funcionam com o app instalado: toque em Compartilhar → Adicionar à Tela de Início e abra o app por lá.",
    "server-disabled": "O servidor ainda não foi configurado para enviar notificações.",
    denied: "As notificações foram bloqueadas para este site. Libere nas configurações do navegador e volte aqui.",
    off: "Ative para receber os lembretes das doses e os avisos importantes neste aparelho.",
    on: "Este aparelho recebe os lembretes e avisos.",
  };
  return (
    <section className="card stack" id="notificacoes">
      <h2>Notificações neste aparelho</h2>
      {state && <p className={state === "on" ? "" : "muted"}>{descriptions[state]}</p>}
      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="ok">{message}</Notice>}
      <div className="row wrap">
        {state === "off" && deviceId && (
          <button className="btn btn-primary" disabled={busy || !online} onClick={() => void run(async () => setState(await enablePush(deviceId)))}>
            Ativar notificações
          </button>
        )}
        {state === "on" && deviceId && (
          <>
            <button className="btn" disabled={busy || !online} onClick={() => void run(async () => {
              const r = await testPush();
              setMessage(r.sent > 0 ? "Aviso de teste enviado." : "Não foi possível entregar o aviso de teste.");
            })}>Enviar aviso de teste</button>
            <button className="btn" disabled={busy || !online} onClick={() => void run(async () => {
              await disablePush(deviceId);
              setState("off");
            })}>Desativar</button>
          </>
        )}
      </div>
      <p className="muted small">
        Os lembretes chegam pela internet: com o celular sem conexão na hora da dose, o aviso pode atrasar ou não chegar.
        Confira sempre a tela Hoje.
      </p>
    </section>
  );
}

function Devices() {
  const { deviceId } = useSession();
  const family = useFamily();
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
              <button className="btn btn-small" disabled={busy} onClick={() => confirm("Desconectar este aparelho? Ele não poderá mais registrar doses.") && void run(() => mutate({
                familyId: family.id, method: "DELETE", path: `/me/devices/${d.id}`, label: `Desconectar ${d.name ?? "aparelho"}`,
                effects: [{ key: "devices", op: "remove", id: d.id }],
              }))}>Desconectar</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Exportação de todos os dados da família (LGPD: acesso e portabilidade). */
function ExportData() {
  const family = useFamily();
  const online = useOnline();
  const { busy, error, run } = useAction();
  return (
    <section className="card stack">
      <h2>Seus dados</h2>
      <p className="muted small">
        Baixe um arquivo com tudo o que a família registrou: pessoas, tratamentos e versões, doses, aferições, sintomas e
        a trilha de auditoria. O arquivo contém dados de saúde; guarde-o com cuidado. A exportação fica registrada.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <button className="btn" disabled={busy || !online} onClick={() => void run(async () => {
        const data = await api<unknown>(`/families/${family.id}/export`);
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `remedios-${family.name.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
      })}>Exportar dados da família</button>
      {!online && <p className="muted small">A exportação precisa de conexão: o arquivo é montado pelo servidor.</p>}
    </section>
  );
}
