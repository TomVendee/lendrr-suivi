/** Écran Taches : reprend la maquette docs/maquettes (structure + jetons), données live. */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Modal, NumberInput, SegmentedControl, Select, TextInput } from "@mantine/core";
import { IconPlus, IconSearch } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { navigate } from "../router";
import { NewTaskSheet, TaskDetailSheet } from "./TaskSheet";
import { api, fmtDate, fmtH, initials, useSettings, useUsers, type Task } from "../api";
import { AXES, AxisChip, C, F_TITRE, PageHead, card, legend, line, muted, surf, track } from "../theme";
import "../styles/taches.css";

const AXIS_ORDER = ["HARD", "SOFT", "IA", "PILOTAGE", "VIDEO"] as const;
const STATUS_LABEL: Record<string, string> = { todo: "À faire", in_progress: "En cours", blocked: "Bloquée", done: "Terminée" };

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
    ? { background: C.warnFond, color: "var(--warn-text)" }
    : { background: C.accentClair, color: C.accentFonce };

export function Taches({ role, taskId }: { role: string; taskId?: string }) {
  const qc = useQueryClient();
  // Filtre d'axe prérempli depuis la Météo (/taches?axe=HARD).
  const [axis, setAxis] = useState(() => new URLSearchParams(location.search).get("axe") ?? "");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [person, setPerson] = useState<string | null>(null);
  const [selRev, setSelRev] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState<Revision["payload"] | null>(null);
  // Fiche ouverte = /taches/:id (lien partageable, retour arrière du navigateur).
  const detailId = taskId && taskId !== "nouvelle" ? taskId : null;
  const setDetailId = (id: string | null) => navigate(id ? `/taches/${id}` : "/taches");
  const [total, setTotal] = useState<number | "">("");
  const settings = useSettings();
  // File de validation : pilote, validateur ou suppléant (réglages F11).
  const canDecide = settings.data?.can_decide ?? false;
  const canCreate = role === "pilot" || (settings.data?.members_can_propose ?? true);
  // Création = /taches/nouvelle (raccourci « c », palette ⌘K).
  const creating = taskId === "nouvelle" && canCreate;
  const setCreating = (open: boolean) => navigate(open ? "/taches/nouvelle" : "/taches");

  // Toutes les tâches (≤ 500), filtrées ici : même cache que la Météo et la palette ⌘K.
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => api<Task[]>("/api/tasks") });
  const revs = useQuery({
    queryKey: ["revisions"],
    queryFn: () => api<{ revisions: Revision[] }>("/api/revisions"),
    enabled: canDecide,
    retry: false,
  });
  const users = useUsers();
  // Filtres côté client : recherche sans accents, axe, personne ; le statut s'applique en dernier (compteurs).
  const norm = (x: string) => x.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const today = new Date().toLocaleDateString("sv-SE");
  const base = (tasks.data ?? []).filter((t) =>
    (!axis || t.axis_code === axis)
    && (!person || t.assignments.some((x) => x.user_id === person))
    && (!q.trim() || norm(t.title).includes(norm(q.trim()))));
  const visible = base
    .filter((t) => !status || t.status === status)
    .sort((x, y) => Number(x.status === "done") - Number(y.status === "done") || x.start_date.localeCompare(y.start_date));
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

  const [confirm, setConfirm] = useState<null | { approve: boolean }>(null);

  const saveDraft = async () => {
    if (!shown || !draft) return;
    await api(`/api/revisions/${shown.id}`, { method: "PUT", body: JSON.stringify(draft) });
    qc.invalidateQueries({ queryKey: ["revisions"] });
    notifications.show({ message: "Brouillon enregistré", color: "brand" });
  };
  const decide = async (approve: boolean) => {
    if (!shown) return;
    // Optimiste : la proposition quitte la file tout de suite, revient si le serveur refuse.
    await qc.cancelQueries({ queryKey: ["revisions"] });
    const prev = qc.getQueryData<{ revisions: Revision[] }>(["revisions"]);
    qc.setQueryData<{ revisions: Revision[] }>(["revisions"], (r) => r && { revisions: r.revisions.filter((x) => x.id !== shown.id) });
    setConfirm(null);
    try {
      if (draft) await api(`/api/revisions/${shown.id}`, { method: "PUT", body: JSON.stringify(draft) });
      await api(`/api/revisions/${shown.id}/validate`, { method: "POST", body: JSON.stringify({ approve }) });
      setDraft(null);
      setSelRev(null);
      setConfirm(null);
      notifications.show({
        message: approve ? `« ${shown.payload.title} » validée.` : `« ${shown.payload.title} » renvoyée.`,
        color: approve ? "ok" : "warn",
      });
      qc.invalidateQueries({ queryKey: ["revisions"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    } catch {
      qc.setQueryData(["revisions"], prev);
      notifications.show({ message: "Validation refusée : il faut exactement un pilote.", color: "crit" });
    }
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
        title="Tâches"
        sub={canDecide && list.length > 0
          ? `${list.length} proposition${list.length > 1 ? "s" : ""} à valider : elles restent invisibles pour les collaborateurs tant qu'elles ne sont pas validées.`
          : tasks.data ? (() => {
            const ms = tasks.data.filter((t) => t.milestone).length;
            const done = tasks.data.filter((t) => !t.milestone && t.status === "done").length;
            return `${tasks.data.length - ms} tâches et ${ms} jalon${ms > 1 ? "s" : ""}, ${done} tâche${done > 1 ? "s" : ""} terminée${done > 1 ? "s" : ""}`;
          })() : undefined}
      />
      {msg && (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderRadius: 10, background: C.okFond, color: "var(--ok-text)", fontSize: 14, fontWeight: 500 }}>
          <span>{msg}</span>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
        {canDecide && list.length > 0 && (
          <section aria-labelledby="file-titre" style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 id="file-titre" style={{ margin: 0, fontFamily: F_TITRE, fontSize: 18, fontWeight: 600 }}>En attente ({list.length})</h2>
            {list.map((r) => {
              const choisi = shown?.id === r.id;
              const isMod = !!r.task_id;
              return (
                <button key={r.id} type="button" aria-pressed={choisi} onClick={() => openRev(r.id)}
                  style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 6, padding: "14px 16px", borderRadius: 10, font: "inherit", textAlign: "left", cursor: "pointer", background: surf, border: choisi ? `2px solid ${C.accent}` : `1px solid ${line}` }}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ height: 22, padding: "0 8px", borderRadius: 4, fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", ...TYPE_STYLE(isMod ? "Modification" : "Nouvelle tâche") }}>
                      {isMod ? "Modification" : "Nouvelle tâche"}
                    </span>
                    <span style={{ fontSize: 12, color: muted }}>{new Date(r.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{r.payload.title}</span>
                  <span style={{ fontSize: 13, color: muted }}>
                    Proposée par {r.created_by ? nameOf(r.created_by) : "—"}, {(r.payload.assignments?.length ?? 0)} collaborateur{(r.payload.assignments?.length ?? 0) > 1 ? "s" : ""}
                  </span>
                </button>
              );
            })}
            {list.length === 0 && (
              <div style={{ padding: 20, borderRadius: 10, border: "1px dashed var(--text-3)" }}>
                <span style={{ fontWeight: 600 }}>Plus rien à valider.</span>
              </div>
            )}
          </section>
        )}

        {canDecide && shown && draft ? (
          <section aria-labelledby="detail-titre" style={{ ...card, flex: "2 1 520px", minWidth: 0, padding: "22px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <AxisChip code={draft.axis_code} />
              <span style={{ height: 24, padding: "0 8px", borderRadius: 4, fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", ...TYPE_STYLE(shown.task_id ? "Modification" : "Nouvelle tâche") }}>
                {shown.task_id ? "Modification" : "Nouvelle tâche"}
              </span>
              <span style={{ fontSize: 13, color: muted }}>
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
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Collaborateurs assignés ({draft.assignments.length})</h3>
              {draft.assignments.map((a, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "36px minmax(0, 1fr) 140px 120px 44px", alignItems: "center", gap: 12, padding: "8px 0", borderTop: `1px solid ${line}` }}>
                  <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: "50%", background: `${track}`, fontFamily: F_TITRE, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {initials(nameOf(a.user_id))}
                  </span>
                  <span style={{ fontWeight: 500 }}>{nameOf(a.user_id)}</span>
                  <Select
                    label="Rôle"
                    value={a.role}
                    onChange={(v) => v && setAssign(i, { role: v })}
                    data={[{ value: "lead", label: "Pilote" }, { value: "support", label: "Appui" }]}
                  />
                  <NumberInput
                    label="Heures"
                    min={0} step={0.5} decimalSeparator=","
                    value={a.planned_hours}
                    onChange={(v) => setAssign(i, { planned_hours: typeof v === "number" ? v : 0 })}
                    styles={{ input: { fontFamily: "'IBM Plex Mono', monospace" } }}
                  />
                  <button type="button" aria-label={`Retirer ${nameOf(a.user_id)}`} onClick={() => removeAssign(i)}
                    style={{ alignSelf: "end", width: 44, height: 40, borderRadius: 8, border: `1px solid ${line}`, background: surf, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, paddingTop: 4 }}>
                <span style={{ fontSize: 13, color: muted }}>Ajouter :</span>
                {availableUsers.map((u) => (
                  <button key={u.id} type="button" onClick={() => addAssign(u.id)}
                    style={{ height: 36, padding: "0 12px", borderRadius: 18, border: `1px solid ${line}`, background: surf, font: "inherit", fontSize: 13, cursor: "pointer" }}>
                    + {u.name}
                  </button>
                ))}
              </div>
              {settings.data?.hours_mode === "equal_split" && draft.assignments.length > 0 && (
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
                  <NumberInput label="Total à répartir à parts égales" min={0} step={0.5} decimalSeparator="," suffix=" h"
                    value={total} onChange={(v) => setTotal(typeof v === "number" ? v : "")} w={240} />
                  <Button variant="default" disabled={total === ""} onClick={() => {
                    // Arrondi à 0,1 h (maquette : 3,5 h pour 3 = 1,2 h chacune), modifiable ensuite.
                    const each = Math.round((Number(total) / draft.assignments.length) * 10) / 10;
                    setDraft({ ...draft, assignments: draft.assignments.map((a) => ({ ...a, planned_hours: each })) });
                  }}>Répartir</Button>
                </div>
              )}
              {nLeads !== 1 && (
                <span style={{ fontSize: 13, color: "var(--crit-text)", fontWeight: 500 }}>
                  {nLeads === 0 ? "Il faut un pilote pour valider la tâche." : "Une seule personne peut être pilote : passe les autres en appui."}
                </span>
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <Button variant="default" onClick={saveDraft}>Enregistrer le brouillon</Button>
              <Button onClick={() => setConfirm({ approve: true })} disabled={nLeads !== 1}>Valider et publier</Button>
              <Button variant="default" onClick={() => setConfirm({ approve: false })}>Renvoyer au proposant</Button>
            </div>
            <Modal opened={confirm !== null} onClose={() => setConfirm(null)}
              title={confirm?.approve ? "Valider et publier ?" : "Renvoyer au proposant ?"} centered>
              <p style={{ color: muted }}>
                {confirm?.approve
                  ? "La tâche apparaîtra dans Ma semaine et le plan de charge de ses collaborateurs."
                  : "La tâche repart chez le proposant avec ton commentaire."}
              </p>
              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 16 }}>
                <Button variant="default" onClick={() => setConfirm(null)}>Annuler</Button>
                <Button color={confirm?.approve ? "brand" : "warn"} onClick={() => decide(!!confirm?.approve)}>
                  Confirmer
                </Button>
              </div>
            </Modal>
          </section>
        ) : (
          <section aria-label="Liste des tâches" style={{ flex: "2 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="t-filters">
              <TextInput placeholder="Rechercher une tâche" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une tâche"
                leftSection={<IconSearch size={16} stroke={1.6} />} style={{ flex: "1 1 220px" }} />
              <Select value={person} onChange={setPerson} clearable searchable placeholder="Tout le monde" aria-label="Filtrer par personne" w={170}
                data={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))} />
              {canCreate && (
                <Button onClick={() => setCreating(true)} leftSection={<IconPlus size={16} stroke={1.8} />}>
                  Nouvelle tâche
                </Button>
              )}
            </div>
            <div className="t-filters">
              {AXIS_ORDER.map((a) => (
                <button key={a} type="button" className="t-axis-chip" aria-pressed={axis === a} onClick={() => setAxis(axis === a ? "" : a)}
                  style={{ "--axis": AXES[a].color } as React.CSSProperties}>
                  <i aria-hidden="true" />{AXES[a].label}
                </button>
              ))}
              <SegmentedControl size="xs" value={status} onChange={setStatus} style={{ marginLeft: "auto" }} aria-label="Filtrer par statut"
                data={[["", "Toutes"], ["todo", "À faire"], ["in_progress", "En cours"], ["blocked", "Bloquées"], ["done", "Terminées"]]
                  .map(([value, label]) => ({ value, label: `${label} ${value ? base.filter((t) => t.status === value).length : base.length}` }))} />
            </div>
            {AXIS_ORDER.map((a) => {
              const rows = visible.filter((t) => t.axis_code === a);
              if (rows.length === 0) return null;
              const all = (tasks.data ?? []).filter((t) => t.axis_code === a && !t.milestone);
              const done = all.filter((t) => t.status === "done").length;
              return (
                <section key={a} className="t-group" aria-labelledby={`grp-${a}`} style={{ "--axis": AXES[a].color } as React.CSSProperties}>
                  <div className="t-group-head">
                    <i aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, background: "var(--axis)" }} />
                    <strong id={`grp-${a}`}>{AXES[a].label}</strong>
                    <span style={{ color: muted }}>{done} terminée{done > 1 ? "s" : ""} sur {all.length}</span>
                    <span className="t-group-bar" aria-hidden="true"><span style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} /></span>
                  </div>
                  {rows.map((t) => {
                    const lateNow = !t.milestone && t.status !== "done" && t.end_date < today;
                    const hours = t.assignments.reduce((n, x) => n + x.planned_hours, 0);
                    const lead = t.assignments.find((x) => x.role === "lead");
                    return (
                      <div key={t.id} className="t-row" data-status={t.status} role="button" tabIndex={0}
                        aria-label={`${t.title}, ${STATUS_LABEL[t.status] ?? t.status}${lateNow ? ", en retard" : ""}. Ouvrir la fiche`}
                        onClick={() => setDetailId(t.id)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailId(t.id); } }}>
                        {t.milestone
                          ? <span aria-hidden="true" style={{ width: 11, height: 11, margin: "0 2.5px", transform: "rotate(45deg)", background: "var(--text-1)", borderRadius: 2 }} />
                          : <span className="t-status" data-s={t.status} aria-hidden="true" />}
                        <div style={{ minWidth: 0 }}>
                          <div className="t-title">{t.title}</div>
                          <div className="t-meta">
                            {lateNow && <span className="t-late">En retard, </span>}
                            {t.milestone ? "Jalon" : STATUS_LABEL[t.status]}
                            {lead ? `, pilote ${nameOf(lead.user_id)}` : ", sans pilote"}
                            {t.depends_on.length > 0 ? `, dépend de ${t.depends_on.length} tâche${t.depends_on.length > 1 ? "s" : ""}` : ""}
                          </div>
                        </div>
                        <div className="t-avatars" aria-hidden="true">
                          {[...t.assignments].sort((x) => (x.role === "lead" ? -1 : 1)).slice(0, 4).map((x) => (
                            <span key={x.user_id} data-lead={x.role === "lead" || undefined} title={nameOf(x.user_id)}>{initials(nameOf(x.user_id))}</span>
                          ))}
                        </div>
                        <span className="t-dates">{t.milestone ? fmtDate(t.start_date) : `${fmtDate(t.start_date)} → ${fmtDate(t.end_date)}`}</span>
                        <span className="t-hours">{t.milestone ? "" : fmtH(hours)}</span>
                      </div>
                    );
                  })}
                </section>
              );
            })}
            {tasks.data && visible.length === 0 && (
              <div style={{ ...card, textAlign: "center", padding: "32px 20px" }}>
                <p style={{ margin: "0 0 4px", fontWeight: 500 }}>Aucune tâche ne correspond à ces filtres.</p>
                <p style={{ margin: 0, color: muted, fontSize: 14 }}>Retire un filtre ou cherche un autre mot.</p>
              </div>
            )}
          </section>
        )}
      </div>
      <NewTaskSheet opened={creating} onClose={() => setCreating(false)} role={role} />
      {detailId && <TaskDetailSheet id={detailId} onClose={() => setDetailId(null)} role={role} nameOf={nameOf} />}
    </>
  );
}
