/** Météo du projet : le casier (un compartiment par axe), indicateurs de la semaine, alertes, jalons. */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@mantine/core";
import { IconArrowRight } from "@tabler/icons-react";
import { PageSkeleton } from "../skeletons";
import { api, fmtDate, fmtH, type Task } from "../api";
import { CountUp } from "../motion";
import { navigate } from "../router";
import { TAG, alertDetail, type Alert } from "./Alertes";
import { AXES, PageHead, card, kpi, muted, track } from "../theme";
import "../styles/meteo.css";

interface MeteoCard {
  axis: string; label: string; total: number; done: number; progress: number;
  late: { title: string }[];
  next_milestone: { id: string; title: string; date: string; risk: string | null } | null;
}
interface GanttT { id: string; title: string; start: string; end: string; status: string; milestone: boolean }
interface Load { current: number; rows: { weeks: { week: number; planned: number; real: number; capacity: number }[] }[] }

/** Jours ouvrés (lun.-ven.) d'ici à la date, aujourd'hui exclu. */
function workdaysUntil(iso: string) {
  const end = new Date(iso + "T00:00:00");
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  let n = 0;
  while (d < end) {
    d.setDate(d.getDate() + 1);
    const w = d.getDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

const STATE_LABEL = { ok: "Au vert", watch: "À surveiller", late: "En retard", done: "Livré" } as const;
type State = keyof typeof STATE_LABEL;
const pct = (n: number) => `${Math.round(n)} %`;

export function Meteo({ goSynthese }: { goSynthese: () => void }) {
  const meteo = useQuery({ queryKey: ["meteo"], queryFn: () => api<{ cards: MeteoCard[] }>("/api/meteo") });
  const alerts = useQuery({ queryKey: ["alerts"], queryFn: () => api<{ alerts: Alert[] }>("/api/alerts") });
  const gantt = useQuery({ queryKey: ["gantt-all"], queryFn: () => api<{ today: string; tasks: GanttT[] }>("/api/gantt") });
  const tasks = useQuery({ queryKey: ["tasks-all"], queryFn: () => api<Task[]>("/api/tasks") });
  const load = useQuery({ queryKey: ["load-now"], queryFn: () => api<Load>("/api/load") });
  // L'animation d'entrée du casier ne joue qu'une fois par visite de l'écran.
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), 1600);
    return () => clearTimeout(t);
  }, []);

  if (!meteo.data) return <PageSkeleton kind="meteo" />;
  const cards = meteo.data.cards;
  const allAlerts = alerts.data?.alerts ?? [];
  const nCrit = allAlerts.filter((a) => a.severity >= 3).length;
  const milestones = (gantt.data?.tasks ?? []).filter((t) => t.milestone && t.status !== "done").sort((a, b) => a.start.localeCompare(b.start));
  const finale = milestones[milestones.length - 1];

  const week = load.data?.current;
  const sum = (k: "planned" | "real" | "capacity") =>
    load.data?.rows.reduce((s, r) => s + (r.weeks.find((w) => w.week === week)?.[k] ?? 0), 0) ?? 0;
  const [planned, real, capacity] = [sum("planned"), sum("real"), sum("capacity")];
  const monday = week ? new Date(2026, 7, 24 + (week - 1) * 7) : null;
  const friday = monday ? new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 4) : null;
  const dm = (d: Date) => `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, "0")}`;

  const total = cards.reduce((s, c) => s + c.total, 0);
  const done = cards.reduce((s, c) => s + c.done, 0);
  const lateTotal = cards.reduce((s, c) => s + c.late.length, 0);
  const blocked = (code: string) => (tasks.data ?? []).filter((t) => t.axis_code === code && t.status === "blocked").length;
  // Retard > tâche bloquée ou jalon menacé > au vert.
  const stateOf = (c: MeteoCard): State =>
    c.total > 0 && c.done === c.total ? "done"
      : c.late.length > 0 ? "late"
      : blocked(c.axis) > 0 || c.next_milestone?.risk ? "watch" : "ok";
  const nextOf = (code: string) => {
    const t = (tasks.data ?? [])
      .filter((x) => x.axis_code === code && !x.milestone && x.status !== "done")
      .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
    return t ? { title: t.title, date: t.start_date } : null;
  };
  const projectState: State = lateTotal > 0 ? "late" : cards.some((c) => stateOf(c) === "watch") ? "watch" : "ok";

  return (
    <>
      <PageHead
        title="Météo du projet"
        sub={week && monday && friday ? `Semaine ${week}, du ${dm(monday)} au ${dm(friday)}` : undefined}
        right={
          <>
            {finale && (
              <span style={{ fontSize: 13, color: muted }}>
                <strong className="num" style={{ color: "var(--text-1)" }}>{workdaysUntil(finale.start)} jours ouvrés</strong> avant « {finale.title} »
              </span>
            )}
            <Button onClick={goSynthese} rightSection={<IconArrowRight size={16} stroke={1.8} />}>
              Synthèse de la semaine
            </Button>
          </>
        }
      />

      <section aria-label="Avancement par axe" className="locker" data-intro={intro || undefined}>
        <div className="cell cell-total" data-state={projectState} style={{ "--fill": total ? done / total : 0, "--i": 0 } as React.CSSProperties}
          role="group" aria-label="Projet entier">
          <span className="cell-head">
            <span className="cell-name">Projet</span>
            <span className="cell-state"><span className="led" aria-hidden="true" />{STATE_LABEL[projectState]}</span>
          </span>
          <span className="cell-big"><CountUp value={total ? (done / total) * 100 : 0} format={pct} /></span>
          <span className="cell-sub">
            {done} tâches terminées sur {total}{lateTotal > 0 ? `, ${lateTotal} en retard` : ""}
          </span>
          <span className="gauge" aria-hidden="true"><span /></span>
        </div>
        {cards.map((c, i) => {
          const st = stateOf(c);
          const next = c.next_milestone ? { title: c.next_milestone.title, date: c.next_milestone.date } : nextOf(c.axis);
          return (
            <button key={c.axis} className="cell" data-state={st}
              style={{ "--axis": AXES[c.axis]?.color, "--fill": c.progress, "--i": i + 1 } as React.CSSProperties}
              onClick={() => navigate(`/taches?axe=${c.axis}`)}
              aria-label={`${AXES[c.axis]?.label ?? c.label} : ${STATE_LABEL[st]}, ${c.done} tâches terminées sur ${c.total}. Voir les tâches`}>
              <span className="cell-head">
                <span className="cell-name">{AXES[c.axis]?.label ?? c.label}</span>
                <span className="cell-state"><span className="led" aria-hidden="true" />{STATE_LABEL[st]}</span>
              </span>
              <span className="cell-big">{c.done}<small> / {c.total}</small></span>
              <span className="cell-sub">
                {c.late.length > 0 ? `${c.late.length} en retard`
                  : blocked(c.axis) > 0 ? `${blocked(c.axis)} bloquée${blocked(c.axis) > 1 ? "s" : ""}`
                  : c.next_milestone?.risk ? `Jalon ${c.next_milestone.risk}` : "tâches terminées"}
              </span>
              <span className="gauge" aria-hidden="true"><span /></span>
              {next && <span className="cell-next">Ensuite <strong>{next.title}</strong>, {fmtDate(next.date)}</span>}
            </button>
          );
        })}
      </section>

      <section aria-label="Indicateurs de la semaine" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
        <div style={kpi}>
          <span style={{ fontSize: 13, color: muted }}>Charge de l'équipe</span>
          <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em" }}>
            <CountUp value={planned} format={fmtH} /> <span style={{ fontSize: 14, fontWeight: 400, color: muted }}>sur {fmtH(capacity)}</span>
          </span>
          <Bar value={capacity ? planned / capacity : 0} tone={planned > capacity ? "var(--crit)" : "var(--ok)"} />
        </div>
        <div style={kpi}>
          <span style={{ fontSize: 13, color: muted }}>Heures déclarées</span>
          <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em" }}>
            <CountUp value={real} format={fmtH} /> <span style={{ fontSize: 14, fontWeight: 400, color: muted }}>sur {fmtH(planned)} prévues</span>
          </span>
          <Bar value={planned ? real / planned : 0} tone="var(--accent)" />
        </div>
        <button style={{ ...kpi, cursor: "pointer", font: "inherit", textAlign: "left", color: "inherit" }} data-row onClick={() => navigate("/alertes")}>
          <span style={{ fontSize: 13, color: muted }}>Alertes ouvertes</span>
          <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em" }}><CountUp value={allAlerts.length} format={(n) => String(Math.round(n))} /></span>
          <span style={{ fontSize: 13, fontWeight: 500, color: nCrit ? "var(--crit-text)" : "var(--ok-text)" }}>
            {nCrit ? `${nCrit} critique${nCrit > 1 ? "s" : ""}` : "Aucune critique"}
          </span>
        </button>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 16, alignItems: "start" }}>
        <section aria-labelledby="alertes-titre" style={card}>
          <h2 id="alertes-titre" style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 600 }}>Alertes</h2>
          {allAlerts.slice(0, 4).map((a, i) => {
            const tag = TAG[a.kind] ?? { label: a.kind, style: {} };
            return (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "12px 0", borderTop: i ? `1px solid ${track}` : "none" }}>
                <span style={{ flex: "0 0 auto", padding: "2px 8px", borderRadius: "var(--radius-sm)", fontSize: 12, fontWeight: 500, ...tag.style }}>{tag.label}</span>
                <span style={{ minWidth: 0, fontSize: 14 }}>
                  <strong style={{ fontWeight: 500 }}>{a.title ?? a.milestone ?? ""}</strong>{" "}
                  <span style={{ color: muted }}>{alertDetail(a)}</span>
                </span>
              </div>
            );
          })}
          {allAlerts.length === 0 && <p style={{ color: "var(--ok-text)", margin: "8px 0 0" }}>Aucune alerte ouverte.</p>}
        </section>
        <section aria-labelledby="jalons-titre" style={card}>
          <h2 id="jalons-titre" style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 600 }}>Prochains jalons</h2>
          <div className="timeline">
            {milestones.map((j) => {
              const d = workdaysUntil(j.start);
              return (
                <div key={j.id} className="ms" data-near={d <= 15 || undefined}>
                  <span className="ms-mark" aria-hidden="true" />
                  <span style={{ minWidth: 0, fontWeight: 500 }}>{j.title}</span>
                  <span className="num" style={{ fontSize: 13, color: muted }}>{fmtDate(j.start)}</span>
                  <span className="ms-count">J-{d}</span>
                </div>
              );
            })}
          </div>
          {milestones.length === 0 && <p style={{ color: muted, margin: "8px 0 0" }}>Aucun jalon à venir.</p>}
        </section>
      </div>
    </>
  );
}

function Bar({ value, tone }: { value: number; tone: string }) {
  return (
    <div aria-hidden="true" style={{ height: 6, borderRadius: 3, background: "var(--sunken-2)", overflow: "hidden", marginTop: "auto" }}>
      <div style={{ width: `${Math.min(100, value * 100)}%`, height: "100%", background: tone, borderRadius: 3, transition: "width var(--dur-slow) var(--ease-out)" }} />
    </div>
  );
}
