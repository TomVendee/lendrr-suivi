/** « Mes heures » dans la fiche d'une tâche : déclarer ses heures réelles d'une semaine sans passer par « Ma semaine ». */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, NumberInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { api, fmtDate, fmtN } from "../api";
import { F_MONO, muted } from "../theme";

interface HoursData {
  can_log: boolean;
  planned: number;
  total: number;
  current_week: number;
  weeks: { week: number; monday: string; sunday: string; hours: number }[];
}

const parse = (v: string | number): number => (typeof v === "number" ? v : parseFloat(String(v).replace(",", ".")) || 0);
const round = (n: number) => Math.round(n * 100) / 100;
const sw = (w: number) => `S${String(w).padStart(2, "0")}`;

export function TaskHours({ id, onSaved }: { id: string; onSaved: () => void }) {
  const q = useQuery({ queryKey: ["task-hours", id], queryFn: () => api<HoursData>(`/api/tasks/${id}/hours`) });
  const [week, setWeek] = useState<number | null>(null);
  const [val, setVal] = useState<string | number>(0);
  const [busy, setBusy] = useState(false);
  const d = q.data;

  // Semaine proposée : la semaine en cours si la tâche la couvre, sinon la plus proche.
  useEffect(() => {
    if (!d || week !== null || d.weeks.length === 0) return;
    const ws = d.weeks.map((w) => w.week);
    setWeek(ws.includes(d.current_week) ? d.current_week : d.current_week < ws[0] ? ws[0] : ws[ws.length - 1]);
  }, [d, week]);
  // Le champ reprend la valeur enregistrée de la semaine choisie.
  const saved = d?.weeks.find((w) => w.week === week)?.hours ?? 0;
  useEffect(() => { setVal(saved); }, [saved, week]);

  if (!d || !d.can_log || d.weeks.length === 0 || week === null) return null;
  const idx = d.weeks.findIndex((w) => w.week === week);
  const cur = d.weeks[idx] ?? d.weeks[0];
  const n = parse(val);
  const dirty = round(n) !== round(saved);
  const over = d.planned > 0 && d.total > d.planned;

  const save = async () => {
    if (!dirty || n < 0 || n > 80) return;
    setBusy(true);
    try {
      await api("/api/time-entries", { method: "POST", body: JSON.stringify({ task_id: id, week: cur.week, hours: round(n) }) });
      notifications.show({ message: `${fmtN(round(n))} h enregistrées pour ${sw(cur.week)}`, color: "ok" });
      await q.refetch();
      onSaved();
    } catch {
      notifications.show({ message: "Heures non enregistrées. Vérifie ta connexion et réessaie.", color: "crit" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="heures-titre">
      <h3 id="heures-titre" style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600 }}>Mes heures</h3>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <button type="button" className="icon-btn" aria-label="Semaine précédente" disabled={idx <= 0}
          onClick={() => setWeek(d.weeks[idx - 1].week)} style={{ opacity: idx <= 0 ? 0.35 : 1 }}>
          <IconChevronLeft size={16} stroke={1.8} />
        </button>
        <span style={{ fontFamily: F_MONO, fontWeight: 600, minWidth: 40, textAlign: "center" }}>{sw(cur.week)}</span>
        <button type="button" className="icon-btn" aria-label="Semaine suivante" disabled={idx >= d.weeks.length - 1}
          onClick={() => setWeek(d.weeks[idx + 1].week)} style={{ opacity: idx >= d.weeks.length - 1 ? 0.35 : 1 }}>
          <IconChevronRight size={16} stroke={1.8} />
        </button>
        <span style={{ fontSize: 13, color: muted }}>
          {fmtDate(cur.monday)} → {fmtDate(cur.sunday)}{cur.week === d.current_week ? " · cette semaine" : ""}
        </span>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); save(); }} style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8 }}>
        <NumberInput aria-label={`Heures réelles ${sw(cur.week)}`} min={0} max={80} step={0.5} decimalSeparator="," value={val}
          onChange={setVal} styles={{ input: { fontFamily: F_MONO, fontSize: 16 }, root: { width: 110 } }} />
        <div style={{ display: "flex", gap: 6 }} role="group" aria-label="Ajouter des heures">
          {[0.5, 1, 2].map((inc) => (
            <button key={inc} type="button" className="chip-add" style={{ whiteSpace: "nowrap" }} onClick={() => setVal(round(n + inc))}>
              +{fmtN(inc).replace(",0", "")} h
            </button>
          ))}
        </div>
        <Button type="submit" disabled={!dirty} loading={busy}>Enregistrer</Button>
      </form>
      <p style={{ margin: "8px 0 0", fontSize: 13, color: over ? "var(--warn-text)" : muted, fontFamily: F_MONO }}>
        Déclaré sur la tâche : {fmtN(d.total)} h{d.planned > 0 ? ` / ${fmtN(d.planned)} h prévues` : ""}
        {over ? " (au-delà du prévu)" : ""}
      </p>
      {d.weeks.some((w) => w.hours > 0) && (
        <p style={{ margin: "2px 0 0", fontSize: 12.5, color: muted }}>
          Par semaine : {d.weeks.filter((w) => w.hours > 0).map((w) => `${sw(w.week)} ${fmtN(w.hours)} h`).join(" · ")}
        </p>
      )}
    </section>
  );
}
