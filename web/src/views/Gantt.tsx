/** Gantt et chemin critique : barres par axe, zoom, déplacement à la souris ou au clavier, aperçu de cascade. */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Checkbox, SegmentedControl, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconChevronRight } from "@tabler/icons-react";
import { PageSkeleton } from "../skeletons";
import { api, fmtDate, useUsers } from "../api";
import { navigate } from "../router";
import { TaskDetailSheet } from "./TaskSheet";
import { AXES, PageHead, card, muted } from "../theme";
import "../styles/gantt.css";

interface GTask {
  id: string; title: string; axis: string; start: string; end: string;
  status: string; milestone: boolean; critical: boolean;
}
interface GanttData { today: string; tasks: GTask[]; deps: { from: string; to: string }[] }

const AXIS_ORDER = ["HARD", "SOFT", "IA", "PILOTAGE", "VIDEO"] as const;
const STATUS_FR: Record<string, string> = { todo: "À faire", in_progress: "En cours", blocked: "Bloquée", done: "Terminée" };
const HEAD = 52, ROW_T = 32, ROW_AXE = 40;
/** Colonne des titres : étroite sur téléphone (la frise garde la place), 280 px sur ordinateur, plus large sur grand écran. */
const labelFor = (vw: number) => vw < 760 ? Math.round(vw * 0.38) : Math.round(Math.min(440, Math.max(280, vw * 0.2)));
type Zoom = "tout" | "mois" | "semaine";
const PX_PER_DAY: Record<Zoom, number> = { tout: 0, mois: 16, semaine: 40 };
const ZOOMS: Zoom[] = ["tout", "mois", "semaine"];

const dayN = (iso: string) => Math.round(new Date(iso + "T00:00:00").getTime() / 86400000);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (s: string, n: number) => {
  const d = new Date(s + "T00:00:00");
  d.setDate(d.getDate() + n);
  return iso(d);
};
/** Décale de k jours ouvrés (lun.-ven.), comme le domaine : la durée ouvrée est conservée. */
const addWorkdays = (s: string, k: number) => {
  const d = new Date(s + "T00:00:00");
  const step = k < 0 ? -1 : 1;
  for (let left = Math.abs(k); left > 0; ) {
    d.setDate(d.getDate() + step);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return iso(d);
};

export function Gantt({ role, taskId }: { role: string; taskId?: string }) {
  const qc = useQueryClient();
  const users = useUsers();
  const nameOf = (uid: string) => users.data?.find((u) => u.id === uid)?.name ?? "—";
  // La fiche s'ouvre par-dessus le Gantt (/gantt/<id>) : on ne quitte pas la frise.
  const openTask = (id: string) => navigate(`/gantt/${id}`);
  const [vue, setVue] = useState<"pole" | "global">("pole");
  const [zoom, setZoom] = useState<Zoom>("tout");
  const [liens, setLiens] = useState(true);
  const [critSeul, setCritSeul] = useState(false);
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({ HARD: true, SOFT: true, IA: true, PILOTAGE: true, VIDEO: true, JALONS: true });
  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null);
  const [moved, setMoved] = useState<string[]>([]);
  const plotRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["gantt"], queryFn: () => api<GanttData>("/api/gantt") });

  const [labelW, setLabelW] = useState(() => labelFor(window.innerWidth));
  useEffect(() => {
    const on = () => setLabelW(labelFor(window.innerWidth));
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  // Ctrl/⌘ + molette : zoom (écouteur non passif pour bloquer le zoom du navigateur).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => ZOOMS[Math.max(0, Math.min(2, ZOOMS.indexOf(z) + (e.deltaY < 0 ? 1 : -1)))]);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [q.data]);

  // Après un changement de zoom, recentre la vue sur aujourd'hui.
  useEffect(() => {
    const el = scrollRef.current, plot = plotRef.current;
    if (!el || !plot || !q.data) return;
    const today = plot.querySelector<HTMLElement>(".g-today");
    if (today) el.scrollLeft = Math.max(0, today.offsetLeft + labelW - el.clientWidth / 2);
  }, [zoom, q.data, labelW]);

  if (!q.data) return <PageSkeleton kind="frise" />;
  const { today, tasks, deps } = q.data;
  const pilot = role === "pilot";

  // Période alignée sur des semaines entières (lundi → dimanche) : la grille tombe sur les lundis.
  const dates = tasks.flatMap((t) => [t.start, t.end]).concat(today).sort();
  const first = new Date(dates[0] + "T00:00:00");
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const last = new Date(dates[dates.length - 1] + "T00:00:00");
  last.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
  const min = iso(first);
  const span = dayN(iso(last)) - dayN(min) + 1;
  const pct = (s: string) => ((dayN(s) - dayN(min)) / span) * 100;
  const pctEnd = (s: string) => ((dayN(s) - dayN(min) + 1) / span) * 100;
  const s01 = dayN("2026-08-24");
  const weeks = Array.from({ length: span / 7 }, (_, i) => {
    const d = addDays(min, i * 7);
    return { code: `S${String(Math.floor((dayN(d) - s01) / 7) + 1).padStart(2, "0")}`, date: fmtDate(d) };
  });
  const colW = `${(7 / span) * 100}%`;
  const plotMinWidth = zoom === "tout" ? 980 : labelW + span * PX_PER_DAY[zoom];

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const isLate = (t: GTask) => t.status !== "done" && t.end < today;

  // Aperçu de cascade (approché, en jours calendaires) : successeurs qui chevaucheraient la nouvelle fin.
  const impacted = new Set<string>();
  if (drag && drag.dx > 0) {
    const newEnd = new Map<string, string>([[drag.id, addDays(byId.get(drag.id)!.end, drag.dx)]]);
    const queue = [drag.id];
    while (queue.length) {
      const p = queue.shift()!;
      for (const l of deps.filter((d) => d.from === p)) {
        const s = byId.get(l.to);
        if (!s || s.milestone || impacted.has(s.id)) continue;
        const pe = newEnd.get(p)!;
        if (pe >= s.start) {
          impacted.add(s.id);
          newEnd.set(s.id, addDays(s.end, dayN(pe) - dayN(s.start) + 1));
          queue.push(s.id);
        }
      }
    }
  }

  /** Publie un déplacement de k jours ouvrés (optimiste, cascade calculée par le serveur). */
  const moveTask = async (t: GTask, k: number) => {
    if (k === 0) return;
    const start = addWorkdays(t.start, k), end = addWorkdays(t.end, k);
    await qc.cancelQueries({ queryKey: ["gantt"] });
    const prev = qc.getQueryData<GanttData>(["gantt"]);
    qc.setQueryData<GanttData>(["gantt"], (g) => g && {
      ...g, tasks: g.tasks.map((x) => (x.id === t.id ? { ...x, start, end } : x)),
    });
    try {
      // PUT exige la fiche complète : on la recharge puis on repose les dates.
      const full = await api<{ title: string; axis_code: string; done_criteria: string; milestone: boolean; assignments: unknown[] }>(`/api/tasks/${t.id}`);
      const r = await api<{ shifted: string[]; milestones_threatened: string[] }>(`/api/tasks/${t.id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: full.title, axis_code: full.axis_code, start_date: start, end_date: end,
          done_criteria: full.done_criteria, milestone: full.milestone, assignments: full.assignments,
        }),
      });
      setMoved(r.shifted ?? []);
      setTimeout(() => setMoved([]), 6000);
      const n = r.shifted?.length ?? 0;
      notifications.show({
        message: n ? `« ${t.title} » déplacée, ${n} tâche${n > 1 ? "s suivent" : " suit"} en cascade${r.milestones_threatened?.length ? ". Un jalon est menacé." : "."}`
          : r.milestones_threatened?.length ? "Dates mises à jour. Un jalon est menacé." : `« ${t.title} » déplacée.`,
        color: r.milestones_threatened?.length ? "crit" : "brand",
      });
      qc.invalidateQueries({ queryKey: ["gantt"] });
    } catch {
      qc.setQueryData(["gantt"], prev);
      notifications.show({ message: "Déplacement refusé. La tâche reprend sa place.", color: "crit" });
    }
  };

  const onBarDown = (t: GTask) => (e: React.PointerEvent) => {
    if (!pilot || t.milestone) return;
    e.preventDefault();
    const plot = plotRef.current;
    if (!plot) return;
    const pxPerDay = (plot.getBoundingClientRect().width - labelW) / span;
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => setDrag({ id: t.id, dx: Math.round((ev.clientX - x0) / pxPerDay) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (Math.abs(ev.clientX - x0) < 4) { openTask(t.id); return; } // un clic, pas un glissé
      // Glissé en jours calendaires → converti en jours ouvrés (5 pour 7).
      moveTask(t, Math.round((Math.round((ev.clientX - x0) / pxPerDay) * 5) / 7));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const onBarKey = (t: GTask) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTask(t.id); return; }
    if (!pilot || t.milestone || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    moveTask(t, (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 5 : 1));
  };

  const rows: React.ReactNode[] = [];
  const places: Record<string, { x0: number; x1: number; y: number; crit: boolean }> = {};
  let y = HEAD;

  const taskRow = (t: GTask) => {
    places[t.id] = { x0: pct(t.start), x1: pctEnd(t.end), y: y + ROW_T / 2, crit: t.critical };
    y += ROW_T;
    const off = drag?.id === t.id ? (drag.dx / span) * 100 : 0;
    const axis = AXES[t.axis];
    return (
      <div key={t.id} className="g-row" style={{ height: ROW_T }}>
        <button type="button" className="g-label g-open" onClick={() => openTask(t.id)} title="Ouvrir la fiche de la tâche">
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: t.critical ? 600 : 400, color: critSeul && !t.critical ? "var(--text-3)" : undefined }}>{t.title}</span>
        </button>
        <div className="g-track" style={{ "--col-w": colW } as React.CSSProperties}>
          <Tooltip disabled={!!drag} openDelay={250} withArrow multiline maw={280} label={
            <span style={{ display: "grid", gap: 2 }}>
              <strong style={{ fontWeight: 600 }}>{t.title}</strong>
              <span>{axis?.label ?? t.axis}, du {fmtDate(t.start)} au {fmtDate(t.end)}</span>
              <span>{STATUS_FR[t.status] ?? t.status}{isLate(t) ? ", en retard" : ""}</span>
              <span>{t.critical ? "Sur le chemin critique" : "Avec marge"}</span>
              <span style={{ opacity: 0.75 }}>Cliquer : ouvrir la fiche{pilot ? ". Glisser ou flèches ← → : un jour ouvré (Maj : une semaine)" : ""}</span>
            </span>
          }>
            <div className="g-bar" role="button" tabIndex={0}
              aria-label={`${t.title}, du ${fmtDate(t.start)} au ${fmtDate(t.end)}${t.critical ? ", chemin critique" : ""}${isLate(t) ? ", en retard" : ""}`}
              data-critical={t.critical || undefined} data-late={isLate(t) || undefined}
              data-dim={(critSeul && !t.critical) || undefined} data-draggable={pilot || undefined}
              data-impacted={impacted.has(t.id) || undefined} data-moved={moved.includes(t.id) || undefined}
              onPointerDown={onBarDown(t)} onKeyDown={onBarKey(t)} onClick={pilot ? undefined : () => openTask(t.id)}
              style={{ "--axis": axis?.color ?? "var(--text-3)", left: `${pct(t.start) + off}%`, width: `${Math.max(0.8, pctEnd(t.end) - pct(t.start))}%` } as React.CSSProperties} />
          </Tooltip>
        </div>
      </div>
    );
  };
  const jalonRow = (t: GTask) => {
    // Un jalon est aussi une cible (et une source) de lien : pointe du losange à gauche.
    places[t.id] = { x0: pct(t.start), x1: pct(t.start), y: y + ROW_T / 2, crit: t.critical };
    y += ROW_T;
    return (
      <div key={t.id} className="g-row" style={{ height: ROW_T }}>
        <button type="button" className="g-label g-open" onClick={() => openTask(t.id)} title="Ouvrir la fiche du jalon">
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 600 }}>{t.title}</span>
          <span className="num" style={{ fontSize: 12, color: muted }}>{fmtDate(t.start)}</span>
        </button>
        <div className="g-track" style={{ "--col-w": colW } as React.CSSProperties}>
          <span className="g-ms" data-late={isLate(t) || undefined} style={{ left: `${pct(t.start)}%` }} role="button" tabIndex={0} aria-label={`Jalon ${t.title}, ${fmtDate(t.start)}. Ouvrir la fiche`}
            onClick={() => openTask(t.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTask(t.id); } }} />
        </div>
      </div>
    );
  };
  const groupRow = (id: string, label: string, color: string | null, count: number) => {
    y += ROW_AXE;
    const open = !!ouverts[id];
    return (
      <div key={`g-${id}`} className="g-row g-axis" style={{ height: ROW_AXE }}>
        <button type="button" className="g-label" aria-expanded={open} onClick={() => setOuverts({ ...ouverts, [id]: !open })}
          style={{ border: 0, font: "inherit", color: "var(--text-1)", cursor: "pointer", paddingLeft: 8 }}>
          <IconChevronRight size={14} stroke={2} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform var(--dur-fast)" }} />
          {color && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: color }} />}
          <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
          <span style={{ fontSize: 12, color: muted }}>{count}</span>
        </button>
        <div className="g-track" style={{ "--col-w": colW } as React.CSSProperties} />
      </div>
    );
  };

  if (vue === "pole") {
    for (const ax of AXIS_ORDER) {
      const mine = tasks.filter((t) => t.axis === ax && !t.milestone);
      if (mine.length === 0) continue;
      rows.push(groupRow(ax, AXES[ax].label, AXES[ax].color, mine.length));
      if (ouverts[ax]) mine.forEach((t) => rows.push(taskRow(t)));
    }
    const allJ = tasks.filter((t) => t.milestone).sort((a, b) => a.start.localeCompare(b.start));
    rows.push(groupRow("JALONS", "Jalons", null, allJ.length));
    if (ouverts.JALONS) allJ.forEach((t) => rows.push(jalonRow(t)));
  } else {
    tasks.filter((t) => !t.milestone).sort((a, b) => a.start.localeCompare(b.start)).forEach((t) => rows.push(taskRow(t)));
    tasks.filter((t) => t.milestone).sort((a, b) => a.start.localeCompare(b.start)).forEach((t) => rows.push(jalonRow(t)));
  }

  // Liens de dépendance coudés ; ceux du chemin critique défilent (désactivé si animations réduites).
  // Successeur qui démarre avant la fin du prédécesseur (chevauchement, import) : détour en S
  // par la limite de la ligne cible, pour entrer dans la barre par la gauche, flèche visible.
  const segs: React.ReactNode[] = [];
  if (liens) {
    deps.forEach((l, i) => {
      const a = places[l.from], b = places[l.to];
      if (!a || !b) return;
      const crit = (a.crit && b.crit) || undefined;
      const dim = (critSeul && !crit) || undefined;
      const p = { "data-critical": crit, "data-dim": dim };
      let k = 0;
      // Vers un jalon, le dernier segment s'arrête au bord du losange (6 px avant son centre).
      const pad = byId.get(l.to)?.milestone ? 6 : 0;
      const h = (x1: number, x2: number, yy: number, end = 0) => segs.push(
        <div key={`${i}-${k++}`} className="g-link" {...p} style={{ left: `${Math.min(x1, x2)}%`, width: `calc(${Math.abs(x2 - x1)}% - ${end}px)`, top: yy - 1, height: 2 }} />);
      const v = (x: number, y1: number, y2: number) => segs.push(
        <div key={`${i}-${k++}`} className="g-link" data-v {...p} style={{ left: `${x}%`, width: 2, top: Math.min(y1, y2) - 1, height: Math.abs(y2 - y1) + 2 }} />);
      if (b.x0 >= a.x1 + 0.8) {
        const xc = Math.max(a.x1 + 0.4, b.x0 - 1.2);
        h(a.x1, xc, a.y); v(xc, a.y, b.y); h(xc, b.x0, b.y, pad);
      } else {
        const xr = a.x1 + 0.4, xl = Math.max(0, b.x0 - 0.8);
        const ymid = b.y > a.y ? b.y - ROW_T / 2 : b.y + ROW_T / 2;
        h(a.x1, xr, a.y); v(xr, a.y, ymid); h(xl, xr, ymid); v(xl, ymid, b.y); h(xl, b.x0, b.y, pad);
      }
      segs.push(<div key={`${i}-arrow`} className="g-arrow" data-critical={crit} style={{ left: `${b.x0}%`, marginLeft: byId.get(l.to)?.milestone ? -13 : -7, top: b.y - 5, opacity: dim ? 0.1 : 1 }} />);
    });
  }

  const nTasks = tasks.filter((t) => !t.milestone).length;
  return (
    <>
      <PageHead
        title="Gantt et chemin critique"
        sub={`${nTasks} tâches du ${fmtDate(dates[0])} au ${fmtDate(dates[dates.length - 1])}`}
        right={
          <>
            <SegmentedControl size="sm" value={vue} onChange={(v) => setVue(v as "pole" | "global")}
              data={[{ value: "pole", label: "Par axe" }, { value: "global", label: "Vue globale" }]} />
            <SegmentedControl size="sm" value={zoom} onChange={(v) => setZoom(v as Zoom)} aria-label="Zoom"
              data={[{ value: "tout", label: "Tout" }, { value: "mois", label: "Mois" }, { value: "semaine", label: "Semaine" }]} />
          </>
        }
      />
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
        <div className="g-legend">
          <span><span aria-hidden="true" style={{ width: 22, height: 10, borderRadius: 3, background: "var(--axis-soft)", boxShadow: "0 0 0 2px var(--surface-1), 0 0 0 3.5px var(--accent)" }} />Chemin critique</span>
          <span><span aria-hidden="true" style={{ width: 22, height: 10, borderRadius: 3, background: "color-mix(in srgb, var(--axis-soft) 38%, var(--surface-1))" }} />Avec marge</span>
          <span><span aria-hidden="true" style={{ width: 22, height: 10, borderRadius: 3, border: "2px solid var(--crit)", boxSizing: "border-box" }} />En retard</span>
          <span><span aria-hidden="true" style={{ width: 9, height: 9, transform: "rotate(45deg)", background: "var(--text-1)", borderRadius: 2 }} />Jalon</span>
          {drag && impacted.size > 0 && <span style={{ color: "var(--warn-text)", fontWeight: 500 }}>Aperçu : {impacted.size} tâche{impacted.size > 1 ? "s vont" : " va"} suivre</span>}
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <Checkbox size="xs" label="Liens" checked={liens} onChange={() => setLiens(!liens)} />
          <Checkbox size="xs" label="Chemin critique seulement" checked={critSeul} onChange={() => setCritSeul(!critSeul)} />
        </div>
      </div>
      <section aria-label="Diagramme de Gantt" style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div ref={scrollRef} className="gantt-scroll" style={{ "--label-w": `${labelW}px` } as React.CSSProperties}>
          <div ref={plotRef} style={{ position: "relative", minWidth: plotMinWidth }}>
            <div className="g-row" style={{ height: HEAD, borderTop: 0, borderBottom: "1px solid var(--border)" }}>
              <span className="g-label" style={{ fontSize: 12, color: muted, alignItems: "flex-end", paddingBottom: 8 }}>Tâche</span>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
                {weeks.map((w) => (
                  <div key={w.code} style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "0 0 8px 6px", borderLeft: "1px solid var(--border)", fontSize: 11, overflow: "hidden" }}>
                    <span className="num" style={{ fontWeight: 600, fontSize: 12 }}>{w.code}</span>
                    <span style={{ color: muted }}>{w.date}</span>
                  </div>
                ))}
              </div>
            </div>
            {rows}
            <div aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, left: labelW, right: 0, pointerEvents: "none", zIndex: 2 }}>
              {segs}
              <div className="g-today" style={{ left: `${((dayN(today) - dayN(min) + 0.5) / span) * 100}%` }} />
            </div>
          </div>
        </div>
      </section>
      {taskId && <TaskDetailSheet id={taskId} onClose={() => navigate("/gantt")} role={role} nameOf={nameOf} />}
    </>
  );
}
