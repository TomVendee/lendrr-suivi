/** Coquille : barre latérale repliable + barre du haut (ordinateur), en-tête + barre du bas (téléphone). */
import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Menu, Tooltip, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import {
  IconChevronRight, IconDots, IconKeyboard, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand,
  IconLogout, IconMoon, IconSearch, IconSun,
} from "@tabler/icons-react";
import { api, initials, useSettings, type Me } from "./api";
import { CommandPalette, MOD, openSearch } from "./CommandPalette";
import { LockerMark, NAV, navFor, type NavItem } from "./nav";
import type { View } from "./router";
import "./styles/shell.css";

export type { View };

const MOBILE_TABS: View[] = ["semaine", "taches", "meteo", "alertes"];

export function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 760px)");
    const fn = () => setM(q.matches);
    q.addEventListener("change", fn);
    return () => q.removeEventListener("change", fn);
  }, []);
  return m;
}

/** Bascule clair/sombre, persistée par Mantine (localStorage). */
function ThemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const dark = useComputedColorScheme("light") === "dark";
  const label = dark ? "Passer en thème clair" : "Passer en thème sombre";
  return (
    <Tooltip label={label} openDelay={400}>
      <button className="icon-btn" aria-label={label} onClick={() => setColorScheme(dark ? "light" : "dark")}>
        {dark ? <IconSun size={18} stroke={1.6} /> : <IconMoon size={18} stroke={1.6} />}
      </button>
    </Tooltip>
  );
}

/** Mémorise le repli de la barre latérale (préférence locale, sans incidence si le stockage est bloqué). */
function useCollapsed(): [boolean, () => void] {
  const read = () => {
    try { return localStorage.getItem("suivi-sidebar") === "collapsed"; } catch { return false; }
  };
  const [c, setC] = useState(read);
  const toggle = () => setC((v) => {
    try { localStorage.setItem("suivi-sidebar", v ? "open" : "collapsed"); } catch { /* stockage indisponible */ }
    return !v;
  });
  return [c, toggle];
}

export function Shell({ me, view, setView, children }: {
  me: Me; view: View; setView: (v: View) => void; children: React.ReactNode;
}) {
  const mobile = useIsMobile();
  const qc = useQueryClient();
  const [collapsed, toggleCollapsed] = useCollapsed();
  const settings = useSettings();
  const canDecide = settings.data?.can_decide ?? false;
  const alerts = useQuery({ queryKey: ["alerts"], queryFn: () => api<{ alerts: { severity: number }[] }>("/api/alerts") });
  const revs = useQuery({
    queryKey: ["revisions"],
    queryFn: () => api<{ revisions: unknown[] }>("/api/revisions"),
    enabled: canDecide,
    retry: false,
  });
  const list = alerts.data?.alerts ?? [];
  const counts: Partial<Record<View, { n: number; crit?: boolean }>> = {
    alertes: { n: list.length, crit: list.some((a) => a.severity >= 3) },
    taches: { n: canDecide ? revs.data?.revisions.length ?? 0 : 0 },
  };
  const logout = () =>
    api("/api/logout", { method: "POST" }).finally(() => qc.invalidateQueries({ queryKey: ["me"] }));
  const current = NAV.find((n) => n.id === view);

  const count = (id: View) => {
    const c = counts[id];
    return c && c.n > 0 ? (
      <span className="nav-count" data-tone={c.crit ? "crit" : undefined} aria-label={`${c.n} en attente`}>{c.n}</span>
    ) : null;
  };

  if (mobile) {
    const tabs = MOBILE_TABS.map((id) => NAV.find((n) => n.id === id)!);
    return (
      <div className="m-shell">
        <header className="m-top">
          <LockerMark size={24} />
          <span className="brand-name">{current?.label ?? "Suivi projet"}</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
            <button className="icon-btn" aria-label="Rechercher" onClick={openSearch}><IconSearch size={18} stroke={1.6} /></button>
            <ThemeToggle />
            <UserMenu me={me} onLogout={logout} compact />
          </span>
        </header>
        <main className="m-content page">{children}</main>
        <nav className="m-tabs" aria-label="Navigation" style={{ "--n": tabs.length } as React.CSSProperties}>
          {tabs.map((t) => (
            <button key={t.id} className="m-tab" aria-current={view === t.id ? "page" : undefined} onClick={() => setView(t.id)}>
              <t.icon size={22} stroke={1.6} />
              {t.short}
              {count(t.id)}
            </button>
          ))}
        </nav>
        <CommandPalette me={me} />
      </div>
    );
  }

  const groups: { id: NavItem["group"]; label?: string }[] = [
    { id: "travail", label: "Mon travail" },
    { id: "projet", label: "Projet" },
  ];
  const item = (n: NavItem) => (
    <Tooltip key={n.id} label={n.label} position="right" disabled={!collapsed} openDelay={200}>
      <button className="nav-item" aria-current={view === n.id ? "page" : undefined} onClick={() => setView(n.id)}>
        <n.icon size={18} stroke={1.6} />
        <span className="nav-label">{n.label}</span>
        {count(n.id)}
      </button>
    </Tooltip>
  );
  const nav = navFor(me.role);

  return (
    <div className="shell" data-collapsed={collapsed}>
      <nav className="sidebar" aria-label="Navigation principale">
        <div className="brand">
          <LockerMark />
          <div className="brand-text">
            <span className="brand-name">Suivi projet</span>
            <span className="brand-sub">LENDRR</span>
          </div>
        </div>
        {groups.map((g) => (
          <div key={g.id} className="nav-group">
            <span className="nav-group-label">{g.label}</span>
            {nav.filter((n) => n.group === g.id).map(item)}
          </div>
        ))}
        <div className="sidebar-foot">
          {nav.filter((n) => n.group === "outil").map(item)}
          <button className="nav-item" onClick={toggleCollapsed} aria-label={collapsed ? "Déplier la barre latérale" : "Replier la barre latérale"}>
            {collapsed ? <IconLayoutSidebarLeftExpand size={18} stroke={1.6} /> : <IconLayoutSidebarLeftCollapse size={18} stroke={1.6} />}
            <span className="nav-label">Replier</span>
          </button>
          <UserMenu me={me} onLogout={logout} />
        </div>
      </nav>
      <div className="main">
        <header className="topbar">
          <div className="crumbs">
            <span>LENDRR</span>
            <IconChevronRight size={14} stroke={1.6} aria-hidden="true" />
            <strong>{current?.label}</strong>
          </div>
          <button className="search-btn" onClick={openSearch}>
            <IconSearch size={16} stroke={1.6} />
            Rechercher
            <span className="kbd">{MOD} K</span>
          </button>
          <ThemeToggle />
        </header>
        <main className="content page">{children}</main>
      </div>
      <CommandPalette me={me} />
    </div>
  );
}

function UserMenu({ me, onLogout, compact }: { me: Me; onLogout: () => void; compact?: boolean }) {
  const avatar = <Avatar size={compact ? 30 : 28} radius="xl" color={me.role === "pilot" ? "brand" : "gray"}>{initials(me.name)}</Avatar>;
  return (
    <Menu position={compact ? "bottom-end" : "top-start"} width={220} radius="md" shadow="md">
      <Menu.Target>
        {compact ? (
          <button className="icon-btn" aria-label={`Compte de ${me.name}`} style={{ width: 36, height: 36 }}>{avatar}</button>
        ) : (
          <button className="nav-item me" aria-label={`Compte de ${me.name}`} style={{ height: "auto" }}>
            {avatar}
            <span className="me-text">
              <span className="me-name">{me.name}</span>
              <span className="me-role">{me.role === "pilot" ? "Chef de projet" : "Membre"}</span>
            </span>
            <IconDots size={16} stroke={1.6} className="nav-label" />
          </button>
        )}
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{me.email}</Menu.Label>
        <Menu.Item leftSection={<IconKeyboard size={16} stroke={1.6} />}
          onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }))}>
          Raccourcis clavier
        </Menu.Item>
        <Menu.Item leftSection={<IconLogout size={16} stroke={1.6} />} onClick={onLogout}>Se déconnecter</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
