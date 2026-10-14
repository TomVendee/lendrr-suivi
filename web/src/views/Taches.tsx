/** Écran Taches : reprend la maquette docs/maquettes (structure + jetons), données live. */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate, fmtH, initials, useUsers, type Task } from "../api";
import { AxisChip, C, F_MONO, F_TITRE, PageHead, btnPrimary, btnSecond, card, field, legend } from "../theme";

interface Revision {
  id: string;
  task_id: string | null;
  payload: {
    title: string; axis_code: string; start_date: string; end_date: string;
    done_criteria?: string; milestone?: boolean;
    assignments: { user_id: string; role: string; planned_hours: number }[];
  };
  created_by: string | null;
  created_at: string;
}

const TYPE_STYLE = (t: string): React.CSSProperties =>
  t === "Modification"
    ? { background: C.warnFond, color: "#5E3F0C" }
    : { background: C.accentClair, color: C.accentFonce };

export function Taches({ role }: { role: string }) {
  const qc = useQueryClient();
  const [axis, setAxis] = useState("");
  const [status, setStatus] = useState("");
  const [selRev, setSelRev] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState<Revision["payload"] | null>(null);

  const tasks = useQuery({
    queryKey: ["tasks", axis, status],
    queryFn: () => api<Task[]>(`/api/tasks${axis || status ? `?${[axis && `axis=${axis}`, status && `status=${status}`].filter(Boolean).join("&")}` : ""}`),
  });
  const revs = useQuery({
    queryKey: ["revisions"],
    queryFn: () => api<{ revisions: Revision[] }>("/api/revisions"),
    enabled: role === "pilot",
    retry: false,
  });
  const users = useUsers();
  const nameOf = (id: string) => users.data?.find((u) => u.id === id)?.name ?? id.slice(0, 8);

  const list = revs.data?.revisions ?? [];
  const sel = list.find((r) => r.id === selRev) ?? list[0] ?? null;
  const shown = sel && draft && sel.id === selRev ? { ...sel, payload: draft } : sel;

  const openRev = (id: string) => {
    const r = list.find((x) => x.id === id)!;
    setSelRev(id);
    setDraft(JSON.parse(JSON.stringify(r.payload)));
    setMsg("");
  };

  const saveDraft = async () => {
    if (!shown || !draft) return;
    await api(`/api/revisions/${shown.id}`, { method: "PUT", body: JSON.stringify(draft) });
    qc.invalidateQueries({ queryKey: ["revisions"] });
    setMsg("Brouillon enregistré.");
  };
  const decide = async (approve: boolean) => {
    if (!shown) return;
    if (draft) await api(`/api/revisions/${shown.id}`, { method: "PUT", body: JSON.stringify(draft) });
    await api(`/api/revisions/${shown.id}/validate`, { method: "POST", body: JSON.stringify({ approve }) });
    setDraft(null);
    setSelRev(null);
    setMsg(approve ? `« ${shown.payload.title} » validée.` : `« ${shown.payload.title} » renvoyée.`);
    qc.invalidateQueries({ queryKey: ["revisions"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  const setAssign = (i: number, patch: Partial<{ role: string; planned_hours: number }>) => {
    if (!draft) return;
    const a = draft.assignments.slice();
    a[i] = { ...a[i], ...patch };
    setDraft({ ...draft, assignments: a });
  };
  const removeAssign = (i: number) => {
    if (!draft) return;
    setDraft({ ...draft, assignments: draft.assignments.filter((_, k) => k !== i) });
  };
  const addAssign = (user_id: string) => {
    if (!draft) return;
    setDraft({ ...draft, assignments: [...draft.assignments, { user_id, role: "support", planned_hours: 1 }] });
  };
  const nLeads = draft?.assignments.filter((a) => a.role === "lead").length ?? 0;
  const totalH = draft?.assignments.reduce((s, a) => s + a.planned_hours, 0) ?? 0;
  const availableUsers = (users.data ?? []).filter((u) => !draft?.assignments.some((a) => a.user_id === u.id));

  return (
    <>
      <PageHead
        title={role === "pilot" ? "Tâches à valider" : "Tâches"}
        sub={role === "pilot" ? "Une tâche proposée ou modifiée reste invisible pour ses collaborateurs tant que tu ne l'as pas validée." : undefined}
      />
      {msg && (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderRadius: 10, background: C.okFond, color: "#1C4F31", fontSize: 14, fontWeight: 500 }}>
          <span>{msg}</span>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
        {role === "pilot" && (
          <section aria-labelledby="file-titre" style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 id="file-titre" style={{ margin: 0, fontFamily: F_TITRE, fontSize: 18, fontWeight: 600 }}>En attente · {list.length}</h2>
            {list.map((r) => {
              const choisi = shown?.id === r.id;
              const isMod = !!r.task_id;
              return (
                <button key={r.id} type="button" aria-pressed={choisi} onClick={() => openRev(r.id)}
                  style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 6, padding: "14px 16px", borderRadius: 10, font: "inherit", textAlign: "left", cursor: "pointer", background: C.surface, border: choisi ? `2px solid ${C.accent}` : `1px solid ${C.bordure}` }}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ height: 22, padding: "0 8px", borderRadius: 4, fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", ...TYPE_STYLE(isMod ? "Modification" : "Nouvelle tâche") }}>
                      {isMod ? "Modification" : "Nouvelle tâche"}
                    </span>
                    <span style={{ fontSize: 12, color: C.discret }}>{new Date(r.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{r.payload.title}</span>
                  <span style={{ fontSize: 13, color: C.discret }}>
                    Proposée par {r.created_by ? nameOf(r.created_by) : "—"} · {r.payload.assignments.length} collaborateur{r.payload.assignments.length > 1 ? "s" : ""}
                  </span>
                </button>
              );
            })}
            {list.length === 0 && (
              <div style={{ padding: 20, borderRadius: 10, border: "1px dashed #9AA0A6" }}>
                <span style={{ fontWeight: 600 }}>Plus rien à valider.</span>
              </div>
            )}
          </section>
        )}

        {role === "pilot" && shown && draft ? (
          <section aria-labelledby="detail-titre" style={{ ...card, flex: "2 1 520px", minWidth: 0, padding: "22px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <AxisChip code={draft.axis_code} />
              <span style={{ height: 24, padding: "0 8px", borderRadius: 4, fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", ...TYPE_STYLE(shown.task_id ? "Modification" : "Nouvelle tâche") }}>
                {shown.task_id ? "Modification" : "Nouvelle tâche"}
              </span>
              <span style={{ fontSize: 13, color: C.discret }}>
                proposée par {shown.created_by ? nameOf(shown.created_by) : "—"}
              </span>
            </div>
            <h2 id="detail-titre" style={{ margin: 0, fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>{draft.title}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={legend}>Dates</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 15 }}>{fmtDate(draft.start_date)} → {fmtDate(draft.end_date)}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={legend}>Heures prévues</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 15 }}>{fmtH(totalH)} au total</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", borderRadius: 8, background: C.fond }}>
              <span style={legend}>Terminé quand</span>
              <span style={{ fontSize: 14 }}>{draft.done_criteria || "—"}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Collaborateurs assignés · {draft.assignments.length}</h3>
              {draft.assignments.map((a, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "36px minmax(0, 1fr) 140px 120px 44px", alignItems: "center", gap: 12, padding: "8px 0", borderTop: "1px solid #ECEEF1" }}>
                  <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: "50%", background: "#E3E6EA", fontFamily: F_TITRE, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {initials(nameOf(a.user_id))}
                  </span>
                  <span style={{ fontWeight: 500 }}>{nameOf(a.user_id)}</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <label htmlFor={`role-${i}`} style={{ fontSize: 12, color: C.discret }}>Rôle</label>
                    <select id={`role-${i}`} value={a.role} onChange={(e) => setAssign(i, { role: e.target.value })}
                      style={{ ...field, height: 40, fontSize: 14 }}>
                      <option value="lead">Pilote</option>
                      <option value="support">Appui</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <label htmlFor={`hh-${i}`} style={{ fontSize: 12, color: C.discret }}>Heures</label>
                    <input id={`hh-${i}`} type="number" min={0} step={0.5} value={a.planned_hours}
                      onChange={(e) => setAssign(i, { planned_hours: parseFloat(e.target.value) || 0 })}
                      style={{ ...field, height: 40, width: "100%", fontFamily: "'IBM Plex Mono', monospace", fontSize: 15 }} />
                  </div>
                  <button type="button" aria-label={`Retirer ${nameOf(a.user_id)}`} onClick={() => removeAssign(i)}
                    style={{ alignSelf: "end", width: 44, height: 40, borderRadius: 8, border: `1px solid ${C.bordure}`, background: C.surface, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, paddingTop: 4 }}>
                <span style={{ fontSize: 13, color: C.discret }}>Ajouter :</span>
                {availableUsers.map((u) => (
                  <button key={u.id} type="button" onClick={() => addAssign(u.id)}
                    style={{ height: 36, padding: "0 12px", borderRadius: 18, border: `1px solid ${C.bordure}`, background: C.surface, font: "inherit", fontSize: 13, cursor: "pointer" }}>
                    + {u.name}
                  </button>
                ))}
              </div>
              {nLeads !== 1 && (
                <span style={{ fontSize: 13, color: "#8F1C13", fontWeight: 500 }}>
                  {nLeads === 0 ? "Il faut un pilote pour valider la tâche." : "Une seule personne peut être pilote : passe les autres en appui."}
                </span>
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <button type="button" onClick={saveDraft} style={btnSecond}>Enregistrer le brouillon</button>
              <button type="button" onClick={() => decide(true)} disabled={nLeads !== 1}
                style={{ ...btnPrimary, opacity: nLeads !== 1 ? 0.5 : 1 }}>Valider et publier</button>
              <button type="button" onClick={() => decide(false)} style={btnSecond}>Renvoyer au proposant</button>
            </div>
          </section>
        ) : (
          <section style={{ flex: "2 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select value={axis} onChange={(e) => setAxis(e.target.value)} style={{ ...field, width: "auto" }}>
                <option value="">Tous les axes</option>
                {["HARD", "SOFT", "IA", "PILOTAGE", "VIDEO"].map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...field, width: "auto" }}>
                <option value="">Tous les statuts</option>
                <option value="todo">À faire</option>
                <option value="in_progress">En cours</option>
                <option value="blocked">Bloquée</option>
                <option value="done">Terminée</option>
              </select>
            </div>
            {(tasks.data ?? []).map((t) => (
              <div key={t.id} style={card}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <AxisChip code={t.axis_code} />
                  {t.milestone && <span style={{ fontSize: 12, fontWeight: 600 }}>◆ Jalon</span>}
                </div>
                <strong>{t.title}</strong>
                <div style={{ color: C.discret, fontSize: 14 }}>{fmtDate(t.start_date)} → {fmtDate(t.end_date)} · {t.status === "todo" ? "À faire" : t.status === "in_progress" ? "En cours" : t.status === "blocked" ? "Bloquée" : "Terminée"}</div>
                <div style={{ color: C.discret, fontSize: 14 }}>
                  {t.assignments.map((a) => `${a.role === "lead" ? "Pilote" : "Appui"} ${nameOf(a.user_id)} ${fmtH(a.planned_hours)}`).join(" · ") || "sans collaborateur"}
                </div>
                {t.depends_on.length > 0 && (
                  <div style={{ fontSize: 13, color: C.discret }}>Dépend de : {t.depends_on.map((d) => d.title).join(" · ")}</div>
                )}
              </div>
            ))}
          </section>
        )}
      </div>
    </>
  );
}
