import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, useMe } from "./api";

// Jetons docs/maquettes/README.md
const T = {
  fond: "#F4F5F7",
  surface: "#FFFFFF",
  encre: "#202326",
  bordure: "#D0D5DA",
  discret: "#5C6268",
  accent: "#2D5BD7",
  accentClair: "#E3EBFD",
  ok: "#2E7D4F",
  okFond: "#E3F1E8",
  warn: "#B7791F",
  warnFond: "#FBF1DE",
  crit: "#B42318",
  critFond: "#FDE7E4",
};

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
};
const fmtH = (h: number) => `${h.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`;

const card: React.CSSProperties = {
  background: T.surface,
  border: `1px solid ${T.bordure}`,
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
};
const btn: React.CSSProperties = {
  background: T.accent,
  color: "#fff",
  border: 0,
  borderRadius: 6,
  padding: "10px 16px",
  minHeight: 44,
  cursor: "pointer",
};
const input: React.CSSProperties = {
  border: `1px solid ${T.bordure}`,
  borderRadius: 6,
  padding: "10px 12px",
  minHeight: 44,
  width: "100%",
  boxSizing: "border-box",
};

type View = "semaine" | "taches" | "charge" | "gantt" | "alertes" | "meteo" | "synthese";

export function App() {
  const me = useMe();
  const [view, setView] = useState<View>("semaine");

  if (me.isLoading) return <p style={{ padding: 24 }}>Chargement…</p>;
  if (me.isError) return <Login />;
  const role = me.data!.role;

  const nav: [View, string][] = [
    ["semaine", "Ma semaine"],
    ["taches", "Tâches"],
    ["charge", "Charge"],
    ["gantt", "Gantt"],
    ["alertes", "Alertes"],
    ["meteo", "Météo"],
    ["synthese", "Synthèse"],
  ];

  return (
    <div style={{ background: T.fond, minHeight: "100vh", color: T.encre, fontFamily: "'IBM Plex Sans',system-ui,sans-serif" }}>
      <header style={{ background: T.encre, color: "#fff", padding: "12px 16px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ fontFamily: "'Space Grotesk',sans-serif", marginRight: 12 }}>Suivi projet</strong>
        {nav.map(([v, label]) => (
          <button key={v} onClick={() => setView(v)}
            style={{ ...btn, background: view === v ? T.accent : "transparent", border: `1px solid ${view === v ? T.accent : "#555"}` }}>
            {label}
          </button>
        ))}
        <span style={{ marginLeft: "auto", color: "#ccc" }}>{me.data!.name} ({role === "pilot" ? "pilote" : "membre"})</span>
        <LogoutButton />
      </header>
      <main style={{ maxWidth: 960, margin: "0 auto", padding: 16 }}>
        {view === "semaine" && <Semaine />}
        {view === "taches" && <Taches role={role} />}
        {view === "charge" && <Charge />}
        {view === "gantt" && <Gantt />}
        {view === "alertes" && <Alertes />}
        {view === "meteo" && <Meteo />}
        {view === "synthese" && <Synthese role={role} />}
      </main>
    </div>
  );
}

function Login() {
  const qc = useQueryClient();
  const [f, setF] = useState({ email: "", password: "", code: "", name: "" });
  const [mode, setMode] = useState<"login" | "setup">("login");
  const [err, setErr] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      if (mode === "login") {
        await api("/api/login", { method: "POST", body: JSON.stringify({ email: f.email, password: f.password }) });
      } else {
        await api("/setup", { method: "POST", body: JSON.stringify({ code: f.code, name: f.name, email: f.email, password: f.password }) });
        await api("/api/login", { method: "POST", body: JSON.stringify({ email: f.email, password: f.password }) });
      }
      qc.invalidateQueries({ queryKey: ["me"] });
    } catch {
      setErr("Échec de connexion — vérifie tes identifiants (ou le code setup).");
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: "4rem auto", padding: 16 }}>
      <h1 style={{ fontFamily: "'Space Grotesk',sans-serif" }}>Suivi projet</h1>
      <div style={card}>
        <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
          {mode === "setup" && (
            <>
              <input style={input} placeholder="Code setup (SETUP_CODE)" value={f.code} onChange={set("code")} />
              <input style={input} placeholder="Nom" value={f.name} onChange={set("name")} />
            </>
          )}
          <input style={input} placeholder="E-mail" value={f.email} onChange={set("email")} autoComplete="email" />
          <input style={input} placeholder="Mot de passe" type="password" value={f.password} onChange={set("password")} autoComplete="current-password" />
          {err && <p style={{ color: T.crit }}>{err}</p>}
          <button style={btn} type="submit">{mode === "login" ? "Se connecter" : "Créer le compte pilote"}</button>
        </form>
      </div>
      <button style={{ ...btn, background: T.encre }} onClick={() => setMode(mode === "login" ? "setup" : "login")}>
        {mode === "login" ? "Premier lancement ? Créer le compte" : "J'ai déjà un compte"}
      </button>
    </div>
  );
}

function LogoutButton() {
  const qc = useQueryClient();
  return (
    <button style={{ ...btn, background: "transparent", border: "1px solid #555" }}
      onClick={() => api("/api/logout", { method: "POST" }).finally(() => qc.invalidateQueries({ queryKey: ["me"] }))}>
      Quitter
    </button>
  );
}

interface WeekTask {
  id: string; title: string; axis_code: string; start_date: string; end_date: string;
  status: string; my_role: string; my_planned_hours: number; my_real_hours: number;
}
interface MyWeek {
  week: number; tasks: WeekTask[]; planned: number; real: number; capacity: number;
  alerts: { kind: string }[];
}

function Semaine() {
  const qc = useQueryClient();
  const [week, setWeek] = useState<number | undefined>(undefined);
  const q = useQuery({
    queryKey: ["my-week", week],
    queryFn: () => api<MyWeek>(`/api/my-week${week ? `?week=${week}` : ""}`),
  });
  const [hours, setHours] = useState<Record<string, string>>({});

  if (q.isLoading) return <p>Chargement…</p>;
  if (q.isError) return <p>Erreur de chargement.</p>;
  const d = q.data!;

  const log = async (taskId: string) => {
    const h = parseFloat((hours[taskId] ?? "").replace(",", "."));
    if (Number.isNaN(h)) return;
    // Trouver la tâche pour son id (déjà connu ici)
    await api("/api/time-entries", { method: "POST", body: JSON.stringify({ task_id: taskId, week: d.week, hours: h }) });
    qc.invalidateQueries({ queryKey: ["my-week"] });
  };
  const setStatus = async (taskId: string, status: string) => {
    await api(`/api/tasks/${taskId}/status`, { method: "POST", body: JSON.stringify({ status }) });
    qc.invalidateQueries({ queryKey: ["my-week"] });
  };

  return (
    <div>
      <h2>Semaine S{String(d.week).padStart(2, "0")}</h2>
      <div style={card}>
        <strong>Prévu {fmtH(d.planned)}</strong> · déclaré {fmtH(d.real)} · capacité {fmtH(d.capacity)}
        {d.planned > d.capacity && <span style={{ marginLeft: 8, background: T.critFond, color: T.crit, padding: "2px 8px", borderRadius: 4 }}>surcharge</span>}
      </div>
      {d.tasks.map((t) => (
        <div key={t.id} style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <strong>{t.title}</strong>
            <span style={{ color: T.discret }}>{t.axis_code} · {fmtDate(t.start_date)} → {fmtDate(t.end_date)} · {t.my_role === "lead" ? "pilote" : "appui"}</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select value={t.status} style={{ ...input, width: "auto" }}
              onChange={(e) => setStatus(t.id, e.target.value)}>
              <option value="todo">À faire</option>
              <option value="in_progress">En cours</option>
              <option value="blocked">Bloquée</option>
              <option value="done">Terminée</option>
            </select>
            <span style={{ color: T.discret }}>prévu {fmtH(t.my_planned_hours)} · déclaré {fmtH(t.my_real_hours)}</span>
            <input style={{ ...input, width: 110 }} placeholder="1,5 h" inputMode="decimal"
              value={hours[t.id] ?? ""} onChange={(e) => setHours({ ...hours, [t.id]: e.target.value })} />
            <button style={btn} onClick={() => log(t.id)}>Déclarer</button>
          </div>
        </div>
      ))}
      {d.tasks.length === 0 && <p style={{ color: T.discret }}>Aucune tâche cette semaine.</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button style={{ ...btn, background: T.encre }} onClick={() => setWeek(d.week - 1)}>← S{d.week - 1}</button>
        <button style={{ ...btn, background: T.encre }} onClick={() => setWeek(undefined)}>Cette semaine</button>
        <button style={{ ...btn, background: T.encre }} onClick={() => setWeek(d.week + 1)}>S{d.week + 1} →</button>
      </div>
    </div>
  );
}

interface Task {
  id: string; title: string; axis_code: string; start_date: string; end_date: string;
  status: string; milestone: boolean; assignments: { user_id: string; role: string; planned_hours: number }[];
}

function Taches({ role }: { role: string }) {
  const qc = useQueryClient();
  const [axis, setAxis] = useState("");
  const q = useQuery({
    queryKey: ["tasks", axis],
    queryFn: () => api<Task[]>(`/api/tasks${axis ? `?axis=${axis}` : ""}`),
  });
  const revs = useQuery({
    queryKey: ["revisions"],
    queryFn: () => api<{ revisions: { id: string; payload: { title: string } }[] }>("/api/revisions"),
    enabled: role === "pilot",
    retry: false,
  });

  const decide = async (id: string, approve: boolean) => {
    await api(`/api/revisions/${id}/validate`, { method: "POST", body: JSON.stringify({ approve }) });
    qc.invalidateQueries({ queryKey: ["revisions"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  return (
    <div>
      <h2>Tâches</h2>
      <div style={{ marginBottom: 12 }}>
        <select style={{ ...input, width: "auto" }} value={axis} onChange={(e) => setAxis(e.target.value)}>
          <option value="">Tous les axes</option>
          {["HARD", "SOFT", "IA", "PILOTAGE", "VIDEO"].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      {role === "pilot" && revs.data && revs.data.revisions.length > 0 && (
        <div style={{ ...card, borderColor: T.warn }}>
          <h3>À valider ({revs.data.revisions.length})</h3>
          {revs.data.revisions.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <span style={{ flex: 1 }}>{r.payload.title}</span>
              <button style={btn} onClick={() => decide(r.id, true)}>Valider</button>
              <button style={{ ...btn, background: T.encre }} onClick={() => decide(r.id, false)}>Renvoyer</button>
            </div>
          ))}
        </div>
      )}
      {q.data?.map((t) => (
        <div key={t.id} style={card}>
          <strong>{t.milestone ? "◆ " : ""}{t.title}</strong>
          <div style={{ color: T.discret }}>{t.axis_code} · {fmtDate(t.start_date)} → {fmtDate(t.end_date)} · {t.status}</div>
          <div style={{ color: T.discret }}>
            {t.assignments.map((a) => `${a.role === "lead" ? "Pilote" : "Appui"} : ${fmtH(a.planned_hours)}`).join(" · ") || "sans collaborateur"}
          </div>
        </div>
      ))}
    </div>
  );
}

function Charge() {
  const q = useQuery({
    queryKey: ["load"],
    queryFn: () => api<{ rows: { user_id: string; name: string; weeks: { week: number; planned: number; real: number; capacity: number }[] }[] }>("/api/load?from=6&to=12"),
  });
  if (!q.data) return <p>Chargement…</p>;
  const weeks = q.data.rows[0]?.weeks.map((w) => w.week) ?? [];
  return (
    <div>
      <h2>Plan de charge</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", background: T.surface, width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8 }}>Qui</th>
              {weeks.map((w) => <th key={w} style={{ padding: 8 }}>S{w}</th>)}
            </tr>
          </thead>
          <tbody>
            {q.data.rows.map((r) => (
              <tr key={r.user_id}>
                <td style={{ padding: 8, borderTop: `1px solid ${T.bordure}` }}>{r.name}</td>
                {r.weeks.map((w) => {
                  const over = w.planned > w.capacity;
                  return (
                    <td key={w.week} style={{
                      padding: 8, borderTop: `1px solid ${T.bordure}`, textAlign: "center",
                      background: over ? T.critFond : w.real > 0 ? T.okFond : undefined,
                    }}>
                      {fmtH(w.planned)} <span style={{ color: T.discret }}>/ {fmtH(w.real)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: T.discret }}>Prévu / déclaré par case, coloré selon la capacité.</p>
    </div>
  );
}

function Gantt() {
  const q = useQuery({
    queryKey: ["gantt"],
    queryFn: () => api<{ today: string; tasks: { id: string; title: string; start: string; end: string; status: string; milestone: boolean; critical: boolean }[]; deps: { from: string; to: string }[] }>("/api/gantt"),
  });
  if (!q.data) return <p>Chargement…</p>;
  const tasks = q.data.tasks.filter((t) => !t.milestone);
  const W = 900, rowH = 26;
  const dates = tasks.flatMap((t) => [t.start, t.end]).sort();
  const min = dates[0] ?? q.data.today, max = dates[dates.length - 1] ?? q.data.today;
  const day = (iso: string) => (new Date(iso).getTime() - new Date(min).getTime()) / 86400000;
  const span = Math.max(1, day(max) + 1);
  const X = (iso: string) => 220 + (day(iso) / span) * (W - 240);
  return (
    <div>
      <h2>Gantt {q.data.tasks.some((t) => t.critical) && <span style={{ color: T.accent }}>— chemin critique en bleu</span>}</h2>
      <svg viewBox={`0 0 ${W} ${tasks.length * rowH + 10}`} style={{ width: "100%", background: T.surface, border: `1px solid ${T.bordure}`, borderRadius: 8 }}>
        {tasks.map((t, i) => (
          <g key={t.id}>
            <text x={4} y={i * rowH + 18} fontSize={12} width={200}>{t.title.slice(0, 26)}</text>
            <rect x={X(t.start)} y={i * rowH + 5} width={Math.max(4, X(t.end) - X(t.start) + (W - 240) / span)} height={16} rx={4}
              fill={t.critical ? T.accent : t.status === "done" ? T.ok : T.accentClair}
              stroke={t.critical ? T.accent : T.accent} />
          </g>
        ))}
      </svg>
      <p style={{ color: T.discret }}>Aujourd'hui : {fmtDate(q.data.today)}. Les jalons (◆) figurent dans l'onglet Tâches.</p>
    </div>
  );
}

function Alertes() {
  const q = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api<{ alerts: { kind: string; severity: number; title?: string; user?: string; week?: number }[] }>("/api/alerts"),
  });
  if (!q.data) return <p>Chargement…</p>;
  const colors = (s: number) => s >= 3 ? { bg: T.critFond, c: T.crit } : s === 2 ? { bg: T.warnFond, c: T.warn } : { bg: T.accentClair, c: T.accent };
  const labels: Record<string, string> = {
    overload: "Surcharge prévue", overrun: "Dépassement réel", "missing-hours": "Heures non déclarées",
    late: "Tâche en retard", "blocking-late": "Retard bloquant",
    "milestone-threatened": "Jalon menacé", incomplete: "Tâche incomplète",
  };
  return (
    <div>
      <h2>Alertes ({q.data.alerts.length})</h2>
      {q.data.alerts.map((a, i) => {
        const col = colors(a.severity);
        return (
          <div key={i} style={{ ...card, background: col.bg, color: col.c }}>
            <strong>{labels[a.kind] ?? a.kind}</strong>
            {" — "}{a.title ?? a.user ?? ""}{a.week ? ` (S${a.week})` : ""}
          </div>
        );
      })}
      {q.data.alerts.length === 0 && <p style={{ color: T.ok }}>Aucune alerte. Tout est au vert.</p>}
    </div>
  );
}

function Meteo() {
  const q = useQuery({
    queryKey: ["meteo"],
    queryFn: () => api<{ cards: { axis: string; label: string; total: number; done: number; progress: number; late: { title: string }[]; next_milestone: { title: string; date: string; risk: string | null } | null }[] }>("/api/meteo"),
  });
  if (!q.data) return <p>Chargement…</p>;
  return (
    <div>
      <h2>Météo du projet</h2>
      {q.data.cards.map((c) => (
        <div key={c.axis} style={card}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong style={{ fontFamily: "'Space Grotesk',sans-serif" }}>{c.label}</strong>
            <span>{c.done}/{c.total} · {Math.round(c.progress * 100)} %</span>
          </div>
          <div style={{ background: T.fond, borderRadius: 4, height: 8, marginTop: 8 }}>
            <div style={{ width: `${c.progress * 100}%`, background: c.late.length ? T.warn : T.ok, height: 8, borderRadius: 4 }} />
          </div>
          {c.late.length > 0 && <p style={{ color: T.warn }}>En retard : {c.late.map((l) => l.title).join(", ")}</p>}
          {c.next_milestone && (
            <p style={{ color: c.next_milestone.risk ? T.crit : T.discret }}>
              ◆ {c.next_milestone.title} ({fmtDate(c.next_milestone.date)})
              {c.next_milestone.risk ? ` — ${c.next_milestone.risk}` : " — à l'heure"}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function Synthese({ role }: { role: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["synthesis"],
    queryFn: () => api<{ week: number; text: string }>("/api/synthesis"),
    enabled: role === "pilot",
  });
  const [msg, setMsg] = useState("");
  if (role !== "pilot") return <p style={{ color: T.discret }}>La synthèse est réservée au pilote.</p>;

  const act = async (path: string, init?: RequestInit) => {
    setMsg("");
    try {
      const r = await api<{ ok?: boolean; week?: number }>(path, init);
      setMsg(`OK${r.week ? ` (S${r.week})` : ""} — pensez à retirer SETUP_CODE si c'était le premier lancement.`);
      qc.invalidateQueries();
    } catch (e) {
      setMsg(`Échec : ${String(e)}`);
    }
  };

  return (
    <div>
      <h2>Synthèse & réglages</h2>
      <div style={card}>
        <h3>Synthèse de la semaine</h3>
        <p>{q.data?.text ?? "Chargement…"}</p>
      </div>
      <div style={card}>
        <h3>Photo du lundi (baseline)</h3>
        <button style={btn} onClick={() => act("/api/baselines", { method: "POST" })}>Figer la baseline</button>
      </div>
      <div style={card}>
        <h3>Export soutenance</h3>
        <a href="/api/export" style={{ ...btn, textDecoration: "none", display: "inline-block" }}>Télécharger le JSON prévu/réalisé</a>
      </div>
      <div style={card}>
        <h3>Token IA personnel</h3>
        <button style={{ ...btn, background: T.encre }} onClick={async () => {
          const r = await api<{ token: string }>("/api/tokens", { method: "POST" });
          setMsg(`Token (à copier maintenant, affiché une seule fois) : ${r.token}`);
        }}>Créer un token</button>
      </div>
      {msg && <p style={{ ...card, background: T.warnFond }}>{msg}</p>}
    </div>
  );
}
