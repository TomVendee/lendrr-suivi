import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, fmtDate } from "../api";
import { useUsers } from "../api";
import { C, F_MONO, F_TITRE, PageHead, card } from "../theme";

interface GTask {
  id: string; title: string; axis: string; start: string; end: string;
  status: string; milestone: boolean; critical: boolean;
}
interface GanttData { today: string; tasks: GTask[]; deps: { from: string; to: string }[] }

const AXES = ["HARD", "SOFT", "IA", "PILOTAGE", "VIDEO"] as const;
const dayN = (iso: string) => new Date(iso + "T00:00:00").getTime() / 86400000;

export function Gantt() {
  const [vue, setVue] = useState<"pole" | "global">("pole");
  const [liens, setLiens] = useState(true);
  const [critSeul, setCritSeul] = useState(false);
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({ HARD: true, IA: true, JALONS: true });
  const q = useQuery({ queryKey: ["gantt"], queryFn: () => api<GanttData>("/api/gantt") });
  const users = useUsers();
  if (!q.data) return <p>Chargement…</p>;
  const { today, tasks, deps } = q.data;

  const dates = tasks.flatMap((t) => [t.start, t.end]);
  const min = dates.sort()[0] ?? today;
  const max = [...dates].sort().reverse()[0] ?? today;
  const span = Math.max(1, dayN(max) - dayN(min) + 1);
  const pct = (iso: string) => ((dayN(iso) - dayN(min)) / span) * 100;
  const pctEnd = (iso: string) => ((dayN(iso) - dayN(min) + 1) / span) * 100;
  const todayPct = Math.min(100, Math.max(0, ((dayN(today) - dayN(min)) / span) * 100));

  // Colonnes semaines couvrant la période (numérotées projet : S01 = 24/08/2026).
  const weekCols: { code: string; date: string }[] = [];
  {
    const d0 = new Date(min + "T00:00:00");
    const dow = (d0.getDay() + 6) % 7; // lundi = 0
    d0.setDate(d0.getDate() - dow);
    const s01 = new Date(2026, 7, 24).getTime();
    let n = 0;
    for (let d = new Date(d0); d.getTime() <= new Date(max + "T00:00:00").getTime() + 6 * 86400000 && n <= 14; d.setDate(d.getDate() + 7), n++) {
      const w = Math.round((d.getTime() - s01) / (7 * 86400000)) + 1;
      weekCols.push({
        code: `S${String(w).padStart(2, "0")}`,
        date: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
      });
    }
  }

  const bar = (t: GTask): React.CSSProperties => {
    const late = !t.milestone && t.status !== "done" && t.end < today;
    const base: React.CSSProperties = {
      position: "absolute", top: 8, height: 14, borderRadius: 3, boxSizing: "border-box",
      left: `${pct(t.start)}%`, width: `${Math.max(0.8, pctEnd(t.end) - pct(t.start))}%`,
    };
    if (late) return { ...base, background: "#FFFFFF", border: "2px solid #B42318" };
    if (t.critical) return { ...base, background: C.accent };
    return { ...base, background: "#9AA0A6", opacity: critSeul ? 0.18 : 1 };
  };
  const nameOf = (id: string) => users.data?.find((u) => u.id === id)?.name ?? "";

  const rows: React.ReactNode[] = [];
  const places: Record<string, { x0: number; x1: number; y: number; crit: boolean; title: string }> = {};
  // L'overlay des liens couvre aussi l'en-tête (52 px) : on part de 52.
  let y = 52;
  const ROW_AXE = 41, ROW_T = 31;

  const taskRow = (t: GTask) => {
    const yy = y;
    y += ROW_T;
    places[t.id] = { x0: pct(t.start), x1: pctEnd(t.end), y: yy + 16, crit: t.critical, title: t.title };
    return (
      <div key={t.id} style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", height: ROW_T, boxSizing: "border-box", borderTop: "1px solid #EFF1F4" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px 0 30px", minWidth: 0 }}>
          <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: t.critical ? 600 : 400, color: critSeul && !t.critical ? "#9AA0A6" : undefined }}>{t.title}</span>
        </div>
        <div style={{ position: "relative", backgroundImage: "repeating-linear-gradient(to right, #EFF1F4 0, #EFF1F4 1px, transparent 1px, transparent 10%)" }}>
          <div style={bar(t)} />
        </div>
      </div>
    );
  };
  void nameOf;
  const jalonRow = (t: GTask) => {
    y += ROW_T;
    return (
      <div key={t.id} style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", height: ROW_T, boxSizing: "border-box", borderTop: "1px solid #EFF1F4" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px 0 30px", minWidth: 0 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 600 }}>{t.title}</span>
          <span style={{ fontFamily: F_MONO, fontSize: 12, color: C.discret }}>{fmtDate(t.start)}</span>
        </div>
        <div style={{ position: "relative", backgroundImage: "repeating-linear-gradient(to right, #EFF1F4 0, #EFF1F4 1px, transparent 1px, transparent 10%)" }}>
          <div style={{ position: "absolute", top: 9, width: 12, height: 12, marginLeft: -6, transform: "rotate(45deg)", boxSizing: "border-box", left: `${pct(t.start)}%`, background: t.end < today && t.status !== "done" ? "#B42318" : C.encre }} />
        </div>
      </div>
    );
  };

  if (vue === "pole") {
    for (const ax of AXES) {
      const mine = tasks.filter((t) => t.axis === ax && !t.milestone);
      const jalons = tasks.filter((t) => t.axis === ax && t.milestone);
      if (mine.length === 0 && jalons.length === 0) continue;
      const ouvert = !!ouverts[ax];
      const yy = y;
      y += ROW_AXE;
      rows.push(
        <div key={`ax-${ax}`} style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", height: ROW_AXE, boxSizing: "border-box", background: "#F7F8FA", borderTop: "1px solid #E3E6EA" }}>
          <button type="button" aria-expanded={ouvert} onClick={() => setOuverts({ ...ouverts, [ax]: !ouvert })}
            style={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 8px", border: 0, background: "transparent", color: C.encre, font: "inherit", textAlign: "left", cursor: "pointer" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={ouvert ? { transform: "rotate(90deg)" } : undefined}><path d="M9 6l6 6-6 6" /></svg>
            <span style={{ fontFamily: F_TITRE, fontWeight: 700, letterSpacing: "0.05em", fontSize: 14 }}>{ax}</span>
          </button>
          <div style={{ position: "relative", backgroundImage: "repeating-linear-gradient(to right, #ECEEF1 0, #ECEEF1 1px, transparent 1px, transparent 10%)" }} />
        </div>
      );
      void yy;
      if (!ouvert) continue;
      mine.forEach((t) => rows.push(taskRow(t)));
      jalons.forEach((t) => rows.push(jalonRow(t)));
    }
    // Ligne JALONS projet
    {
      const allJ = tasks.filter((t) => t.milestone).sort((a, b) => a.start.localeCompare(b.start));
      const ouvert = !!ouverts.JALONS;
      y += ROW_AXE;
      rows.push(
        <div key="ax-JALONS" style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", height: ROW_AXE, boxSizing: "border-box", background: "#F7F8FA", borderTop: "1px solid #E3E6EA" }}>
          <button type="button" aria-expanded={ouvert} onClick={() => setOuverts({ ...ouverts, JALONS: !ouvert })}
            style={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 8px", border: 0, background: "transparent", color: C.encre, font: "inherit", textAlign: "left", cursor: "pointer" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={ouvert ? { transform: "rotate(90deg)" } : undefined}><path d="M9 6l6 6-6 6" /></svg>
            <span style={{ fontFamily: F_TITRE, fontWeight: 700, letterSpacing: "0.05em", fontSize: 14 }}>JALONS</span>
            <span style={{ fontSize: 12, color: C.discret }}>{allJ.length} à venir</span>
          </button>
          <div style={{ position: "relative", backgroundImage: "repeating-linear-gradient(to right, #ECEEF1 0, #ECEEF1 1px, transparent 1px, transparent 10%)" }} />
        </div>
      );
      if (ouvert) allJ.forEach((t) => rows.push(jalonRow(t)));
    }
  } else {
    const items = tasks.filter((t) => !t.milestone).sort((a, b) => a.start.localeCompare(b.start));
    items.forEach((t) => rows.push(taskRow(t)));
    tasks.filter((t) => t.milestone).sort((a, b) => a.start.localeCompare(b.start)).forEach((t) => rows.push(jalonRow(t)));
  }

  // Liens de dépendance (coudés, comme la maquette).
  const segs: React.ReactNode[] = [];
  if (liens) {
    deps.forEach((l, i) => {
      const a = places[l.from], b = places[l.to];
      if (!a || !b) return;
      const col = a.crit && b.crit ? C.accent : "#6B7177";
      const fade = critSeul && !(a.crit && b.crit) ? 0.12 : 1;
      const xCoude = Math.max(a.x1 + 0.4, b.x0 - 1.2);
      const haut = Math.min(a.y, b.y), bas = Math.max(a.y, b.y);
      const o = { opacity: fade };
      segs.push(<div key={`${i}a`} style={{ position: "absolute", left: `${a.x1}%`, width: `${xCoude - a.x1}%`, top: a.y - 1, height: 2, background: col, ...o }} />);
      segs.push(<div key={`${i}b`} style={{ position: "absolute", left: `${xCoude}%`, width: 2, top: haut - 1, height: bas - haut + 2, background: col, ...o }} />);
      segs.push(<div key={`${i}c`} style={{ position: "absolute", left: `${xCoude}%`, width: `${Math.max(0, b.x0 - xCoude)}%`, top: b.y - 1, height: 2, background: col, ...o }} />);
      segs.push(<div key={`${i}d`} style={{ position: "absolute", left: `${b.x0}%`, marginLeft: -7, top: b.y - 5, width: 0, height: 0, borderTop: "5px solid transparent", borderBottom: "5px solid transparent", borderLeft: `7px solid ${col}`, ...o }} />);
    });
  }

  const actif = { background: C.encre, color: C.fond };
  const inactif = { background: "transparent", color: C.encre };
  void nameOf;

  return (
    <>
      <PageHead
        title="Gantt et chemin critique"
        sub={`${fmtDate(min)} → ${fmtDate(max)} · ${tasks.filter((t) => !t.milestone).length} tâches`}
        right={
          <>
            <div role="group" aria-label="Regroupement" style={{ display: "inline-flex", padding: 4, borderRadius: 10, background: "#E3E6EA", gap: 4 }}>
              <button type="button" aria-pressed={vue === "pole"} onClick={() => setVue("pole")}
                style={{ height: 40, padding: "0 16px", border: 0, borderRadius: 8, font: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer", ...(vue === "pole" ? actif : inactif) }}>Par pôle</button>
              <button type="button" aria-pressed={vue === "global"} onClick={() => setVue("global")}
                style={{ height: 40, padding: "0 16px", border: 0, borderRadius: 8, font: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer", ...(vue === "global" ? actif : inactif) }}>Vue globale</button>
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 10, minHeight: 44, padding: "0 14px", borderRadius: 8, background: C.surface, border: `1px solid ${C.bordure}`, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
              <input type="checkbox" checked={liens} onChange={() => setLiens(!liens)} style={{ width: 18, height: 18, accentColor: C.accent, margin: 0 }} />
              Afficher les liens
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 10, minHeight: 44, padding: "0 14px", borderRadius: 8, background: C.surface, border: `1px solid ${C.bordure}`, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
              <input type="checkbox" checked={critSeul} onChange={() => setCritSeul(!critSeul)} style={{ width: 18, height: 18, accentColor: C.accent, margin: 0 }} />
              Chemin critique seulement
            </label>
          </>
        }
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, fontSize: 13, color: "#4A5056" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><span aria-hidden="true" style={{ width: 22, height: 10, borderRadius: 3, background: C.accent }} />Chemin critique</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><span aria-hidden="true" style={{ width: 22, height: 10, borderRadius: 3, background: "#9AA0A6" }} />Tâche avec marge</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><span aria-hidden="true" style={{ width: 22, height: 10, borderRadius: 3, background: C.surface, border: "2px solid #B42318", boxSizing: "border-box" }} />En retard</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><span aria-hidden="true" style={{ width: 10, height: 10, transform: "rotate(45deg)", background: C.encre }} />Jalon</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><span aria-hidden="true" style={{ width: 2, height: 14, background: "#B42318" }} />Aujourd'hui, {fmtDate(today)}</span>
      </div>
      <section aria-label="Diagramme de Gantt" style={{ ...card, padding: "16px 18px 20px", overflowX: "auto" }}>
        <div style={{ position: "relative", minWidth: 980 }}>
          <div style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", height: 52, boxSizing: "border-box", borderBottom: `1px solid ${C.bordure}` }}>
            <span style={{ fontSize: 13, color: C.discret, alignSelf: "end", paddingBottom: 8 }}>Tâche</span>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${weekCols.length}, minmax(0, 1fr))` }}>
              {weekCols.map((s) => (
                <div key={s.code} style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", paddingBottom: 8, borderLeft: "1px solid #ECEEF1", fontSize: 12 }}>
                  <span style={{ fontFamily: F_MONO, fontWeight: 600, fontSize: 13 }}>{s.code}</span>
                  <span style={{ color: C.discret }}>{s.date}</span>
                </div>
              ))}
            </div>
          </div>
          {rows}
          <div aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, left: 280, right: 0, pointerEvents: "none" }}>
            {segs}
            <div style={{ position: "absolute", top: 0, bottom: 0, width: 2, background: "#B42318", left: `${todayPct}%` }} />
          </div>
        </div>
      </section>
    </>
  );
}
