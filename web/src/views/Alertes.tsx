/** Alertes (toutes, triées par gravité) et Synthèse et export (texte du lundi, prévu contre réalisé). */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { IconCopy, IconDownload } from "@tabler/icons-react";
import { Badge, Button } from "@mantine/core";
import { PageSkeleton } from "../skeletons";
import { api, fmtDate, fmtH } from "../api";
import { AXES, C, F_TITRE, PageHead, card, ink, muted, track } from "../theme";

const STATUS_FR: Record<string, string> = { todo: "À faire", in_progress: "En cours", blocked: "Bloquée", done: "Terminée" };

export interface Alert {
  kind: string; severity: number; title?: string; milestone?: string;
  user?: string; week?: number; task_id?: string; since?: string; succ_title?: string;
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

/** « Sophie : » devant le détail quand l'alerte concerne une personne. */
const who = (a: Alert) => (a.user ? `${a.user} : ` : "");

export function alertDetail(a: Alert): string {  switch (a.kind) {
    case "milestone-threatened":
      return a.milestone ? `« ${a.milestone} » menacé.` : `« ${a.title ?? ""} » en retard sur le chemin critique.`;
    case "blocking-late":
      return a.succ_title ? `bloque « ${a.succ_title} », qui démarre bientôt.` : "bloque une tâche qui démarre bientôt.";
    case "late":
      return `${who(a)}échéance dépassée, tâche non terminée.`;
    case "overload":
      return `${who(a)}charge prévue au-dessus de la capacité en semaine ${a.week}.`;
    case "missing-hours":
      return `${who(a)}aucune heure saisie pour la semaine ${a.week}.`;
    case "overrun":
      return `${who(a)}heures réelles au-dessus du prévu.`;
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

interface ExportData {
  week: number;
  baseline_taken_at: string | null;
  tasks: { id: string; title: string; axis: string; planned: number; real: number; status_now: string | null }[] | null;
  persons: { user_id: string; name: string; planned_baseline: number; planned_to_date: number; real: number }[];
}

/** CSV pour Excel/Sheets en français : « ; », virgule décimale, BOM UTF-8. */
function csv(rows: (string | number)[][]) {
  const cell = (v: string | number) => {
    const t = typeof v === "number" ? String(Math.round(v * 10) / 10).replace(".", ",") : v;
    return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return "\ufeff" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
}

function download(name: string, content: BlobPart, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function Synthese({ role }: { role: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["synthesis"],
    queryFn: () => api<{ week: number; text: string }>("/api/synthesis"),
    enabled: role === "pilot",
  });
  const exp = useQuery({ queryKey: ["export"], queryFn: () => api<ExportData>("/api/export"), enabled: role === "pilot" });
  if (role !== "pilot") {
    return (
      <>
        <PageHead title="Synthèse et export" />
        <div style={card}><p style={{ margin: 0, color: muted }}>La synthèse et l'export sont réservés au chef de projet.</p></div>
      </>
    );
  }
  if (!q.data || !exp.data) return <PageSkeleton kind="liste" />;
  const e = exp.data;
  const taken = e.baseline_taken_at ? new Date(e.baseline_taken_at) : null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(q.data.text);
      notifications.show({ message: "Texte copié", color: "ok" });
    } catch {
      notifications.show({ message: "Copie impossible : sélectionne le texte à la main.", color: "warn" });
    }
  };
  const snap = async () => {
    try {
      await api("/api/baselines", { method: "POST" });
      notifications.show({ message: "Photo de la semaine prise", color: "ok" });
      qc.invalidateQueries({ queryKey: ["export"] });
    } catch {
      notifications.show({ message: "Photo non enregistrée. Réessaie.", color: "crit" });
    }
  };
  const csvTasks = () => download(`prevu-realise-taches-S${String(e.week).padStart(2, "0")}.csv`, csv([
    ["Tâche", "Axe", "Prévu (h)", "Réalisé (h)", "Écart (h)", "Statut"],
    ...(e.tasks ?? []).map((t) => [t.title, AXES[t.axis]?.label ?? t.axis, t.planned, t.real, t.real - t.planned, STATUS_FR[t.status_now ?? ""] ?? t.status_now ?? ""]),
  ]), "text/csv;charset=utf-8");
  const csvPersons = () => download(`prevu-realise-personnes-S${String(e.week).padStart(2, "0")}.csv`, csv([
    ["Personne", "Prévu à date (h)", "Prévu total (h)", "Réalisé (h)", "Écart à date (h)"],
    ...e.persons.map((p) => [p.name, p.planned_to_date, p.planned_baseline, p.real, p.real - p.planned_to_date]),
  ]), "text/csv;charset=utf-8");

  return (
    <>
      <PageHead title="Synthèse et export" sub={`Semaine ${e.week}`} />
      <section aria-labelledby="synth-titre" style={{ ...card, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <h2 id="synth-titre" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>À relire avant le point du lundi</h2>
          <Button variant="default" size="sm" leftSection={<IconCopy size={16} stroke={1.6} />} onClick={copy}>Copier le texte</Button>
        </div>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, whiteSpace: "pre-line", maxWidth: "75ch" }}>{q.data.text}</p>
      </section>

      <section aria-labelledby="export-titre" style={{ ...card, display: "grid", gap: 14 }}>
        <div>
          <h2 id="export-titre" style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 600 }}>Prévu contre réalisé</h2>
          <p style={{ margin: 0, color: muted, fontSize: 14 }}>
            {taken
              ? `Prévu lu dans la photo du ${taken.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} à ${taken.getHours()} h ${String(taken.getMinutes()).padStart(2, "0")}, réalisé à ce jour.`
              : "Pas encore de photo pour cette semaine : elle est prise automatiquement, ou maintenant à la main."}
          </p>
        </div>
        {taken && (
          <div style={{ overflowX: "auto" }}>
            <table className="num" style={{ borderCollapse: "collapse", width: "100%", fontSize: 13.5 }}>
              <thead>
                <tr style={{ color: muted, textAlign: "right" }}>
                  <th style={{ textAlign: "left", fontWeight: 500, padding: "6px 8px" }}>Personne</th>
                  <th style={{ fontWeight: 500, padding: "6px 8px" }}>Prévu à date</th>
                  <th style={{ fontWeight: 500, padding: "6px 8px" }}>Prévu total</th>
                  <th style={{ fontWeight: 500, padding: "6px 8px" }}>Réalisé</th>
                  <th style={{ fontWeight: 500, padding: "6px 8px" }}>Écart</th>
                </tr>
              </thead>
              <tbody>
                {e.persons.map((p) => {
                  const gap = p.real - p.planned_to_date;
                  return (
                    <tr key={p.user_id} style={{ borderTop: "1px solid var(--border)", textAlign: "right" }}>
                      <td style={{ textAlign: "left", padding: "7px 8px", fontFamily: "var(--font-sans)", fontWeight: 500 }}>{p.name}</td>
                      <td style={{ padding: "7px 8px" }}>{fmtH(p.planned_to_date)}</td>
                      <td style={{ padding: "7px 8px", color: muted }}>{fmtH(p.planned_baseline)}</td>
                      <td style={{ padding: "7px 8px" }}>{fmtH(p.real)}</td>
                      <td style={{ padding: "7px 8px", color: gap > 0 ? "var(--warn-text)" : muted }}>{gap > 0 ? "+" : ""}{fmtH(gap)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {taken ? (
            <>
              <Button leftSection={<IconDownload size={16} stroke={1.6} />} onClick={csvTasks}>Tableau par tâche (CSV)</Button>
              <Button variant="default" leftSection={<IconDownload size={16} stroke={1.6} />} onClick={csvPersons}>Par personne (CSV)</Button>
              <Button variant="subtle" color="gray" onClick={() => download(`suivi-export-S${String(e.week).padStart(2, "0")}.json`, JSON.stringify(e, null, 2), "application/json")}>JSON complet</Button>
            </>
          ) : (
            <Button onClick={snap}>Prendre la photo maintenant</Button>
          )}
        </div>
      </section>
    </>
  );
}
