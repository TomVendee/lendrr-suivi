/** Écran Taches : reprend la maquette docs/maquettes (structure + jetons), données live. */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Modal, NumberInput, Select, TextInput, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { navigate } from "../router";
import { api, fmtDate, fmtH, initials, useSettings, useUsers, type Task } from "../api";
import { AxisChip, C, F_TITRE, PageHead, card, legend, line, muted, surf, track } from "../theme";

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
  const [axis, setAxis] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [selRev, setSelRev] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState<Revision["payload"] | null>(null);
  const [creating, setCreating] = useState(false);
  // Fiche ouverte = /taches/:id (lien partageable, retour arrière du navigateur).
  const detailId = taskId ?? null;
  const setDetailId = (id: string | null) => navigate(id ? `/taches/${id}` : "/taches");
  const [total, setTotal] = useState<number | "">("");
  const settings = useSettings();
  // File de validation : pilote, validateur ou suppléant (réglages F11).
  const canDecide = settings.data?.can_decide ?? false;
  const canCreate = role === "pilot" || (settings.data?.members_can_propose ?? true);

  const tasks = useQuery({
    queryKey: ["tasks", axis, status, q],
    queryFn: () => {
      const p = new URLSearchParams();
      if (axis) p.set("axis", axis);
      if (status) p.set("status", status);
      if (q.trim()) p.set("q", q.trim());
      const s = p.toString();
      return api<Task[]>(`/api/tasks${s ? `?${s}` : ""}`);
    },
  });
  const revs = useQuery({
    queryKey: ["revisions"],
    queryFn: () => api<{ revisions: Revision[] }>("/api/revisions"),
    enabled: canDecide,
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

  const [confirm, setConfirm] = useState<null | { approve: boolean }>(null);

  const saveDraft = async () => {
    if (!shown || !draft) return;
    await api(`/api/revisions/${shown.id}`, { method: "PUT", body: JSON.stringify(draft) });
    qc.invalidateQueries({ queryKey: ["revisions"] });
    notifications.show({ message: "Brouillon enregistré", color: "brand" });
  };
  const decide = async (approve: boolean) => {
    if (!shown) return;
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
      notifications.show({ message: "Échec — vérifie le pilote unique.", color: "crit" });
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
        title={canDecide ? "Tâches à valider" : "Tâches"}
        sub={canDecide ? "Une tâche proposée ou modifiée reste invisible pour ses collaborateurs tant que tu ne l'as pas validée." : undefined}
      />
      {msg && (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderRadius: 10, background: C.okFond, color: "var(--ok-text)", fontSize: 14, fontWeight: 500 }}>
          <span>{msg}</span>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
        {canDecide && (
          <section aria-labelledby="file-titre" style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 id="file-titre" style={{ margin: 0, fontFamily: F_TITRE, fontSize: 18, fontWeight: 600 }}>En attente · {list.length}</h2>
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
                    Proposée par {r.created_by ? nameOf(r.created_by) : "—"} · {r.payload.assignments.length} collaborateur{r.payload.assignments.length > 1 ? "s" : ""}
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
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Collaborateurs assignés · {draft.assignments.length}</h3>
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
          <section style={{ flex: "2 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <TextInput placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)}
                style={{ flex: "1 1 180px" }} />
              <Select
                value={axis} onChange={(v) => setAxis(v ?? "")} clearable placeholder="Tous les axes"
                data={["HARD", "SOFT", "IA", "PILOTAGE", "VIDEO"]} w={170}
              />
              <Select
                value={status} onChange={(v) => setStatus(v ?? "")} clearable placeholder="Tous les statuts"
                data={[
                  { value: "todo", label: "À faire" },
                  { value: "in_progress", label: "En cours" },
                  { value: "blocked", label: "Bloquée" },
                  { value: "done", label: "Terminée" },
                ]} w={170}
              />
              {canCreate && <Button onClick={() => setCreating(true)}>+ Nouvelle tâche</Button>}
            </div>
            {(tasks.data ?? []).map((t) => (
              <div key={t.id} onClick={() => setDetailId(t.id)}
                style={{ ...card, cursor: "pointer" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <AxisChip code={t.axis_code} />
                  {t.milestone && <span style={{ fontSize: 12, fontWeight: 600 }}>◆ Jalon</span>}
                </div>
                <strong>{t.title}</strong>
                <div style={{ color: muted, fontSize: 14 }}>{fmtDate(t.start_date)} → {fmtDate(t.end_date)} · {t.status === "todo" ? "À faire" : t.status === "in_progress" ? "En cours" : t.status === "blocked" ? "Bloquée" : "Terminée"}</div>
                <div style={{ color: muted, fontSize: 14 }}>
                  {t.assignments.map((a) => `${a.role === "lead" ? "Pilote" : "Appui"} ${nameOf(a.user_id)} ${fmtH(a.planned_hours)}`).join(" · ") || "sans collaborateur"}
                </div>
                {t.depends_on.length > 0 && (
                  <div style={{ fontSize: 13, color: muted }}>Dépend de : {t.depends_on.map((d) => d.title).join(" · ")}</div>
                )}
              </div>
            ))}
            {tasks.data?.length === 0 && <p style={{ color: muted }}>Aucune tâche ne correspond.</p>}
          </section>
        )}
      </div>
      <NewTaskModal opened={creating} onClose={() => setCreating(false)} role={role} />
      {detailId && <TaskDetail id={detailId} onClose={() => setDetailId(null)} role={role} nameOf={nameOf} />}
    </>
  );
}

/** Création : publiée directement côté pilote ; côté membre, selon les réglages F11. */
function NewTaskModal({ opened, onClose, role }: { opened: boolean; onClose: () => void; role: string }) {
  const qc = useQueryClient();
  const users = useUsers();
  const [f, setF] = useState({ title: "", axis: "HARD", start: "", end: "", criteria: "", milestone: false, lead: "", hours: "4" });
  const set = (k: string) => (v: string | boolean) => setF({ ...f, [k]: v });
  const people = (users.data ?? []).map((u) => ({ value: u.id, label: u.name }));
  const validation = useSettings().data?.validation_enabled ?? true;

  const submit = async () => {
    if (!f.title.trim() || !f.start || !f.end || !f.lead) {
      notifications.show({ message: "Titre, dates et pilote requis.", color: "warn" });
      return;
    }
    try {
      const r = await api<{ id?: string; status?: string }>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: f.title.trim(), axis_code: f.axis, start_date: f.start, end_date: f.end,
          done_criteria: f.criteria, milestone: f.milestone,
          assignments: [{ user_id: f.lead, role: "lead", planned_hours: parseFloat(f.hours.replace(",", ".")) || 0 }],
        }),
      });
      notifications.show({
        message: r.status === "pending-validation" ? "Proposée — en attente de validation." : "Tâche créée.",
        color: "ok",
      });
      onClose();
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["revisions"] });
    } catch (e) {
      notifications.show({ message: `Échec : ${String(e)}`, color: "crit" });
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Nouvelle tâche" size="lg" centered>
      <div style={{ display: "grid", gap: 12 }}>
        <TextInput label="Titre" value={f.title} onChange={(e) => set("title")(e.target.value)} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Select label="Axe" value={f.axis} onChange={(v) => v && set("axis")(v)}
            data={["HARD", "SOFT", "IA", "PILOTAGE", "VIDEO"]} />
          <Select label="Pilote" value={f.lead} onChange={(v) => v && set("lead")(v)}
            data={people} searchable placeholder="Qui pilote ?" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <TextInput label="Début" type="date" value={f.start} onChange={(e) => set("start")(e.target.value)} />
          <TextInput label="Fin" type="date" value={f.end} onChange={(e) => set("end")(e.target.value)} />
          <NumberInput label="Heures pilote" min={0} step={0.5} decimalSeparator=","
            value={f.hours} onChange={(v) => set("hours")(String(v ?? ""))} />
        </div>
        <Textarea label="Terminé quand" value={f.criteria} onChange={(e) => set("criteria")(e.target.value)} rows={2} />
        <Checkbox label="Jalon (date unique, ne bouge jamais seul)" checked={f.milestone}
          onChange={(e) => set("milestone")(e.currentTarget.checked)} />
        {role !== "pilot" && validation && <p style={{ color: muted, fontSize: 13 }}>En tant que membre, ta tâche part en validation.</p>}
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <Button variant="default" onClick={onClose}>Annuler</Button>
          <Button onClick={submit}>Créer</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Fiche : dépendances (pilote), fil de discussion. */
function TaskDetail({ id, onClose, role, nameOf }: {
  id: string; onClose: () => void; role: string; nameOf: (id: string) => string;
}) {
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const [pred, setPred] = useState<string | null>(null);
  const task = useQuery({ queryKey: ["task", id], queryFn: () => api<Task>(`/api/tasks/${id}`) });
  const comments = useQuery({
    queryKey: ["comments", id],
    queryFn: () => api<{ author: string; body: string; at: string }[]>(`/api/tasks/${id}/comments`),
  });
  const all = useQuery({ queryKey: ["tasks-all"], queryFn: () => api<Task[]>("/api/tasks") });

  const post = async () => {
    if (!comment.trim()) return;
    await api(`/api/tasks/${id}/comments`, { method: "POST", body: JSON.stringify({ body: comment.trim() }) });
    setComment("");
    qc.invalidateQueries({ queryKey: ["comments", id] });
  };
  const addDep = async () => {
    if (!pred) return;
    try {
      await api("/api/dependencies", { method: "POST", body: JSON.stringify({ pred_id: pred, succ_id: id }) });
      notifications.show({ message: "Dépendance ajoutée.", color: "ok" });
      qc.invalidateQueries({ queryKey: ["task", id] });
    } catch {
      notifications.show({ message: "Refusée (cycle ou doublon).", color: "crit" });
    }
  };
  const delDep = async (pred_id: string) => {
    await api("/api/dependencies", { method: "DELETE", body: JSON.stringify({ pred_id, succ_id: id }) });
    qc.invalidateQueries({ queryKey: ["task", id] });
  };

  const t = task.data;
  return (
    <Modal opened onClose={onClose} title={t?.title ?? "Tâche"} size="lg" centered>
      {!t ? <p>Chargement…</p> : (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <AxisChip code={t.axis_code} />
            <span style={{ fontSize: 13, color: muted }}>{fmtDate(t.start_date)} → {fmtDate(t.end_date)}</span>
          </div>
          {t.done_criteria && <p style={{ margin: 0, fontSize: 14 }}><strong>Terminé quand : </strong>{t.done_criteria}</p>}
          <div>
            <strong style={{ fontSize: 14 }}>Dépend de</strong>
            {(t.depends_on ?? []).map((d) => (
              <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                <span style={{ flex: 1, fontSize: 14 }}>{d.title}</span>
                {role === "pilot" && (
                  <Button variant="subtle" color="crit" size="xs" onClick={() => delDep(d.id)}>Retirer</Button>
                )}
              </div>
            ))}
            {(t.depends_on ?? []).length === 0 && <p style={{ color: muted, fontSize: 13 }}>Aucune dépendance.</p>}
            {role === "pilot" && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <Select placeholder="Tâche précédente…" value={pred} onChange={setPred} searchable style={{ flex: 1 }}
                  data={(all.data ?? []).filter((x) => x.id !== id).map((x) => ({ value: x.id, label: x.title }))} />
                <Button variant="default" onClick={addDep}>Lier</Button>
              </div>
            )}
          </div>
          <div>
            <strong style={{ fontSize: 14 }}>Discussion ({(comments.data ?? []).length})</strong>
            {(comments.data ?? []).map((c, i) => (
              <div key={i} style={{ padding: "8px 0", borderTop: `1px solid ${line}` }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{c.author}</span>
                <span style={{ fontSize: 12, color: muted }}> · {new Date(c.at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
                <p style={{ margin: "2px 0 0", fontSize: 14 }}>{c.body}</p>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Textarea placeholder="Écrire un commentaire…" value={comment}
                onChange={(e) => setComment(e.target.value)} rows={1} style={{ flex: 1 }} />
              <Button onClick={post}>Envoyer</Button>
            </div>
          </div>
          <p style={{ color: muted, fontSize: 13 }}>
            {t.assignments.map((a) => `${a.role === "lead" ? "Pilote" : "Appui"} ${nameOf(a.user_id)} ${fmtH(a.planned_hours)}`).join(" · ")}
          </p>
        </div>
      )}
    </Modal>
  );
}
