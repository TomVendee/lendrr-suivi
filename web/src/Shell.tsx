import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, initials, type Me } from "./api";
import { C, F_TITRE, ICONS, Icon } from "./theme";

export type View =
  | "semaine" | "taches" | "meteo" | "charge" | "graphes"
  | "gantt" | "alertes" | "synthese" | "reglages";

const NAV: { id: View; label: string; icon: keyof typeof ICONS }[] = [
  { id: "semaine", label: "Ma semaine", icon: "semaine" },
  { id: "taches", label: "Tâches", icon: "taches" },
  { id: "meteo", label: "Météo", icon: "meteo" },
  { id: "charge", label: "Plan de charge", icon: "charge" },
  { id: "graphes", label: "Graphes", icon: "graphes" },
  { id: "gantt", label: "Gantt", icon: "gantt" },
  { id: "alertes", label: "Alertes", icon: "alertes" },
  { id: "synthese", label: "Synthèse et export", icon: "synthese" },
  { id: "reglages", label: "Réglages", icon: "reglages" },
];

const MOBILE_TABS: View[] = ["semaine", "meteo", "charge", "gantt"];

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

function Badge({ n, dim }: { n: number; dim?: boolean }) {
  if (n <= 0) return null;
  return (
    <span style={{
      minWidth: 24, height: 22, padding: "0 6px", boxSizing: "border-box",
      borderRadius: 11, background: dim ? "#3A3F44" : C.accent, color: "#FFFFFF",
      fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>{n}</span>
  );
}

export function Shell({ me, view, setView, children }: {
  me: Me; view: View; setView: (v: View) => void; children: React.ReactNode;
}) {
  const mobile = useIsMobile();
  const qc = useQueryClient();
  const alerts = useQuery({
    queryKey: ["alerts-count"],
    queryFn: () => api<{ alerts: unknown[] }>("/api/alerts"),
  });
  const revs = useQuery({
    queryKey: ["revs-count"],
    queryFn: () => api<{ revisions: unknown[] }>("/api/revisions"),
    retry: false,
  });
  const nAlerts = alerts.data?.alerts.length ?? 0;
  const nRevs = me.role === "pilot" ? (revs.data?.revisions?.length ?? 0) : 0;

  const logout = () =>
    api("/api/logout", { method: "POST" }).finally(() => qc.invalidateQueries({ queryKey: ["me"] }));

  if (mobile) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: C.fond, color: C.encre, fontFamily: "'IBM Plex Sans',system-ui,sans-serif", fontSize: 15, lineHeight: 1.45 }}>
        <header style={{ background: C.encre, color: C.fond, padding: "20px 16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: F_TITRE, fontWeight: 700, fontSize: 18 }}>Suivi projet</span>
            <button onClick={logout} aria-label={me.name}
              style={{ width: 36, height: 36, borderRadius: "50%", border: 0, background: "#D0D5DA", color: C.encre, fontFamily: F_TITRE, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {initials(me.name)}
            </button>
          </div>
          {view === "semaine" ? null : (
            <div style={{ fontFamily: F_TITRE, fontSize: 22, fontWeight: 700 }}>
              {NAV.find((n) => n.id === view)?.label}
            </div>
          )}
        </header>
        <main style={{ flex: "1 1 auto", padding: 16, display: "flex", flexDirection: "column", gap: 14, paddingBottom: 24 }}>
          {children}
        </main>
        <nav aria-label="Navigation" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", background: C.surface, borderTop: `1px solid ${C.bordure}`, padding: "6px 4px 10px" }}>
          {MOBILE_TABS.map((id) => {
            const item = NAV.find((n) => n.id === id)!;
            const active = view === id;
            return (
              <button key={id} onClick={() => setView(id)}
                style={{ minHeight: 52, border: 0, background: "transparent", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, fontSize: 12, fontWeight: active ? 600 : 400, color: active ? C.accentFonce : "#4A5056", cursor: "pointer" }}>
                <Icon d={ICONS[item.icon]} size={22} />
                {item.label === "Ma semaine" ? "Ma semaine" : item.label === "Plan de charge" ? "Charge" : item.label}
              </button>
            );
          })}
        </nav>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexWrap: "wrap", alignItems: "stretch", background: C.fond, color: C.encre, fontFamily: "'IBM Plex Sans',system-ui,sans-serif", fontSize: 15, lineHeight: 1.45 }}>
      <nav aria-label="Navigation principale" style={{ flex: "1 1 220px", maxWidth: 260, background: C.encre, color: C.fond, padding: "28px 16px 24px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 12px" }}>
          <div style={{ fontFamily: F_TITRE, fontWeight: 700, fontSize: 22, letterSpacing: "0.01em" }}>Suivi projet</div>
          <div style={{ fontSize: 13, color: C.navMuted }}>Projet : LENDRR</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {NAV.map((item) => {
            const active = view === item.id;
            return (
              <button key={item.id} onClick={() => setView(item.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12, minHeight: 44, padding: "0 12px",
                  borderRadius: 8, border: 0, background: active ? C.nav : "transparent",
                  color: active ? "#FFFFFF" : C.navTxt, fontWeight: active ? 600 : 400,
                  font: "inherit", fontSize: 15, cursor: "pointer", textAlign: "left",
                }}>
                <span style={{ color: active ? C.bleuClair : "currentColor", display: "flex" }}>
                  <Icon d={ICONS[item.icon]} />
                </span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.id === "taches" && me.role === "pilot" && <Badge n={nRevs} />}
                {item.id === "alertes" && <Badge n={nAlerts} />}
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 10, background: C.userCard }}>
          <div aria-hidden="true" style={{ width: 36, height: 36, borderRadius: "50%", background: me.role === "pilot" ? C.accent : "#D0D5DA", color: me.role === "pilot" ? "#FFFFFF" : C.encre, fontFamily: F_TITRE, fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {initials(me.name)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{me.name}</span>
            <span style={{ fontSize: 12, color: C.navMuted }}>{me.role === "pilot" ? "Pilote" : "Membre"}</span>
          </div>
          <button onClick={logout} title="Se déconnecter"
            style={{ background: "transparent", border: 0, color: C.navMuted, cursor: "pointer", fontSize: 12 }}>Quitter</button>
        </div>
      </nav>
      <main style={{ flex: "999 1 560px", minWidth: 0, padding: "32px 40px 48px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 24 }}>
        {children}
      </main>
    </div>
  );
}
