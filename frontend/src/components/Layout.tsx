import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import { useFamily } from "../session";

const NAV = [
  { to: "/", label: "Hoje", icon: "◷" },
  { to: "/tratamentos", label: "Tratamentos", icon: "℞" },
  { to: "/historico", label: "Histórico", icon: "☰" },
  { to: "/familia", label: "Família", icon: "⌂" },
];

export function Layout() {
  const family = useFamily();
  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar-title">{family.name}</span>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Navegação principal">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === "/"} className="tab">
            <span className="tab-icon" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
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
