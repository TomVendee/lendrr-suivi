/**
 * Briques partagées « Précision » (D23). Les noms historiques (C, ink, muted…) pointent vers les
 * jetons CSS de styles/tokens.css : plus aucune couleur en dur ici.
 */
import React from "react";

export const C = {
  fond: "var(--bg)",
  surface: "var(--surface-1)",
  encre: "var(--text-1)",
  bordure: "var(--border)",
  discret: "var(--text-2)",
  accent: "var(--accent)",
  accentFonce: "var(--accent-text)",
  accentClair: "var(--accent-soft)",
  ok: "var(--ok)",
  okFond: "var(--ok-soft)",
  warn: "var(--warn)",
  warnFond: "var(--warn-soft)",
  crit: "var(--crit)",
  critFond: "var(--crit-soft)",
  nav: "var(--nav-active)",
  navTxt: "var(--text-1)",
  navMuted: "var(--text-2)",
  userCard: "var(--surface-1)",
  bleuClair: "var(--accent-text)",
};

export const F_SANS = "var(--font-sans)";
/** Titres : même famille que le texte, l'identité vient du serrage et de la graisse. */
export const F_TITRE = "var(--font-sans)";
export const F_MONO = "var(--font-mono)";

export const ink = "var(--text-1)";
export const muted = "var(--text-2)";
export const line = "var(--border)";
export const faint = "var(--bg)";
export const inputBorder = "var(--border-strong)";
export const surf = "var(--surface-1)";
export const box = "var(--sunken)";
export const track = "var(--sunken-2)";

export const card: React.CSSProperties = {
  background: surf,
  border: `1px solid ${line}`,
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-1)",
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
  border: `1px solid ${inputBorder}`,
  borderRadius: 8,
  background: surf,
  color: ink,
  font: "inherit",
};

export const labelSm: React.CSSProperties = { fontSize: 13, fontWeight: 500 };
export const legend: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: C.discret,
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

/** Couleur et libellé de chaque axe (palette catégorielle validée, tokens.css). */
export const AXES: Record<string, { label: string; color: string }> = {
  HARD: { label: "HARD", color: "var(--axis-hard)" },
  SOFT: { label: "SOFT", color: "var(--axis-soft)" },
  IA: { label: "IA", color: "var(--axis-ia)" },
  PILOTAGE: { label: "Pilotage", color: "var(--axis-pilotage)" },
  VIDEO: { label: "Vidéo", color: "var(--axis-video)" },
};

/** Badge d'axe : pastille de couleur + nom (jamais la couleur seule). */
export function AxisChip({ code }: { code: string }) {
  const a = AXES[code] ?? { label: code, color: "var(--text-3)" };
  return (
    <span style={{
      alignSelf: "flex-start", height: 22, padding: "0 8px 0 7px", borderRadius: "var(--radius-sm)",
      background: "var(--sunken)", border: "1px solid var(--border)", color: "var(--text-1)",
      fontSize: 12, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
    }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: a.color }} />
      {a.label}
    </span>
  );
}

const STATUS: Record<string, { label: string; bg: string; fg: string; dot: string }> = {
  todo: { label: "À faire", bg: "var(--sunken)", fg: "var(--text-2)", dot: "var(--text-3)" },
  in_progress: { label: "En cours", bg: "var(--accent-soft)", fg: "var(--accent-text)", dot: "var(--accent)" },
  blocked: { label: "Bloquée", bg: "var(--crit-soft)", fg: "var(--crit-text)", dot: "var(--crit)" },
  done: { label: "Terminée", bg: "var(--ok-soft)", fg: "var(--ok-text)", dot: "var(--ok)" },
};

/** Statut : libellé + point de couleur (l'état ne repose pas sur la couleur seule). */
export function StatusPill({ status }: { status: string }) {
  const st = STATUS[status] ?? { label: status, bg: "var(--sunken)", fg: "var(--text-2)", dot: "var(--text-3)" };
  return (
    <span style={{
      flex: "0 0 auto", height: 24, padding: "0 10px", borderRadius: "var(--radius-pill)", fontSize: 12,
      fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6, background: st.bg, color: st.fg,
    }}>
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: st.dot }} />
      {st.label}
    </span>
  );
}

/** En-tête de page : titre serré, sous-titre discret, actions à droite. */
export function PageHead({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 4 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <h1 style={{ margin: 0, fontWeight: 600, fontSize: "clamp(22px, 1.2vw + 16px, 28px)", letterSpacing: "-0.025em", lineHeight: 1.15 }}>{title}</h1>
        {sub && <p style={{ margin: 0, color: "var(--text-2)", fontSize: 14 }}>{sub}</p>}
      </div>
      {right && <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>{right}</div>}
    </header>
  );
}
