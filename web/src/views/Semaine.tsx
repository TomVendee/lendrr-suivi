/** Écran Semaine : reprend la maquette docs/maquettes (structure + jetons), données live. */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, NumberInput, Select, Skeleton} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { api, fmtDate, fmtH, fmtN, type Me } from "../api";
import { TAG, alertDetail, type Alert } from "./Alertes";
import { useIsMobile } from "../Shell";
import { AxisChip, C, F_MONO, F_TITRE, StatusPill, box, card, legend, line, muted, surf, track } from "../theme";

interface WeekTask {
  id: string; title: string; axis_code: string; start_date: string; end_date: string;
  status: string; done_criteria?: string; my_role: string; my_planned_hours: number; my_real_hours: number;
}
interface MyWeek {
  week: number; monday: string; sunday: string; tasks: WeekTask[];
  planned: number; real: number; capacity: number;
}

const STATUS_OPTIONS = [["todo", "À faire"], ["in_progress", "En cours"], ["blocked", "Bloquée"], ["done", "Terminée"]] as const;

export function Semaine({ me }: { me: Me }) {
  const mobile = useIsMobile();
  const qc = useQueryClient();
  const [week, setWeek] = useState<number | undefined>(undefined);
  const [hours, setHours] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("Dernier enregistrement : —");

  const q = useQuery({
    queryKey: ["my-week", week],
    queryFn: () => api<MyWeek>(`/api/my-week${week ? `?week=${week}` : ""}`),
  });
  const alerts = useQuery({
    queryKey: ["alerts"], queryFn: () => api<{ alerts: Alert[] }>("/api/alerts"),
  });
  const next = useQuery({
    queryKey: ["my-week-next", q.data?.week],
    queryFn: () => api<MyWeek>(`/api/my-week?week=${(q.data?.week ?? 0) + 1}`),
    enabled: !!q.data,
  });
  const history = useQuery({
    queryKey: ["my-week-hist", q.data?.week],
    queryFn: async () => {
      const w = q.data!.week;
      const out: { week: number; real: number }[] = [];
      for (const ww of [w - 2, w - 1, w]) {
        if (ww < 1) continue;
        const d = await api<MyWeek>(`/api/my-week?week=${ww}`);
        out.push({ week: ww, real: d.real });
      }
      return out;
    },
    enabled: !!q.data,
  });

  if (!q.data) return (<div style={{ display: "grid", gap: 12 }}><Skeleton height={120} radius="md" /><Skeleton height={220} radius="md" /><Skeleton height={220} radius="md" /></div>);
  const d = q.data;
  const myAlerts = (alerts.data?.alerts ?? []).slice(0, 3);

  const saveAll = async () => {
    const entries = Object.entries(hours).filter(([, v]) => v.trim() !== "");
    try {
      for (const [taskId, v] of entries) {
        const h = parseFloat(v.replace(",", "."));
        if (Number.isNaN(h)) continue;
        await api("/api/time-entries", {
          method: "POST",
          body: JSON.stringify({ task_id: taskId, week: d.week, hours: h }),
        });
      }
      setHours({});
      setMsg(`Enregistré · ${fmtN(d.real)} h pour S${String(d.week).padStart(2, "0")}`);
      notifications.show({ message: "Heures enregistrées", color: "ok" });
      qc.invalidateQueries({ queryKey: ["my-week"] });
    } catch {
      notifications.show({ message: "Échec d'enregistrement", color: "crit" });
    }
  };
  const setStatus = async (taskId: string, status: string) => {
    await api(`/api/tasks/${taskId}/status`, { method: "POST", body: JSON.stringify({ status }) });
    qc.invalidateQueries({ queryKey: ["my-week"] });
  };

  const totalFromInputs =
    d.tasks.reduce((s, t) => s + (hours[t.id] !== undefined && hours[t.id].trim() !== "" ? parseFloat(hours[t.id].replace(",", ".")) || 0 : t.my_real_hours), 0);
  const reste = d.planned - totalFromInputs;

  const stroke = mobile ? "#F4F5F7" : "#202326";
  const chevL = (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>);
  const chevR = (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>);
  const weekNav = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
      <button type="button" aria-label="Semaine précédente" onClick={() => setWeek(d.week - 1)}
        style={{ width: 44, height: 44, borderRadius: 8, border: mobile ? "1px solid #3A3F44" : `1px solid ${line}`, background: mobile ? "transparent" : surf, color: mobile ? C.fond : C.encre, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
        {chevL}
      </button>
      <span style={{ minWidth: 56, textAlign: "center", fontFamily: F_MONO, fontWeight: 600 }}>S{String(d.week).padStart(2, "0")}</span>
      <button type="button" aria-label="Semaine suivante" onClick={() => setWeek(d.week + 1)}
        style={{ width: 44, height: 44, borderRadius: 8, border: mobile ? "1px solid #3A3F44" : `1px solid ${line}`, background: mobile ? "transparent" : surf, color: mobile ? C.fond : C.encre, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
        {chevR}
      </button>
    </div>
  );

  const hoursPanel = (
    <section aria-label="Mes heures de la semaine" style={{ background: C.encre, color: C.fond, borderRadius: 12, padding: mobile ? "16px" : "20px 24px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px 40px" }}>
      {mobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={{ fontFamily: F_MONO, fontSize: 26, fontWeight: 600, color: C.bleuClair }}>
              {fmtN(totalFromInputs)} h <span style={{ fontSize: 15, fontWeight: 400, color: C.navMuted }}>/ {fmtN(d.planned)} h prévues</span>
            </span>
            <span style={{ fontSize: 13, color: C.navMuted }}>avant lun. 12 h</span>
          </div>
          <div aria-hidden="true" style={{ height: 10, borderRadius: 5, background: "#3A3F44", overflow: "hidden" }}>
            <div style={{ width: `${d.planned ? Math.min(100, (totalFromInputs / d.planned) * 100) : 0}%`, height: "100%", borderRadius: 5, background: C.accent }} />
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13, color: C.navMuted }}>Prévu pour moi</span>
            <span style={{ fontFamily: F_MONO, fontSize: 28, fontWeight: 600 }}>{fmtN(d.planned)} h</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13, color: C.navMuted }}>Déclaré</span>
            <span style={{ fontFamily: F_MONO, fontSize: 28, fontWeight: 600, color: C.bleuClair }}>{fmtN(totalFromInputs)} h</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13, color: C.navMuted }}>Capacité</span>
            <span style={{ fontFamily: F_MONO, fontSize: 28, fontWeight: 600 }}>{fmtN(d.capacity)} h</span>
          </div>
          <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <div aria-hidden="true" style={{ position: "relative", height: 12, borderRadius: 6, background: "#3A3F44", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 6, background: C.accent, width: `${d.planned ? Math.min(100, (totalFromInputs / d.planned) * 100) : 0}%` }} />
            </div>
            <span style={{ fontSize: 13, color: C.navMuted }}>
              {reste > 0 ? `Encore ${fmtN(reste)} h prévues cette semaine` : reste === 0 ? "Semaine complète" : `Dépassement de ${fmtN(-reste)} h : le pilote sera prévenu`}
            </span>
          </div>
        </>
      )}
    </section>
  );

  const taskCards = d.tasks.map((t) => (
    <article key={t.id} style={{ ...card, padding: mobile ? 16 : "20px 22px", display: "flex", flexDirection: "column", gap: mobile ? 12 : 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: mobile ? "center" : "flex-start", justifyContent: "space-between", gap: mobile ? 8 : 12 }}>
        <div style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <AxisChip code={t.axis_code} />
          <h3 style={{ margin: 0, fontSize: mobile ? 17 : 18, fontWeight: 600, lineHeight: 1.3 }}>{t.title}</h3>
          <span style={{ fontSize: mobile ? 13 : 14, color: muted }}>
            {fmtDate(t.start_date)} → {fmtDate(t.end_date)} · {t.my_role === "lead" ? "pilote" : "appui"}{t.my_role === "lead" ? (mobile ? ` ${fmtH(t.my_planned_hours)}` : ` : moi ${fmtH(t.my_planned_hours)}`) : ` ${me.name}`}
          </span>
        </div>
        <StatusPill status={t.status} />
      </div>
      {mobile ? (
        <details style={{ background: C.fond, borderRadius: 8, padding: "10px 12px", fontSize: 14 }}>
          <summary style={{ minHeight: 28, fontWeight: 500, cursor: "pointer" }}>Terminé quand…</summary>
          <p style={{ margin: "6px 0 0" }}>{t.done_criteria || "—"}</p>
        </details>
      ) : (
        <div style={{ background: box, borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={legend}>Terminé quand</span>
          <span style={{ fontSize: 14 }}>{t.done_criteria || "—"}</span>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: mobile ? 10 : 16 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flex: mobile ? "1 1 auto" : undefined }}>
          <NumberInput
            id={`h-${t.id}`}
            label={mobile ? "Mes heures" : "Mes heures cette semaine"}
            min={0} max={80} step={0.5} decimalSeparator=","
            value={hours[t.id] ?? t.my_real_hours}
            onChange={(v) => setHours({ ...hours, [t.id]: String(v ?? "") })}
            styles={{ input: { fontFamily: F_MONO, fontSize: mobile ? 18 : 16 }, root: { width: mobile ? "100%" : 120 } }}
          />
          {!mobile && <span style={{ fontFamily: F_MONO, fontSize: 14, color: muted }}>/ {fmtN(t.my_planned_hours)} h prévues</span>}
        </div>
        {mobile && <span style={{ paddingBottom: 12, fontFamily: F_MONO, fontSize: 14, color: muted }}>/ {fmtN(t.my_planned_hours)} h</span>}
        {mobile && (
          <Select
            label="Statut"
            value={t.status}
            onChange={(v) => v && setStatus(t.id, v)}
            data={STATUS_OPTIONS.map(([value, label]) => ({ value, label }))}
          />
        )}
        {!mobile && (
          <Select
            id={`s-${t.id}`}
            label="Statut"
            value={t.status}
            onChange={(v) => v && setStatus(t.id, v)}
            data={STATUS_OPTIONS.map(([value, label]) => ({ value, label }))}
            w={160}
          />
        )}
      </div>
    </article>
  ));

  if (mobile) {
    return (
      <>
        <div style={{ background: C.encre, color: C.fond, margin: "-16px -16px 0", padding: "20px 16px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <button type="button" aria-label="Semaine précédente" onClick={() => setWeek(d.week - 1)}
              style={{ width: 44, height: 44, borderRadius: 8, border: "1px solid #3A3F44", background: "transparent", color: C.fond, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              {chevL}
            </button>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <h1 style={{ margin: 0, fontFamily: F_TITRE, fontSize: 22, fontWeight: 700 }}>Ma semaine · S{String(d.week).padStart(2, "0")}</h1>
              <span style={{ fontSize: 13, color: C.navMuted }}>{fmtDate(d.monday)} → {fmtDate(d.sunday)}</span>
            </div>
            <button type="button" aria-label="Semaine suivante" onClick={() => setWeek(d.week + 1)}
              style={{ width: 44, height: 44, borderRadius: 8, border: "1px solid #3A3F44", background: "transparent", color: C.fond, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              {chevR}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ fontFamily: F_MONO, fontSize: 26, fontWeight: 600, color: C.bleuClair }}>
                {fmtN(totalFromInputs)} h <span style={{ fontSize: 15, fontWeight: 400, color: C.navMuted }}>/ {fmtN(d.planned)} h prévues</span>
              </span>
              <span style={{ fontSize: 13, color: C.navMuted }}>avant lun. 12 h</span>
            </div>
            <div aria-hidden="true" style={{ height: 10, borderRadius: 5, background: "#3A3F44", overflow: "hidden" }}>
              <div style={{ width: `${d.planned ? Math.min(100, (totalFromInputs / d.planned) * 100) : 0}%`, height: "100%", borderRadius: 5, background: C.accent }} />
            </div>
          </div>
        </div>
        {taskCards}
        <Button onClick={saveAll} size="lg" radius="md">Enregistrer mes heures</Button>
        <p role="status" style={{ fontSize: 13, color: muted, textAlign: "center" }}>{msg}</p>
      </>
    );
  }

  return (
    <>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1 style={{ margin: 0, fontFamily: F_TITRE, fontWeight: 700, fontSize: 34, letterSpacing: "-0.01em" }}>Ma semaine</h1>
          <p style={{ margin: 0, color: muted }}>S{String(d.week).padStart(2, "0")} · {fmtDate(d.monday)} → {fmtDate(d.sunday)} · à saisir avant lundi, 12 h</p>
        </div>
        {weekNav}
      </header>
      {hoursPanel}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
        <section aria-labelledby="taches-titre" style={{ flex: "3 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 id="taches-titre" style={{ margin: 0, fontFamily: F_TITRE, fontSize: 20, fontWeight: 600 }}>Mes tâches cette semaine</h2>
          {taskCards}
          {d.tasks.length === 0 && <p style={{ color: muted }}>Aucune tâche cette semaine.</p>}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
            <Button onClick={saveAll} size="md">Enregistrer mes heures</Button>
            <span role="status" style={{ fontSize: 14, color: muted }}>{msg}</span>
          </div>
        </section>
        <aside style={{ flex: "2 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <section aria-labelledby="alerte-moi" style={card}>
            <h2 id="alerte-moi" style={{ margin: 0, fontFamily: F_TITRE, fontSize: 17, fontWeight: 600 }}>Ce qui me concerne</h2>
            {myAlerts.length === 0 && <span style={{ fontSize: 14, color: C.ok }}>Rien à signaler.</span>}
            {myAlerts.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span aria-hidden="true" style={{ flex: "0 0 auto", marginTop: 6, width: 10, height: 10, borderRadius: "50%", background: (a.severity ?? 0) >= 3 ? C.crit : C.warn }} />
                <span style={{ fontSize: 14 }}><strong>{(TAG[a.kind]?.label ?? a.kind)}</strong>{a.title || a.milestone ? ` « ${a.title ?? a.milestone} »` : ""} — {alertDetail(a)}</span>
              </div>
            ))}
          </section>
          <section aria-labelledby="suivante" style={card}>
            <h2 id="suivante" style={{ margin: 0, fontFamily: F_TITRE, fontSize: 17, fontWeight: 600 }}>Semaine prochaine · S{String(d.week + 1).padStart(2, "0")}</h2>
            {(next.data?.tasks ?? []).map((t) => (
              <div key={t.id} style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 10, borderTop: `1px solid ${track}` }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{t.title}</span>
                <span style={{ fontSize: 13, color: muted }}>{fmtDate(t.start_date)} → {fmtDate(t.end_date)} · {t.my_role === "lead" ? "pilote" : "appui"}</span>
              </div>
            ))}
            {(next.data?.tasks.length ?? 0) === 0 && <span style={{ fontSize: 14, color: muted }}>Rien de prévu.</span>}
          </section>
          <section aria-labelledby="historique" style={card}>
            <h2 id="historique" style={{ margin: 0, fontFamily: F_TITRE, fontSize: 17, fontWeight: 600 }}>Mes dernières semaines</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, fontFamily: F_MONO, fontSize: 14 }}>
              {(history.data ?? []).map((h) => (
                <div key={h.week} style={{ background: C.fond, borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 12, color: muted }}>S{String(h.week).padStart(2, "0")}</span>
                  <span>{fmtN(h.real)} / {fmtN(d.capacity)}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
