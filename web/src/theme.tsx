import React from "react";

/** Jetons docs/maquettes/README.md */
export const C = {
  fond: "#F4F5F7",
  surface: "#FFFFFF",
  encre: "#202326",
  bordure: "#D0D5DA",
  discret: "#5C6268",
  accent: "#2D5BD7",
  accentFonce: "#1E40AF",
  accentClair: "#E3EBFD",
  ok: "#2E7D4F",
  okFond: "#E3F1E8",
  warn: "#B7791F",
  warnFond: "#FBF1DE",
  crit: "#B42318",
  critFond: "#FDE7E4",
  nav: "#33383D",
  navTxt: "#D7DBDF",
  navMuted: "#B9BEC4",
  userCard: "#2B2F33",
  bleuClair: "#8FB0FF",
};

export const F_SANS = "'IBM Plex Sans', system-ui, sans-serif";
export const F_TITRE = "'Space Grotesk', sans-serif";
export const F_MONO = "'IBM Plex Mono', monospace";

export const card: React.CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.bordure}`,
  borderRadius: 12,
  padding: "18px 20px",
};

export const kpi: React.CSSProperties = {
  ...card,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

export const btnPrimary: React.CSSProperties = {
  height: 48,
  padding: "0 24px",
  border: 0,
  borderRadius: 8,
  background: C.accent,
  color: "#FFFFFF",
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
};

export const btnSecond: React.CSSProperties = {
  height: 48,
  padding: "0 18px",
  borderRadius: 8,
  border: `1px solid #A9AFB5`,
  background: C.surface,
  color: C.encre,
  font: "inherit",
  fontWeight: 500,
  cursor: "pointer",
};

export const field: React.CSSProperties = {
  height: 44,
  padding: "0 12px",
  border: "1px solid #A9AFB5",
  borderRadius: 8,
  background: C.surface,
  color: C.encre,
  font: "inherit",
};

export const labelSm: React.CSSProperties = { fontSize: 13, fontWeight: 500 };
export const legend: React.CSSProperties = {
  fontSize: 12,
  color: C.discret,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

export function Icon({ d, size = 18 }: { d: React.ReactNode; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {d}
    </svg>
  );
}

export const ICONS = {
  semaine: (<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>),
  taches: (<><path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" /></>),
  meteo: (<><circle cx="8" cy="9" r="3" /><path d="M8 2v1.5M2 9h1.5M3.8 4.8l1 1M12.2 4.8l-1 1M9 19h9a4 4 0 0 0 0-8 5 5 0 0 0-9.5 1.5A3.3 3.3 0 0 0 9 19z" /></>),
  charge: (<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />),
  graphes: (<path d="M3 3v18h18M7 15l4-5 3 3 6-7" />),
  gantt: (<path d="M3 5h8M7 12h10M12 19h9" />),
  alertes: (<><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9zM10 20.5a2 2 0 0 0 4 0" /></>),
  synthese: (<path d="M12 3v12M7 10l5 5 5-5M4 21h16" />),
  reglages: (<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>),
};

export function AxisChip({ code }: { code: string }) {
  return (
    <span style={{
      alignSelf: "flex-start", height: 22, padding: "0 8px", borderRadius: 4,
      background: C.encre, color: C.fond, fontFamily: F_TITRE, fontSize: 12,
      fontWeight: 700, letterSpacing: "0.06em", display: "inline-flex", alignItems: "center",
    }}>{code}</span>
  );
}

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  todo: { background: "#E9EBEE", color: C.encre },
  in_progress: { background: C.accentClair, color: C.accentFonce },
  blocked: { background: C.crit, color: "#FFFFFF" },
  done: { background: C.okFond, color: "#23603C" },
};

export function StatusPill({ status }: { status: string }) {
  const fr = { todo: "À faire", in_progress: "En cours", blocked: "Bloquée", done: "Terminée" }[status] ?? status;
  return (
    <span style={{
      flex: "0 0 auto", height: 28, padding: "0 12px", borderRadius: 14, fontSize: 13,
      fontWeight: 600, display: "inline-flex", alignItems: "center",
      ...(STATUS_STYLE[status] ?? {}),
    }}>{fr}</span>
  );
}

export function Kpi({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, color: C.discret }}>{label}</span>
      {children}
    </div>
  );
}

export function PageHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 style={{ margin: 0, fontFamily: F_TITRE, fontWeight: 700, fontSize: 34, letterSpacing: "-0.01em" }}>{title}</h1>
        {sub && <p style={{ margin: 0, color: C.discret }}>{sub}</p>}
      </div>
      {right && <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>{right}</div>}
    </header>
  );
}
