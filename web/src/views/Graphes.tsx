/** Écran Graphes : reprend la maquette docs/maquettes (structure + jetons), données live. */
import { useQuery } from "@tanstack/react-query";
import { LineChart } from "@mantine/charts";
import { PageSkeleton } from "../skeletons";
import { api, fmtH, fmtN } from "../api";
import { C, F_MONO, F_TITRE, PageHead, card, kpi, line, muted, surf, track } from "../theme";

interface Graphs {
  from: number; to: number; current: number;
  weeks: { week: number; planned: number; real: number; cum_planned: number; cum_real: number }[];
  persons: { user_id: string; name: string; real: number }[];
  axes: { axis: string; done: number; total: number }[];
  tasks_done: number; tasks_total: number;
}

const pad = (w: number) => `S${String(w).padStart(2, "0")}`;

export function Graphes({ goCharge }: { goCharge: () => void }) {
  const q = useQuery({ queryKey: ["graphs"], queryFn: () => api<Graphs>("/api/graphs") });
  if (!q.data) return <PageSkeleton kind="meteo" />;
  const d = q.data;
  const weeks = d.weeks.filter((w) => w.week >= 6 && w.week <= 15);
  const past = weeks.filter((w) => w.week < d.current);
  const ecart = past.reduce((s, w) => s + (w.real - w.planned), 0);
  const prevuCum = past.reduce((s, w) => s + w.planned, 0);
  const reelCum = past.reduce((s, w) => s + w.real, 0);

  // Courbe cumulée : prévu (pointillé) contre déclaré, bornée à la semaine en cours.
  const upto = weeks.filter((w) => w.week <= d.current);
  const cumul = weeks.map((w) => ({
    week: pad(w.week),
    Prévu: Math.round(w.cum_planned * 10) / 10,
    Déclaré: w.week <= d.current ? Math.round(w.cum_real * 10) / 10 : undefined,
  }));
  void upto;

  const maxBar = Math.max(1, ...weeks.map((w) => Math.max(w.planned, w.real)));

  return (
    <>
      <PageHead
        title="Graphes"
        sub="Heures et avancement en un coup d'œil"
        right={
          <button onClick={goCharge} style={{ display: "inline-flex", alignItems: "center", height: 44, padding: "0 16px", borderRadius: 8, border: `1px solid ${line}`, background: surf, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
            Voir le tableau détaillé
          </button>
        }
      />
      <section aria-label="Indicateurs" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        <div style={kpi}>
          <span style={{ fontSize: 13, color: muted }}>Écart cumulé</span>
          <span style={{ fontFamily: F_MONO, fontSize: 26, fontWeight: 600, color: ecart < 0 ? "var(--warn-text)" : C.encre }}>
            {ecart > 0 ? "+" : ""}{fmtN(ecart)} h
          </span>
          <span style={{ fontSize: 13, color: muted }}>{fmtN(reelCum)} h déclarées pour {fmtN(prevuCum)} h prévues</span>
        </div>
        <div style={kpi}>
          <span style={{ fontSize: 13, color: muted }}>Tâches terminées</span>
          <span style={{ fontFamily: F_MONO, fontSize: 26, fontWeight: 600 }}>{d.tasks_done} <span style={{ fontSize: 14, fontWeight: 400, color: muted }}>/ {d.tasks_total}</span></span>
        </div>
        <div style={kpi}>
          <span style={{ fontSize: 13, color: muted }}>Heures déclarées (équipe)</span>
          <span style={{ fontFamily: F_MONO, fontSize: 26, fontWeight: 600 }}>{fmtH(d.persons.reduce((s, p) => s + p.real, 0))}</span>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))", gap: 20 }}>
        <section aria-labelledby="g-cumul" style={{ ...card, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <h2 id="g-cumul" style={{ margin: 0, fontFamily: F_TITRE, fontSize: 18, fontWeight: 600 }}>Heures cumulées</h2>
            <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--text-2)" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span aria-hidden="true" style={{ width: 18, borderTop: "2px dashed var(--text-3)" }} />Prévu</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span aria-hidden="true" style={{ width: 18, height: 3, background: C.accent }} />Déclaré</span>
            </div>
          </div>
          <LineChart
            h={260}
            data={cumul}
            dataKey="week"
            withLegend
            legendProps={{ verticalAlign: "top", height: 40 }}
            series={[
              { name: "Prévu", color: "gray.5" },
              { name: "Déclaré", color: "brand.6" },
            ]}
            curveType="monotone"
            valueFormatter={(v) => `${fmtN(v)} h`}
          />
        </section>

        <section aria-labelledby="g-semaine" style={{ ...card, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <h2 id="g-semaine" style={{ margin: 0, fontFamily: F_TITRE, fontSize: 18, fontWeight: 600 }}>Heures par semaine · équipe</h2>
            <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--text-2)" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 2, background: `${line}` }} />Prévu</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 2, background: C.encre }} />Déclaré</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", height: 200, paddingTop: 8, borderBottom: `1px solid ${line}` }}>
            {weeks.map((w) => (
              <div key={w.week} style={{ flex: "1 1 0", minWidth: 0, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>
                <span style={{ fontFamily: F_MONO, fontSize: 11, color: "var(--text-2)" }}>{fmtN(w.week <= d.current ? w.real : w.planned)}</span>
                <div style={{ width: "100%", display: "flex", gap: 3, alignItems: "flex-end", justifyContent: "center" }}>
                  <div style={{ flex: "1 1 0", maxWidth: 16, borderRadius: "2px 2px 0 0", background: `${line}`, height: `${Math.round((w.planned / maxBar) * 170)}px` }} />
                  <div style={{ flex: "1 1 0", maxWidth: 16, borderRadius: "2px 2px 0 0", height: `${Math.round((w.real / maxBar) * 170)}px`, background: w.week === d.current ? C.accent : C.encre }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {weeks.map((w) => (
              <span key={w.week} style={{ flex: "1 1 0", minWidth: 0, textAlign: "center", fontFamily: F_MONO, fontSize: 12, color: w.week === d.current ? C.accentFonce : muted, fontWeight: w.week === d.current ? 600 : 400 }}>
                {pad(w.week)}
              </span>
            ))}
          </div>
        </section>

        <section aria-labelledby="g-personne" style={{ ...card, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 id="g-personne" style={{ margin: 0, fontFamily: F_TITRE, fontSize: 18, fontWeight: 600 }}>Heures déclarées par personne</h2>
          {d.persons.map((p) => (
            <div key={p.user_id} style={{ display: "grid", gridTemplateColumns: "80px minmax(0, 1fr) 56px", alignItems: "center", gap: 12 }}>
              <span style={{ fontWeight: 500, fontSize: 14 }}>{p.name}</span>
              <div style={{ height: 18, borderRadius: 3, background: `${track}` }}>
                <div style={{ height: "100%", borderRadius: 3, width: `${Math.min(100, (p.real / 15) * 100).toFixed(1)}%`, background: p.real < 6 ? C.warn : C.encre }} />
              </div>
              <span style={{ fontFamily: F_MONO, fontSize: 13, textAlign: "right" }}>{fmtN(p.real)} h</span>
            </div>
          ))}
        </section>

        <section aria-labelledby="g-axes" style={{ ...card, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 id="g-axes" style={{ margin: 0, fontFamily: F_TITRE, fontSize: 18, fontWeight: 600 }}>Avancement par axe</h2>
          {d.axes.filter((a) => a.total > 0).map((a) => {
            const late = a.done < a.total; // simplifié : reste à faire
            return (
              <div key={a.axis} style={{ display: "grid", gridTemplateColumns: "80px minmax(0, 1fr) 56px", alignItems: "center", gap: 12 }}>
                <span style={{ fontFamily: F_TITRE, fontWeight: 700, fontSize: 13, letterSpacing: "0.05em" }}>{a.axis}</span>
                <div style={{ height: 18, borderRadius: 3, background: `${track}` }}>
                  <div style={{ height: "100%", borderRadius: 3, width: `${(a.done / Math.max(1, a.total)) * 100}%`, background: late ? C.warn : C.ok }} />
                </div>
                <span style={{ fontFamily: F_MONO, fontSize: 13, textAlign: "right" }}>{a.done} / {a.total}</span>
              </div>
            );
          })}
        </section>
      </div>
    </>
  );
}
