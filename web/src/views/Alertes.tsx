/** Écran Alertes : reprend la maquette docs/maquettes (structure + jetons), données live. */
import { useQuery } from "@tanstack/react-query";
import { Badge, Button } from "@mantine/core";
import { PageSkeleton } from "../skeletons";
import { api, fmtDate } from "../api";
import { C, F_TITRE, PageHead, card, ink, muted, track } from "../theme";

export interface Alert {
  kind: string; severity: number; title?: string; milestone?: string;
  user?: string; week?: number; task_id?: string; since?: string;
}

export const TAG: Record<string, { label: string; style: React.CSSProperties }> = {
  "milestone-threatened": { label: "Jalon menacé", style: { background: C.crit, color: "var(--on-accent)" } },
  "blocking-late": { label: "Retard bloquant", style: { background: C.critFond, color: "var(--crit-text)" } },
  late: { label: "Tâche en retard", style: { background: C.critFond, color: "var(--crit-text)" } },
  overload: { label: "Surcharge prévue", style: { background: C.warnFond, color: "var(--warn-text)" } },
  "missing-hours": { label: "Heures non déclarées", style: { background: C.warnFond, color: "var(--warn-text)" } },
  overrun: { label: "Dépassement réel", style: { background: "var(--sunken)", color: ink } },
  incomplete: { label: "Tâche incomplète", style: { background: "var(--sunken)", color: ink } },
  "validation-pending": { label: "Validation en attente", style: { background: "var(--sunken)", color: ink } },
};

export function alertDetail(a: Alert): string {  switch (a.kind) {
    case "milestone-threatened":
      return a.milestone ? `« ${a.milestone} » menacé.` : `« ${a.title ?? ""} » en retard sur le chemin critique.`;
    case "blocking-late":
      return `${a.user ?? ""} · bloque une tâche qui démarre bientôt (seuil des réglages).`;
    case "late":
      return `${a.user ?? ""} · échéance dépassée et tâche non terminée.`;
    case "overload":
      return `${a.user ?? ""} · charge prévue au-dessus de la capacité en S${a.week}.`;
    case "missing-hours":
      return `${a.user ?? ""} · aucune saisie pour la S${a.week}.`;
    case "overrun":
      return `${a.user ?? ""} · réel au-dessus du prévu, au-delà du seuil des réglages.`;
    case "incomplete":
      return `Sans pilote ou sans heures prévues.`;
    case "validation-pending":
      return `Proposée le ${a.since ? fmtDate(a.since) : "?"}, toujours à valider.`;
    default:
      return "";
  }
}

export function Alertes({ goTaches }: { goTaches: (taskId?: string) => void }) {
  const q = useQuery({
    queryKey: ["alerts"], queryFn: () => api<{ alerts: Alert[] }>("/api/alerts"),
  });
  if (!q.data) return <PageSkeleton kind="liste" />;
  return (
    <>
      <PageHead title="Alertes" sub={`${q.data.alerts.length} ouverte${q.data.alerts.length > 1 ? "s" : ""}, triées par gravité`} />
      <section aria-label="Alertes" style={{ ...card, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 4 }}>
        {q.data.alerts.map((a, i) => {
          const tag = TAG[a.kind] ?? { label: a.kind, style: {} };
          return (
            <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "14px 0", borderTop: i === 0 ? "none" : `1px solid ${track}` }}>
              <Badge color={a.severity >= 3 ? "crit" : a.severity === 2 ? "warn" : "gray"} variant="light" size="lg" radius="sm" style={{ flex: "0 0 auto" }}>
                {tag.label}
              </Badge>
              <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: 600 }}>{a.title ?? a.milestone ?? tag.label}</span>
                <span style={{ fontSize: 14, color: muted }}>{alertDetail(a)}</span>
              </div>
              <Button variant="default" onClick={() => goTaches(a.task_id)}>
                Ouvrir
              </Button>
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
        <div style={card}><p style={{ margin: 0, color: muted }}>La synthèse est réservée au pilote.</p></div>
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
        <p style={{ color: muted }}>Le « prévu » est lu dans la baseline du lundi, pas dans le planning courant.</p>
        <button
          style={{ display: "inline-flex", alignItems: "center", height: 44, padding: "0 18px", border: 0, borderRadius: 8, background: C.accent, color: "var(--on-accent)", fontWeight: 600, fontSize: 14, cursor: "pointer" }}
          onClick={async () => {
            const r = await fetch("/api/export");
            if (!r.ok) return;
            const blob = await r.blob();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "suivi-export.json";
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          Télécharger le JSON prévu / réalisé
        </button>
      </section>
    </>
  );
}
