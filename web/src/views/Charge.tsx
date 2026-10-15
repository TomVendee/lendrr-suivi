/** Écran Charge : reprend la maquette docs/maquettes (structure + jetons), données live. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SegmentedControl, Skeleton} from "@mantine/core";
import { api, fmtH, fmtN } from "../api";
import { C, F_MONO, F_TITRE, PageHead, card, kpi, box, ink, line, muted, surf } from "../theme";

interface Cell { week: number; planned: number; real: number; capacity: number }
interface Row { user_id: string; name: string; weeks: Cell[] }

// Lundi de S01 = 24/08/2026 → lundi de la semaine N.
const mondayOf = (w: number) => {
  const d = new Date(2026, 7, 24 + (w - 1) * 7);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export function Charge() {
  const [mode, setMode] = useState<"detail" | "ecart">("detail");
  const q = useQuery({
    queryKey: ["load-wide"],
    // Plage par défaut du serveur : S-2 → S+6 autour de la semaine en cours.
    queryFn: () => api<{ from: number; to: number; current: number; rows: Row[] }>("/api/load"),
  });
  const alerts = useQuery({
    queryKey: ["alerts"], queryFn: () => api<{ alerts: { kind: string }[] }>("/api/alerts"),
  });
  if (!q.data) return <Skeleton height={320} radius="md" />;
  const rows = q.data.rows;
  const weeks = rows[0]?.weeks.map((w) => w.week) ?? [];
  const cur = q.data.current;

  // Capacités réelles de la semaine (défaut par personne, absences comprises).
  const teamCapa = rows.reduce((s, r) => s + (r.weeks.find((w) => w.week === cur)?.capacity ?? 0), 0);
  const reste = rows.reduce((s, r) => s + r.weeks.filter((w) => w.week >= cur).reduce((a, w) => a + w.planned, 0), 0);
  const overloads = new Set(
    (alerts.data?.alerts ?? []).filter((a) => a.kind === "overload").map((a) => (a as unknown as { week: number }).week)
  ).size;
  const missing = (alerts.data?.alerts ?? []).filter((a) => a.kind === "missing-hours").length;

  const cell = (w: Cell) => {
    let style: React.CSSProperties;
    let text: string;
    if (w.week < cur) {
      if (w.real === 0) {
        text = mode === "detail" ? `${fmtN(w.planned)} / —` : "non saisi";
        style = { background: C.warnFond, color: "#7A4F10", border: "1px solid #E2C48F" };
      } else {
        const ecart = w.real - w.planned;
        text = mode === "detail" ? `${fmtN(w.planned)} / ${fmtN(w.real)}` : `${ecart > 0 ? "+" : ""}${fmtN(ecart)}`;
        style = w.real > w.capacity
          ? { background: C.critFond, color: "#8F1C13", border: "1px solid #E8A39B" }
          : { background: "#EEF5F0", color: ink };
      }
    } else {
      text = mode === "detail" ? fmtN(w.planned) : "—";
      style = w.planned > w.capacity
        ? { background: C.critFond, color: "#8F1C13", border: "1px solid #E8A39B" }
        : { background: `${box}`, color: "#4A5056" };
    }
    if (w.week === cur) style = { ...style, outline: `2px solid ${C.accent}`, outlineOffset: -2 };
    return { text, style };
  };

  const totals = weeks.map((w) => {
    const p = rows.reduce((s, r) => s + (r.weeks.find((x) => x.week === w)?.planned ?? 0), 0);
    const r = rows.reduce((s, row) => s + (row.weeks.find((x) => x.week === w)?.real ?? 0), 0);
    return mode === "detail" ? `${fmtN(p)} / ${fmtN(r)}` : `${r - p > 0 ? "+" : ""}${fmtN(r - p)}`;
  });

  return (
    <>
      <PageHead
        title="Plan de charge"
        sub={`Heures par personne et par semaine · S${String(weeks[0]).padStart(2, "0")} → S${String(weeks[weeks.length - 1]).padStart(2, "0")}`}
        right={
          <SegmentedControl
            value={mode}
            onChange={(v) => setMode(v as "detail" | "ecart")}
            data={[
              { value: "detail", label: "Prévu / déclaré" },
              { value: "ecart", label: "Écart" },
            ]}
          />
        }
      />
      <section aria-label="Résumé" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        <div style={kpi}>
          <span style={{ fontSize: 13, color: muted }}>Capacité de l'équipe</span>
          <span style={{ fontFamily: F_MONO, fontSize: 26, fontWeight: 600 }}>{fmtH(teamCapa)} <span style={{ fontSize: 14, fontWeight: 400, color: muted }}>/ semaine</span></span>
        </div>
        <div style={kpi}>
          <span style={{ fontSize: 13, color: muted }}>Reste à faire S{String(cur).padStart(2, "0")} → S{String(weeks[weeks.length - 1]).padStart(2, "0")}</span>
          <span style={{ fontFamily: F_MONO, fontSize: 26, fontWeight: 600 }}>{fmtH(reste)}</span>
        </div>
        <div style={kpi}>
          <span style={{ fontSize: 13, color: muted }}>Semaines en surcharge prévue</span>
          <span style={{ fontFamily: F_MONO, fontSize: 26, fontWeight: 600, color: overloads ? C.crit : "#23603C" }}>{overloads}</span>
        </div>
        <div style={kpi}>
          <span style={{ fontSize: 13, color: muted }}>Saisies manquantes</span>
          <span style={{ fontFamily: F_MONO, fontSize: 26, fontWeight: 600, color: missing ? "#8A5A12" : "#23603C" }}>{missing}</span>
        </div>
      </section>

      <section aria-labelledby="grille-titre" style={{ ...card, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h2 id="grille-titre" style={{ margin: 0, fontFamily: F_TITRE, fontSize: 20, fontWeight: 600 }}>Par personne</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13, color: "#4A5056" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 3, background: C.critFond, border: "1px solid #E8A39B" }} />Au-dessus de la capacité</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 3, background: C.warnFond, border: "1px solid #E2C48F" }} />Heures non déclarées</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 3, background: surf, border: `2px solid ${C.accent}`, boxSizing: "border-box" }} />Semaine en cours</span>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 980, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "grid", gridTemplateColumns: `170px repeat(${weeks.length}, minmax(0, 1fr))`, gap: 6, paddingBottom: 8, borderBottom: `1px solid ${line}` }}>
              <span style={{ fontSize: 13, color: muted, alignSelf: "end" }}>Personne</span>
              {weeks.map((w) => (
                <div key={w} style={{ display: "flex", flexDirection: "column", alignItems: "center", fontSize: 13 }}>
                  <span style={{ fontFamily: F_MONO, fontWeight: 600, color: w === cur ? C.accentFonce : undefined }}>S{String(w).padStart(2, "0")}</span>
                  <span style={{ color: muted, fontSize: 12 }}>{mondayOf(w)}</span>
                </div>
              ))}
            </div>
            {rows.map((r) => (
              <div key={r.user_id} style={{ display: "grid", gridTemplateColumns: `170px repeat(${weeks.length}, minmax(0, 1fr))`, gap: 6, padding: "6px 0", borderBottom: `1px solid ${line}`, alignItems: "stretch" }}>
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <span style={{ fontWeight: 600 }}>{r.name}</span>
                </div>
                {r.weeks.map((w) => {
                  const c = cell(w);
                  return (
                    <div key={w.week} style={{ minHeight: 48, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", fontFamily: F_MONO, fontSize: 13, ...c.style }}>
                      {c.text}
                    </div>
                  );
                })}
              </div>
            ))}
            <div style={{ display: "grid", gridTemplateColumns: `170px repeat(${weeks.length}, minmax(0, 1fr))`, gap: 6, paddingTop: 10, alignItems: "stretch" }}>
              <div style={{ display: "flex", alignItems: "center", fontWeight: 700 }}>Équipe</div>
              {totals.map((t, i) => (
                <div key={i} style={{ minHeight: 48, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", background: C.encre, color: C.fond, fontFamily: F_MONO, fontSize: 13, fontWeight: 600 }}>{t}</div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
