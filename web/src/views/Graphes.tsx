/** Graphes : cumul prévu contre déclaré, heures par semaine, par personne, avancement par axe. */
import { useQuery } from "@tanstack/react-query";
import { BarChart, LineChart } from "@mantine/charts";
import { Button } from "@mantine/core";
import { IconTable } from "@tabler/icons-react";
import { PageSkeleton } from "../skeletons";
import { api, fmtH, fmtN } from "../api";
import { CountUp } from "../motion";
import { AXES, PageHead, card, kpi, muted } from "../theme";

interface Graphs {
  from: number; to: number; current: number;
  weeks: { week: number; planned: number; real: number; cum_planned: number; cum_real: number }[];
  persons: { user_id: string; name: string; real: number }[];
  axes: { axis: string; done: number; total: number }[];
  tasks_done: number; tasks_total: number;
}

const pad = (w: number) => `S${String(w).padStart(2, "0")}`;
const r1 = (n: number) => Math.round(n * 10) / 10;
const sectionStyle = { ...card, padding: "18px 20px", display: "flex", flexDirection: "column" as const, gap: 12, minWidth: 0 };
const h2 = { margin: 0, fontSize: 15, fontWeight: 600 } as const;

/** Légende : trait ou carré + libellé (l'identité ne repose jamais sur la couleur seule). */
function Key({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div style={{ display: "flex", gap: 14, fontSize: 12.5, color: "var(--text-2)" }}>
      {items.map((i) => (
        <span key={i.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span aria-hidden="true" style={i.dashed
            ? { width: 16, borderTop: `2px dashed ${i.color}` }
            : { width: 10, height: 10, borderRadius: 3, background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function Graphes({ goCharge }: { goCharge: () => void }) {
  const q = useQuery({ queryKey: ["graphs"], queryFn: () => api<Graphs>("/api/graphs") });
  if (!q.data) return <PageSkeleton kind="meteo" />;
  const d = q.data;
  const weeks = d.weeks;
  const past = weeks.filter((w) => w.week < d.current);
  const ecart = past.reduce((s, w) => s + (w.real - w.planned), 0);
  const prevuCum = past.reduce((s, w) => s + w.planned, 0);
  const reelCum = past.reduce((s, w) => s + w.real, 0);
  const teamReal = d.persons.reduce((s, p) => s + p.real, 0);
  const maxPerson = Math.max(1, ...d.persons.map((p) => p.real));

  const cumul = weeks.map((w) => ({
    week: pad(w.week),
    Prévu: r1(w.cum_planned),
    Déclaré: w.week <= d.current ? r1(w.cum_real) : null,
  }));
  const perWeek = weeks.map((w) => ({ week: pad(w.week), Prévu: r1(w.planned), Déclaré: w.week <= d.current ? r1(w.real) : null }));
  const today = [{ x: pad(d.current), label: "Aujourd'hui", color: "var(--crit)" }];

  return (
    <>
      <PageHead
        title="Graphes"
        sub={`Heures et avancement de ${pad(d.from)} à ${pad(d.to)}`}
        right={<Button variant="default" leftSection={<IconTable size={16} stroke={1.6} />} onClick={goCharge}>Plan de charge détaillé</Button>}
      />
      <section aria-label="Indicateurs" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <div style={kpi}>
          <span style={{ fontSize: 13, color: muted }}>Écart cumulé</span>
          <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em", color: ecart < 0 ? "var(--warn-text)" : undefined }}>
            <CountUp value={ecart} format={(n) => `${n > 0 ? "+" : ""}${fmtN(n)} h`} />
          </span>
          <span style={{ fontSize: 13, color: muted }}>{fmtN(reelCum)} h déclarées pour {fmtN(prevuCum)} h prévues</span>
        </div>
        <div style={kpi}>
          <span style={{ fontSize: 13, color: muted }}>Tâches terminées</span>
          <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em" }}>
            <CountUp value={d.tasks_done} format={(n) => String(Math.round(n))} /> <span style={{ fontSize: 14, fontWeight: 400, color: muted }}>sur {d.tasks_total}</span>
          </span>
        </div>
        <div style={kpi}>
          <span style={{ fontSize: 13, color: muted }}>Heures déclarées par l'équipe</span>
          <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em" }}><CountUp value={teamReal} format={fmtH} /></span>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 440px), 1fr))", gap: 16 }}>
        <section aria-labelledby="g-cumul" style={sectionStyle}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
            <h2 id="g-cumul" style={h2}>Heures cumulées</h2>
            <Key items={[{ label: "Prévu", color: "var(--text-3)", dashed: true }, { label: "Déclaré", color: "var(--accent)" }]} />
          </div>
          <LineChart h={240} data={cumul} dataKey="week" curveType="monotone" gridAxis="x" tickLine="none" strokeDasharray="3 4"
            referenceLines={today} valueFormatter={(v) => `${fmtN(v)} h`} strokeWidth={2} dotProps={{ r: 0 }} activeDotProps={{ r: 4 }}
            series={[{ name: "Prévu", color: "var(--text-3)", strokeDasharray: "5 4" }, { name: "Déclaré", color: "var(--accent)" }]} />
        </section>

        <section aria-labelledby="g-semaine" style={sectionStyle}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
            <h2 id="g-semaine" style={h2}>Heures par semaine, équipe</h2>
            <Key items={[{ label: "Prévu", color: "var(--border-strong)" }, { label: "Déclaré", color: "var(--accent)" }]} />
          </div>
          <BarChart h={240} data={perWeek} dataKey="week" gridAxis="x" tickLine="none" strokeDasharray="3 4"
            referenceLines={today} valueFormatter={(v) => `${fmtN(v)} h`} barProps={{ radius: [4, 4, 0, 0] }} barChartProps={{ barGap: 2 }}
            series={[{ name: "Prévu", color: "var(--border-strong)" }, { name: "Déclaré", color: "var(--accent)" }]} />
        </section>

        <section aria-labelledby="g-personne" style={sectionStyle}>
          <h2 id="g-personne" style={h2}>Heures déclarées par personne</h2>
          {d.persons.map((p) => (
            <div key={p.user_id} style={{ display: "grid", gridTemplateColumns: "84px minmax(0, 1fr) 52px", alignItems: "center", gap: 12 }}>
              <span style={{ fontWeight: 500, fontSize: 13 }}>{p.name}</span>
              <div style={{ height: 10, borderRadius: 5, background: "var(--sunken-2)" }} title={`${p.name} : ${fmtH(p.real)}`}>
                <div style={{ height: "100%", borderRadius: 5, width: `${(p.real / maxPerson) * 100}%`, background: "var(--accent)", transition: "width var(--dur-slow) var(--ease-out)" }} />
              </div>
              <span className="num" style={{ fontSize: 13, textAlign: "right" }}>{fmtN(p.real)} h</span>
            </div>
          ))}
        </section>

        <section aria-labelledby="g-axes" style={sectionStyle}>
          <h2 id="g-axes" style={h2}>Avancement par axe</h2>
          {d.axes.filter((a) => a.total > 0).map((a) => (
            <div key={a.axis} style={{ display: "grid", gridTemplateColumns: "84px minmax(0, 1fr) 52px", alignItems: "center", gap: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 500, fontSize: 13 }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: AXES[a.axis]?.color }} />
                {AXES[a.axis]?.label ?? a.axis}
              </span>
              <div style={{ height: 10, borderRadius: 5, background: "var(--sunken-2)" }} title={`${AXES[a.axis]?.label ?? a.axis} : ${a.done} sur ${a.total}`}>
                <div style={{ height: "100%", borderRadius: 5, width: `${(a.done / a.total) * 100}%`, background: AXES[a.axis]?.color, transition: "width var(--dur-slow) var(--ease-out)" }} />
              </div>
              <span className="num" style={{ fontSize: 13, textAlign: "right" }}>{a.done} / {a.total}</span>
            </div>
          ))}
        </section>
      </div>

      <details style={{ ...card, padding: "12px 20px" }}>
        <summary style={{ cursor: "pointer", fontWeight: 500, fontSize: 14 }}>Voir les données en tableau</summary>
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="num" style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
            <thead>
              <tr style={{ color: muted, textAlign: "right" }}>
                <th style={{ textAlign: "left", fontWeight: 500, padding: "6px 8px" }}>Semaine</th>
                <th style={{ fontWeight: 500, padding: "6px 8px" }}>Prévu</th>
                <th style={{ fontWeight: 500, padding: "6px 8px" }}>Déclaré</th>
                <th style={{ fontWeight: 500, padding: "6px 8px" }}>Cumul prévu</th>
                <th style={{ fontWeight: 500, padding: "6px 8px" }}>Cumul déclaré</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.week} style={{ borderTop: "1px solid var(--border)", textAlign: "right", fontWeight: w.week === d.current ? 600 : 400 }}>
                  <td style={{ textAlign: "left", padding: "6px 8px" }}>{pad(w.week)}</td>
                  <td style={{ padding: "6px 8px" }}>{fmtN(w.planned)}</td>
                  <td style={{ padding: "6px 8px" }}>{w.week <= d.current ? fmtN(w.real) : "—"}</td>
                  <td style={{ padding: "6px 8px" }}>{fmtN(w.cum_planned)}</td>
                  <td style={{ padding: "6px 8px" }}>{w.week <= d.current ? fmtN(w.cum_real) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
