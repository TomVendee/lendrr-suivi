/** Coquille : barre latérale repliable + barre du haut (ordinateur), en-tête + barre du bas (téléphone). */
import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Button, Drawer, Menu, Modal, PasswordInput, Tooltip, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import {
  IconChevronRight, IconDots, IconGridDots, IconKey, IconKeyboard, IconRobot, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand,
  IconLogout, IconMoon, IconSearch, IconSun,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { api, initials, useSettings, type Me } from "./api";
import { TokenManager } from "./Tokens";
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
    // Sans préférence enregistrée : repliée sur tablette et petit portable (< 1100 px), ouverte au-delà.
    const narrow = window.innerWidth < 1100;
    try {
      const v = localStorage.getItem("suivi-sidebar");
      return v === null ? narrow : v === "collapsed";
    } catch { return narrow; }
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
  const [more, setMore] = useState(false);
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
        <nav className="m-tabs" aria-label="Navigation" style={{ "--n": tabs.length + 1 } as React.CSSProperties}>
          {tabs.map((t) => (
            <button key={t.id} className="m-tab" aria-current={view === t.id ? "page" : undefined} onClick={() => setView(t.id)}>
              <t.icon size={22} stroke={1.6} />
              {t.short}
              {count(t.id)}
            </button>
          ))}
          <button className="m-tab" aria-current={!MOBILE_TABS.includes(view) ? "page" : undefined} aria-haspopup="dialog" onClick={() => setMore(true)}>
            <IconGridDots size={22} stroke={1.6} />
            Plus
          </button>
        </nav>
        <Drawer opened={more} onClose={() => setMore(false)} position="bottom" radius="lg" title="Tous les écrans"
          overlayProps={{ backgroundOpacity: 0.4, blur: 2 }} styles={{ content: { height: "auto", maxHeight: "85dvh" } }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, paddingBottom: "env(safe-area-inset-bottom)" }}>
            {navFor(me.role).map((n) => (
              <button key={n.id} className="m-sheet-item" aria-current={view === n.id ? "page" : undefined}
                onClick={() => { setMore(false); setView(n.id); }}>
                <n.icon size={22} stroke={1.6} />
                {n.short}
                {count(n.id)}
              </button>
            ))}
          </div>
        </Drawer>
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

function PasswordForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const [busy, setBusy] = useState(false);
  const err = f.next && f.next.length < 10 ? "10 caractères minimum" : f.again && f.again !== f.next ? "Les deux mots de passe diffèrent" : "";
  const ok = f.current && f.next.length >= 10 && f.next === f.again;
  const submit = async () => {
    setBusy(true);
    try {
      await api("/api/me/password", { method: "POST", body: JSON.stringify({ current: f.current, new: f.next }) });
      notifications.show({ message: "Mot de passe modifié", color: "ok" });
      onDone();
    } catch (e) {
      const wrong = String(e).includes("wrong-password");
      notifications.show({ message: wrong ? "Mot de passe actuel incorrect" : `Échec : ${String(e)}`, color: "crit" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ok) submit(); }} style={{ display: "grid", gap: 12 }}>
      <PasswordInput label="Mot de passe actuel" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
      <PasswordInput label="Nouveau mot de passe" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
      <PasswordInput label="Confirmer le nouveau mot de passe" autoComplete="new-password" value={f.again} error={err || undefined} onChange={(e) => setF({ ...f, again: e.target.value })} />
      <Button type="submit" disabled={!ok} loading={busy}>Changer le mot de passe</Button>
    </form>
  );
}

function UserMenu({ me, onLogout, compact }: { me: Me; onLogout: () => void; compact?: boolean }) {
  const [pwd, setPwd] = useState(false);
  const [ia, setIa] = useState(false);
  const avatar = <Avatar size={compact ? 30 : 28} radius="xl" color={me.role === "pilot" ? "brand" : "gray"}>{initials(me.name)}</Avatar>;
  return (
    <>
    <Sheet opened={pwd} onClose={() => setPwd(false)} title="Changer mon mot de passe">
      <PasswordForm onDone={() => setPwd(false)} />
    </Sheet>
    <Sheet opened={ia} onClose={() => setIa(false)} title="Accès IA">
      <TokenManager />
    </Sheet>
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
        <Menu.Item leftSection={<IconKey size={16} stroke={1.6} />} onClick={() => setPwd(true)}>Mot de passe</Menu.Item>
        <Menu.Item leftSection={<IconRobot size={16} stroke={1.6} />} onClick={() => setIa(true)}>Accès IA</Menu.Item>
        <Menu.Item leftSection={<IconLogout size={16} stroke={1.6} />} onClick={onLogout}>Se déconnecter</Menu.Item>
      </Menu.Dropdown>
    </Menu>
    </>
  );
}

/** Fenêtre centrée sur ordinateur, feuille qui glisse du bas sur téléphone (atteignable au pouce). */
export function Sheet({ opened, onClose, title, children }: {
  opened: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode;
}) {
  const mobile = useIsMobile();
  return mobile ? (
    <Drawer opened={opened} onClose={onClose} title={title} position="bottom" radius="lg"
      overlayProps={{ backgroundOpacity: 0.4, blur: 2 }} styles={{ content: { height: "auto", maxHeight: "92dvh" } }}>
      {children}
    </Drawer>
  ) : (
    <Modal opened={opened} onClose={onClose} title={title} size="lg" centered radius="lg">{children}</Modal>
  );
}
