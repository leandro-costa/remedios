import { useEffect, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import { useFamily, useSession } from "../session";
import { prefetch } from "../sync/prefetch";
import { Icon, type IconName } from "./Icon";
import { PendingChanges, QueueBadge } from "./PendingChanges";

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: "/", label: "Hoje", icon: "home" },
  { to: "/tratamentos", label: "Tratamentos", icon: "pill" },
  { to: "/saude", label: "Saúde", icon: "heart" },
  { to: "/historico", label: "Histórico", icon: "history" },
  { to: "/familia", label: "Família", icon: "family" },
];

export function Layout() {
  const family = useFamily();
  const { me } = useSession();
  // Dados de todas as telas guardados no aparelho, para abrir qualquer uma sem conexão.
  useEffect(() => {
    const go = (force = false) => void prefetch(family, me?.id ?? null, force);
    const online = () => go(true);
    const visible = () => document.visibilityState === "visible" && go();
    // Depois de a tela aberta carregar, para não disputar a conexão com ela.
    const first = window.setTimeout(() => go(), 3_000);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    const timer = window.setInterval(() => go(), 60_000);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [family, me?.id]);
  return (
    <div className="app">
      {/* Sem barra no topo (como no design): a fila aparece flutuando só quando há algo pendente. */}
      <div className="queue-float"><QueueBadge familyId={family.id} /></div>
      <main className="content">
        <PendingChanges familyId={family.id} />
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Navegação principal">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === "/"} className="tab" aria-label={item.label} title={item.label}>
            <Icon name={item.icon} />
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  return <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : undefined}>{children}</div>;
}

export function Spinner({ label = "Carregando…" }: { label?: string }) {
  return <p className="muted center" aria-busy="true">{label}</p>;
}
