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

/** Titres : même famille que le texte, l'identité vient du serrage et de la graisse. */
export const F_TITRE = "var(--font-sans)";
export const F_MONO = "var(--font-mono)";

export const ink = "var(--text-1)";
export const muted = "var(--text-2)";
export const line = "var(--border)";
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

export const legend: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: C.discret,
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

export const STATUS: Record<string, { label: string; bg: string; fg: string; dot: string }> = {
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
