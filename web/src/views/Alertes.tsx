import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { C, F_TITRE, PageHead, card } from "../theme";

export interface Alert {
  kind: string; severity: number; title?: string; milestone?: string;
  user?: string; week?: number; task_id?: string;
}

export const TAG: Record<string, { label: string; style: React.CSSProperties }> = {
  "milestone-threatened": { label: "Jalon menacé", style: { background: C.crit, color: "#FFFFFF" } },
  "blocking-late": { label: "Retard bloquant", style: { background: C.critFond, color: "#8F1C13" } },
  late: { label: "Tâche en retard", style: { background: C.critFond, color: "#8F1C13" } },
  overload: { label: "Surcharge prévue", style: { background: C.warnFond, color: "#7A4F10" } },
  "missing-hours": { label: "Heures non déclarées", style: { background: C.warnFond, color: "#7A4F10" } },
  overrun: { label: "Dépassement réel", style: { background: "#E9EBEE", color: C.encre } },
  incomplete: { label: "Tâche incomplète", style: { background: "#E9EBEE", color: C.encre } },
};

export function alertDetail(a: Alert): string {  switch (a.kind) {
    case "milestone-threatened":
      return a.milestone ? `« ${a.milestone} » menacé.` : `« ${a.title ?? ""} » en retard sur le chemin critique.`;
    case "blocking-late":
      return `${a.user ?? ""} · bloque une tâche qui démarre dans moins de 7 jours.`;
    case "late":
      return `${a.user ?? ""} · échéance dépassée et tâche non terminée.`;
    case "overload":
      return `${a.user ?? ""} · charge prévue au-dessus de la capacité en S${a.week}.`;
    case "missing-hours":
      return `${a.user ?? ""} · aucune saisie pour la S${a.week}.`;
    case "overrun":
      return `${a.user ?? ""} · réel au-dessus du prévu (+25 % ou +1 h).`;
    case "incomplete":
      return `Sans pilote ou sans heures prévues.`;
    default:
      return "";
  }
}

export function Alertes({ goTaches }: { goTaches: () => void }) {
  const q = useQuery({
    queryKey: ["alerts"], queryFn: () => api<{ alerts: Alert[] }>("/api/alerts"),
  });
  if (!q.data) return <p>Chargement…</p>;
  return (
    <>
      <PageHead title="Alertes" sub={`${q.data.alerts.length} ouverte${q.data.alerts.length > 1 ? "s" : ""}, triées par gravité`} />
      <section aria-label="Alertes" style={{ ...card, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 4 }}>
        {q.data.alerts.map((a, i) => {
          const tag = TAG[a.kind] ?? { label: a.kind, style: {} };
          return (
            <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "14px 0", borderTop: i === 0 ? "none" : "1px solid #E3E6EA" }}>
              <span style={{ flex: "0 0 auto", minWidth: 128, height: 26, padding: "0 10px", boxSizing: "border-box", borderRadius: 6, fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", ...tag.style }}>
                {tag.label}
              </span>
              <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: 600 }}>{a.title ?? a.milestone ?? tag.label}</span>
                <span style={{ fontSize: 14, color: C.discret }}>{alertDetail(a)}</span>
              </div>
              <button type="button" onClick={goTaches}
                style={{ flex: "0 0 auto", height: 36, padding: "0 14px", borderRadius: 8, border: `1px solid ${C.bordure}`, background: C.surface, font: "inherit", fontSize: 14, cursor: "pointer" }}>
                Ouvrir
              </button>
            </div>
          );
        })}
        {q.data.alerts.length === 0 && <p style={{ color: C.ok }}>Aucune alerte. Tout est au vert.</p>}
      </section>
    </>
  );
}

export function Synthese({ role }: { role: string }) {
  const q = useQuery({
    queryKey: ["synthesis"],
    queryFn: () => api<{ week: number; text: string }>("/api/synthesis"),
    enabled: role === "pilot",
  });
  if (role !== "pilot") {
    return (
      <>
        <PageHead title="Synthèse et export" />
        <div style={card}><p style={{ margin: 0, color: C.discret }}>La synthèse est réservée au pilote.</p></div>
      </>
    );
  }
  return (
    <>
      <PageHead title="Synthèse et export" sub={q.data ? `Semaine S${String(q.data.week).padStart(2, "0")}` : undefined} />
      <section aria-label="Synthèse de la semaine" style={card}>
        <h2 style={{ margin: "0 0 8px", fontFamily: F_TITRE, fontSize: 20, fontWeight: 600 }}>À relire avant le point du lundi</h2>
        <p style={{ fontSize: 16, lineHeight: 1.6 }}>{q.data?.text ?? "Chargement…"}</p>
      </section>
      <section aria-label="Export" style={card}>
        <h2 style={{ margin: "0 0 8px", fontFamily: F_TITRE, fontSize: 20, fontWeight: 600 }}>Prévu contre réalisé (soutenance)</h2>
        <p style={{ color: C.discret }}>Le « prévu » est lu dans la baseline du lundi, pas dans le planning courant.</p>
        <a href="/api/export" style={{ display: "inline-flex", alignItems: "center", height: 44, padding: "0 18px", borderRadius: 8, background: C.accent, color: "#FFFFFF", fontWeight: 600, textDecoration: "none" }}>
          Télécharger le JSON prévu / réalisé
        </a>
      </section>
    </>
  );
}
