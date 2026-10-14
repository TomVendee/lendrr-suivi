/** Écran Meteo : reprend la maquette docs/maquettes (structure + jetons), données live. */
import { useQuery } from "@tanstack/react-query";
import { api, fmtDate, fmtH, useUsers, type Task } from "../api";
import { TAG as ALERT_TAG } from "./Alertes";
import { C, F_MONO, F_TITRE, PageHead, btnPrimary, card, kpi } from "../theme";

interface MeteoCard {
  axis: string; label: string; total: number; done: number; progress: number;
  late: { title: string }[];
  next_milestone: { id: string; title: string; date: string; risk: string | null } | null;
}
interface Alert {
  kind: string; severity: number; title?: string; user?: string; week?: number;
  milestone?: string; task_id?: string;
}
interface GanttT {
  id: string; title: string; start: string; end: string; status: string; milestone: boolean;
}

const AXIS_LABEL: Record<string, string> = { HARD: "HARD", SOFT: "SOFT", IA: "IA", PILOTAGE: "PILOTAGE", VIDEO: "VIDÉO" };

function alertDetail(a: Alert): string {
  switch (a.kind) {
    case "milestone-threatened":
      return a.milestone ? `« ${a.milestone} » menacé.` : `« ${a.title ?? ""} » en retard sur le chemin critique.`;
    case "blocking-late":
      return `${a.user ?? ""} · bloque une tâche qui démarre cette semaine.`;
    case "late":
      return `${a.user ?? ""} · échéance dépassée.`;
    case "overload":
      return `${a.user ?? ""} · semaine S${a.week} au-dessus de la capacité.`;
    case "missing-hours":
      return `${a.user ?? ""} · rien saisi pour la S${a.week}.`;
    case "overrun":
      return `${a.user ?? ""} · réel au-dessus du prévu.`;
    case "incomplete":
      return `Sans pilote ou sans heures prévues.`;
    default:
      return "";
  }
}

const daysUntil = (iso: string) =>
  Math.round((new Date(iso).getTime() - Date.now()) / 86400000);

export function Meteo({ goSynthese }: { goSynthese: () => void }) {
  const meteo = useQuery({
    queryKey: ["meteo"], queryFn: () => api<{ cards: MeteoCard[] }>("/api/meteo"),
  });
  const alerts = useQuery({
    queryKey: ["alerts"], queryFn: () => api<{ alerts: Alert[] }>("/api/alerts"),
  });
  const gantt = useQuery({
    queryKey: ["gantt-all"], queryFn: () => api<{ today: string; tasks: GanttT[] }>("/api/gantt"),
  });
  const tasks = useQuery({ queryKey: ["tasks-all"], queryFn: () => api<Task[]>("/api/tasks") });
  const users = useUsers();
  const load = useQuery({
    queryKey: ["load-now"],
    queryFn: () => api<{ rows: { weeks: { week: number; planned: number; real: number; capacity: number }[] }[] }>("/api/load"),
  });

  if (!meteo.data) return <p>Chargement…</p>;
  const nameOf = (id: string) => users.data?.find((u) => u.id === id)?.name ?? "";
  const milestones = (gantt.data?.tasks ?? [])
    .filter((t) => t.milestone && t.status !== "done")
    .sort((a, b) => a.start.localeCompare(b.start));
  const soutenance = [...(gantt.data?.tasks ?? [])]
    .filter((t) => t.milestone)
    .sort((a, b) => b.start.localeCompare(a.start))[0];
  const allAlerts = alerts.data?.alerts ?? [];
  const nCrit = allAlerts.filter((a) => a.severity >= 3).length;

  const curWeek = load.data?.rows[0]?.weeks.find((w) => w.planned > 0 || w.real > 0 || w.capacity > 0);
  const teamPlanned = load.data?.rows.reduce((s, r) => s + (r.weeks.find((w) => w.week === curWeek?.week)?.planned ?? 0), 0) ?? 0;
  const teamCapa = load.data?.rows.reduce((s, r) => s + (r.weeks.find((w) => w.week === curWeek?.week)?.capacity ?? 0), 0) ?? 0;
  const teamReal = load.data?.rows.reduce((s, r) => s + (r.weeks.find((w) => w.week === curWeek?.week)?.real ?? 0), 0) ?? 0;

  const axisMembers = (code: string) => {
    const ids = new Set<string>();
    (tasks.data ?? []).filter((t) => t.axis_code === code).forEach((t) =>
      t.assignments.forEach((a) => ids.add(a.user_id)));
    return [...ids].map(nameOf).filter(Boolean).join(" · ");
  };
  const axisNext = (code: string) => {
    const up = (tasks.data ?? [])
      .filter((t) => t.axis_code === code && !t.milestone && t.status !== "done")
      .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
    return up ? `${up.title} · ${fmtDate(up.start_date)}` : undefined;
  };

  return (
    <>
      <PageHead
        title="Météo du projet"
        sub={curWeek ? `Semaine S${String(curWeek.week).padStart(2, "0")}` : undefined}
        right={soutenance ? (
          <>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 36, padding: "0 14px", borderRadius: 18, background: C.surface, border: `1px solid ${C.bordure}`, fontSize: 14 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: C.accent }} />
              {soutenance.title} dans <strong style={{ fontFamily: F_MONO }}>{daysUntil(soutenance.start)} jours</strong>
            </span>
            <button style={{ ...btnPrimary, height: 44, padding: "0 18px", fontSize: 14 }} onClick={goSynthese}>
              Synthèse S{curWeek ? String(curWeek.week).padStart(2, "0") : ""}
            </button>
          </>
        ) : undefined}
      />
      <section aria-label="Indicateurs de la semaine" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <div style={kpi}>
          <span style={{ fontSize: 13, color: C.discret }}>Prochain jalon</span>
          <span style={{ fontWeight: 600, fontSize: 16 }}>{milestones[0]?.title ?? "Aucun"}</span>
          {milestones[0] && <span style={{ fontFamily: F_MONO, fontSize: 14, color: C.discret }}>{fmtDate(milestones[0].start)} · dans {daysUntil(milestones[0].start)} jours</span>}
        </div>
        <div style={kpi}>
          <span style={{ fontSize: 13, color: C.discret }}>Alertes ouvertes</span>
          <span style={{ fontFamily: F_MONO, fontWeight: 600, fontSize: 30, lineHeight: 1.1 }}>{allAlerts.length}</span>
          <span style={{ fontSize: 14, color: C.crit, fontWeight: 500 }}>{nCrit > 0 ? `dont ${nCrit} critique${nCrit > 1 ? "s" : ""}` : "aucune critique"}</span>
        </div>
        <div style={kpi}>
          <span style={{ fontSize: 13, color: C.discret }}>Charge équipe</span>
          <span style={{ fontFamily: F_MONO, fontWeight: 600, fontSize: 30, lineHeight: 1.1 }}>
            {fmtH(teamPlanned)} <span style={{ fontSize: 15, fontWeight: 400, color: C.discret }}>/ {fmtH(teamCapa)} de capacité</span>
          </span>
          <div aria-hidden="true" style={{ height: 8, borderRadius: 4, background: "#E3E6EA", overflow: "hidden" }}>
            <div style={{ width: `${teamCapa ? Math.min(100, (teamPlanned / teamCapa) * 100) : 0}%`, height: "100%", background: teamPlanned > teamCapa ? C.crit : C.ok }} />
          </div>
        </div>
        <div style={kpi}>
          <span style={{ fontSize: 13, color: C.discret }}>Heures déclarées</span>
          <span style={{ fontFamily: F_MONO, fontWeight: 600, fontSize: 30, lineHeight: 1.1 }}>
            {fmtH(teamReal)} <span style={{ fontSize: 15, fontWeight: 400, color: C.discret }}>/ {fmtH(teamPlanned)} prévues</span>
          </span>
          <div aria-hidden="true" style={{ height: 8, borderRadius: 4, background: "#E3E6EA", overflow: "hidden" }}>
            <div style={{ width: `${teamPlanned ? Math.min(100, (teamReal / teamPlanned) * 100) : 0}%`, height: "100%", background: C.encre }} />
          </div>
        </div>
      </section>

      <section aria-labelledby="axes-titre" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="axes-titre" style={{ margin: 0, fontFamily: F_TITRE, fontSize: 20, fontWeight: 600 }}>Par axe</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16 }}>
          {meteo.data.cards.map((c) => {
            const delivered = c.total > 0 && c.done === c.total;
            const watch = !delivered && (c.late.length > 0 || c.next_milestone?.risk);
            return (
              <article key={c.axis} style={{ ...card, background: delivered ? "#E9EBEE" : C.surface, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <h3 style={{ margin: 0, fontFamily: F_TITRE, fontSize: 18, fontWeight: 700, letterSpacing: "0.04em" }}>{AXIS_LABEL[c.axis] ?? c.axis}</h3>
                  {delivered ? (
                    <span style={{ height: 26, padding: "0 10px", borderRadius: 13, background: C.encre, color: C.fond, fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center" }}>Livrée</span>
                  ) : watch ? (
                    <span style={{ height: 26, padding: "0 10px", borderRadius: 13, background: C.warnFond, color: "#8A5A12", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>À surveiller</span>
                  ) : (
                    <span style={{ height: 26, padding: "0 10px", borderRadius: 13, background: C.okFond, color: "#23603C", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>Au vert</span>
                  )}
                </div>
                <span style={{ fontSize: 13, color: C.discret }}>{axisMembers(c.axis)}</span>
                <div aria-hidden="true" style={{ height: 6, borderRadius: 3, background: "#E3E6EA", overflow: "hidden" }}>
                  <div style={{ width: `${c.progress * 100}%`, height: "100%", background: watch ? C.warn : delivered ? C.encre : C.ok }} />
                </div>
                <span style={{ fontFamily: F_MONO, fontSize: 13, color: C.discret }}>
                  {c.done} / {c.total} tâches{c.next_milestone ? ` · ${c.next_milestone.risk ? "1 jalon menacé" : "dans les temps"}` : ""}
                </span>
                {(axisNext(c.axis) || c.next_milestone) && (
                  <div style={{ borderTop: "1px solid #E3E6EA", paddingTop: 10, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 12, color: C.discret, textTransform: "uppercase", letterSpacing: "0.06em" }}>Ensuite</span>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>
                      {c.next_milestone ? `◆ ${c.next_milestone.title} · ${fmtDate(c.next_milestone.date)}` : axisNext(c.axis)}
                    </span>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
        <section aria-labelledby="alertes-titre" style={{ ...card, flex: "3 1 480px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingBottom: 8 }}>
            <h2 id="alertes-titre" style={{ margin: 0, fontFamily: F_TITRE, fontSize: 20, fontWeight: 600 }}>Alertes</h2>
          </div>
          {allAlerts.slice(0, 4).map((a, i) => {
            const tag = ALERT_TAG[a.kind] ?? { label: a.kind, style: {} };
            return (
              <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "14px 0", borderTop: "1px solid #E3E6EA" }}>
                <span style={{ flex: "0 0 auto", minWidth: 128, height: 26, padding: "0 10px", boxSizing: "border-box", borderRadius: 6, fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", ...tag.style }}>
                  {tag.label}
                </span>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontWeight: 600 }}>{a.title ?? a.milestone ?? tag.label}</span>
                  <span style={{ fontSize: 14, color: C.discret }}>{alertDetail(a)}</span>
                </div>
              </div>
            );
          })}
          {allAlerts.length === 0 && <p style={{ color: C.ok }}>Aucune alerte. Tout est au vert.</p>}
        </section>
        <section aria-labelledby="jalons-titre" style={{ flex: "2 1 320px", minWidth: 0, background: C.encre, color: C.fond, borderRadius: 12, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 id="jalons-titre" style={{ margin: "0 0 8px", fontFamily: F_TITRE, fontSize: 20, fontWeight: 600 }}>Prochains jalons</h2>
          {milestones.map((j) => {
            const d = daysUntil(j.start);
            const proche = d <= 21;
            return (
              <div key={j.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderTop: "1px solid #3A3F44" }}>
                <span aria-hidden="true" style={{ flex: "0 0 auto", width: 12, height: 12, transform: "rotate(45deg)", background: proche ? C.accent : "transparent", border: proche ? "none" : "2px solid #B9BEC4", boxSizing: "border-box" }} />
                <span style={{ flex: 1, minWidth: 0 }}>{j.title}</span>
                <span style={{ fontFamily: F_MONO, fontSize: 14 }}>{fmtDate(j.start)}</span>
                <span style={{ width: 64, textAlign: "right", fontFamily: F_MONO, fontSize: 13, color: C.navMuted }}>J-{d}</span>
              </div>
            );
          })}
          {milestones.length === 0 && <p style={{ color: C.navMuted }}>Aucun jalon à venir.</p>}
        </section>
      </div>
    </>
  );
}
