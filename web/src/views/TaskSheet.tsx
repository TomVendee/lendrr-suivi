/** Fiche d'une tâche (lecture, statut, modification) et création, autour d'un formulaire unique. */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, NumberInput, SegmentedControl, Select, TextInput, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowBackUp, IconCheck, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { api, fmtDate, fmtH, initials, useMe, useSettings, useUsers, type Task } from "../api";
import { Sheet } from "../Shell";
import { TaskHours } from "./TaskHours";
import { toastUndo } from "../motion";
import { AXES, AxisChip, StatusPill, line, muted } from "../theme";

interface Draft {
  title: string;
  axis_code: string;
  start_date: string;
  end_date: string;
  milestone: boolean;
  description: string;
  done_criteria: string;
  assignments: { user_id: string; role: string; planned_hours: number }[];
}

const STATUSES = [
  { value: "todo", label: "À faire" },
  { value: "in_progress", label: "En cours" },
  { value: "blocked", label: "Bloquée" },
  { value: "done", label: "Terminée" },
];

/** Rafraîchit tout ce qui dépend d'une tâche (liste, Gantt, charge, alertes…). */
function refreshAll(qc: ReturnType<typeof useQueryClient>, id?: string) {
  for (const k of ["tasks", "gantt", "gantt-all", "revisions", "my-week", "meteo", "alerts", "load-now", "load-wide", "graphs"]) {
    qc.invalidateQueries({ queryKey: [k] });
  }
  if (id) qc.invalidateQueries({ queryKey: ["task", id] });
}

/** Message après enregistrement : publié (avec cascade éventuelle) ou proposé à la validation. */
function announce(r: { status?: string; shifted?: string[]; milestones_threatened?: string[] } | null, created: boolean) {
  if (r?.status === "pending-validation") {
    notifications.show({
      color: "brand",
      message: created ? "Tâche proposée, en attente de validation." : "Modification proposée. L'ancienne version reste en vigueur jusqu'à la validation.",
    });
    return;
  }
  const n = r?.shifted?.length ?? 0;
  const ms = (r?.milestones_threatened?.length ?? 0) > 0;
  notifications.show({
    color: ms ? "crit" : "ok",
    message: `${created ? "Tâche créée" : "Tâche enregistrée"}${n ? `, ${n} tâche${n > 1 ? "s suivent" : " suit"} en cascade` : ""}${ms ? ". Un jalon est menacé." : "."}`,
  });
}

function TaskForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial: Draft; submitLabel: string; onSubmit: (d: Draft) => Promise<void>; onCancel: () => void;
}) {
  const users = useUsers();
  const settings = useSettings();
  const [d, setD] = useState<Draft>(initial);
  const [total, setTotal] = useState<number | "">("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => { setD({ ...d, ...patch }); setErr(null); };
  const nameOf = (id: string) => users.data?.find((u) => u.id === id)?.name ?? "?";
  const leads = d.assignments.filter((a) => a.role === "lead").length;
  const hours = d.assignments.reduce((n, a) => n + a.planned_hours, 0);
  const others = (users.data ?? []).filter((u) => !d.assignments.some((a) => a.user_id === u.id));
  const setAssign = (i: number, patch: Partial<Draft["assignments"][number]>) =>
    set({ assignments: d.assignments.map((a, k) => (k === i ? { ...a, ...patch } : a)) });
  // Un seul pilote : en choisir un passe les autres en appui.
  const makeLead = (i: number) => set({ assignments: d.assignments.map((a, k) => ({ ...a, role: k === i ? "lead" : "support" })) });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const end = d.milestone ? d.start_date : d.end_date;
    const problem = !d.title.trim() ? "Donne un titre à la tâche."
      : !d.start_date || !end ? "Choisis les dates."
      : end < d.start_date ? "La date de fin doit être après la date de début."
      : leads === 0 ? "Choisis un pilote parmi les collaborateurs."
      : leads > 1 ? "Un seul pilote : passe les autres en appui." : null;
    if (problem) { setErr(problem); return; }
    setBusy(true);
    try {
      await onSubmit({ ...d, title: d.title.trim(), end_date: end });
    } catch (x) {
      const m = String(x);
      setErr(m.includes("members-cannot-propose") ? "Les réglages ne permettent pas aux membres de proposer des tâches."
        : m.includes("need-exactly-one-lead") ? "Il faut exactement un pilote."
        : "Enregistrement refusé. Vérifie les champs et réessaie.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
      <TextInput label="Titre" value={d.title} onChange={(e) => set({ title: e.target.value })} data-autofocus maxLength={200} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, alignItems: "end" }}>
        <Select label="Axe" value={d.axis_code} allowDeselect={false} onChange={(v) => v && set({ axis_code: v })}
          data={Object.entries(AXES).map(([value, a]) => ({ value, label: a.label }))} />
        <TextInput label={d.milestone ? "Date du jalon" : "Début"} type="date" value={d.start_date} onChange={(e) => set({ start_date: e.target.value })} />
        {!d.milestone && <TextInput label="Fin" type="date" value={d.end_date} onChange={(e) => set({ end_date: e.target.value })} />}
      </div>
      <Checkbox label="Jalon : une date unique, qui ne bouge jamais seule" checked={d.milestone} onChange={(e) => set({ milestone: e.currentTarget.checked })} />
      <Textarea label="Description" autosize minRows={3} maxRows={12} maxLength={10000} value={d.description}
        placeholder="Contexte, liens utiles, consignes" onChange={(e) => set({ description: e.target.value })} />
      <TextInput label="Terminé quand" value={d.done_criteria} maxLength={2000}
        placeholder="Le casier s'ouvre avec le QR code" onChange={(e) => set({ done_criteria: e.target.value })} />

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
        <legend style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>
          Collaborateurs <span style={{ color: muted, fontWeight: 400 }}>({fmtH(hours)} prévues au total)</span>
        </legend>
        {d.assignments.map((a, i) => (
          <div key={a.user_id} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto 104px 36px", gap: 10, alignItems: "center", padding: "6px 0", borderTop: `1px solid ${line}` }}>
            <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 600, background: a.role === "lead" ? "var(--accent-soft)" : "var(--sunken-2)", color: a.role === "lead" ? "var(--accent-text)" : "var(--text-1)" }}>
              {initials(nameOf(a.user_id))}
            </span>
            <span style={{ fontWeight: 500, fontSize: 14, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{nameOf(a.user_id)}</span>
            <SegmentedControl size="xs" value={a.role} aria-label={`Rôle de ${nameOf(a.user_id)}`}
              onChange={(v) => (v === "lead" ? makeLead(i) : setAssign(i, { role: "support" }))}
              data={[{ value: "lead", label: "Pilote" }, { value: "support", label: "Appui" }]} />
            <NumberInput aria-label={`Heures de ${nameOf(a.user_id)}`} min={0} max={200} step={0.25} decimalSeparator="," suffix=" h"
              value={a.planned_hours} onChange={(v) => setAssign(i, { planned_hours: typeof v === "number" ? v : 0 })} />
            <Button variant="subtle" color="gray" px={8} aria-label={`Retirer ${nameOf(a.user_id)}`}
              onClick={() => set({ assignments: d.assignments.filter((_, k) => k !== i) })}>
              <IconTrash size={16} stroke={1.6} />
            </Button>
          </div>
        ))}
        <Select placeholder="Ajouter un collaborateur" searchable value={null} searchValue={search} onSearchChange={setSearch}
          leftSection={<IconPlus size={16} stroke={1.6} />}
          data={others.map((u) => ({ value: u.id, label: u.name }))} nothingFoundMessage="Tout le monde est déjà là"
          onChange={(v) => {
            if (!v) return;
            set({ assignments: [...d.assignments, { user_id: v, role: d.assignments.length === 0 ? "lead" : "support", planned_hours: 1 }] });
            setSearch("");
          }} />
        {settings.data?.hours_mode === "equal_split" && d.assignments.length > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <NumberInput label="Total à répartir à parts égales" min={0} step={0.5} decimalSeparator="," suffix=" h" w={240}
              value={total} onChange={(v) => setTotal(typeof v === "number" ? v : "")} />
            <Button variant="default" disabled={total === ""} onClick={() => {
              const each = Math.round((Number(total) / d.assignments.length) * 10) / 10;
              set({ assignments: d.assignments.map((a) => ({ ...a, planned_hours: each })) });
            }}>Répartir</Button>
          </div>
        )}
      </fieldset>

      {err && <p role="alert" style={{ margin: 0, color: "var(--crit-text)", fontSize: 14 }}>{err}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <Button variant="default" onClick={onCancel}>Annuler</Button>
        <Button type="submit" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}

/** Création : publiée directement côté pilote ; côté membre, selon les réglages F11. */
export function NewTaskSheet({ opened, onClose, role }: { opened: boolean; onClose: () => void; role: string }) {
  const qc = useQueryClient();
  const me = useMe();
  const validation = useSettings().data?.validation_enabled ?? true;
  const today = new Date().toLocaleDateString("sv-SE");
  const initial: Draft = {
    title: "", axis_code: "HARD", start_date: today, end_date: today, milestone: false, description: "", done_criteria: "",
    assignments: me.data ? [{ user_id: me.data.id, role: "lead", planned_hours: 2 }] : [],
  };
  return (
    <Sheet opened={opened} onClose={onClose} title="Nouvelle tâche">
      {role !== "pilot" && validation && <p style={{ margin: "0 0 12px", color: muted, fontSize: 13 }}>Ta tâche sera visible des collaborateurs une fois validée par le chef de projet.</p>}
      {opened && (
        <TaskForm initial={initial} submitLabel="Créer la tâche" onCancel={onClose} onSubmit={async (d) => {
          const r = await api<{ status?: string }>("/api/tasks", { method: "POST", body: JSON.stringify(d) });
          announce(r, true);
          refreshAll(qc);
          onClose();
        }} />
      )}
    </Sheet>
  );
}

/** Fiche : lecture, changement de statut, modification, dépendances, discussion. */
export function TaskDetailSheet({ id, onClose, role, nameOf }: {
  id: string; onClose: () => void; role: string; nameOf: (id: string) => string;
}) {
  const qc = useQueryClient();
  const me = useMe();
  const settings = useSettings();
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const [pred, setPred] = useState<string | null>(null);
  const task = useQuery({ queryKey: ["task", id], queryFn: () => api<Task>(`/api/tasks/${id}`) });
  const comments = useQuery({
    queryKey: ["comments", id],
    queryFn: () => api<{ author: string; body: string; at: string }[]>(`/api/tasks/${id}/comments`),
  });
  const all = useQuery({ queryKey: ["tasks"], queryFn: () => api<Task[]>("/api/tasks") });
  const t = task.data;
  const lead = t?.assignments.find((a) => a.role === "lead");
  const canEdit = role === "pilot" || (settings.data?.members_can_propose ?? true);
  const canStatus = role === "pilot" || (!!lead && lead.user_id === me.data?.id);
  const late = !!t && !t.milestone && t.status !== "done" && t.end_date < new Date().toLocaleDateString("sv-SE");

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
      setPred(null);
      refreshAll(qc, id);
    } catch {
      notifications.show({ message: "Dépendance refusée : elle créerait une boucle ou existe déjà.", color: "crit" });
    }
  };
  const delDep = async (pred_id: string) => {
    await api("/api/dependencies", { method: "DELETE", body: JSON.stringify({ pred_id, succ_id: id }) });
    refreshAll(qc, id);
  };
  const setStatus = async (status: string, undoable = true) => {
    if (!t || status === t.status) return;
    const before = t.status;
    await qc.cancelQueries({ queryKey: ["task", id] });
    const prev = qc.getQueryData<Task>(["task", id]);
    qc.setQueryData<Task>(["task", id], (x) => x && { ...x, status });
    try {
      await api(`/api/tasks/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
      refreshAll(qc, id);
      if (t.milestone && undoable) toastUndo(status === "done" ? "Jalon marqué atteint" : "Jalon rouvert", () => setStatus(before, false));
    } catch {
      qc.setQueryData(["task", id], prev);
      notifications.show({ message: "Statut non enregistré. Réessaie.", color: "crit" });
    }
  };

  return (
    <Sheet opened onClose={onClose} title={editing ? "Modifier la tâche" : t?.title ?? "Tâche"}>
      {!t ? <p style={{ color: muted }}>Chargement de la tâche…</p> : editing ? (
        <TaskForm
          initial={{
            title: t.title, axis_code: t.axis_code, start_date: t.start_date, end_date: t.end_date, milestone: t.milestone,
            description: t.description ?? "", done_criteria: t.done_criteria ?? "",
            assignments: t.assignments.map((a) => ({ user_id: a.user_id, role: a.role, planned_hours: a.planned_hours })),
          }}
          submitLabel={role === "pilot" || !(settings.data?.validation_enabled && settings.data?.revalidate_on_edit) ? "Enregistrer" : "Proposer la modification"}
          onCancel={() => setEditing(false)}
          onSubmit={async (d) => {
            const r = await api<{ status?: string; shifted?: string[]; milestones_threatened?: string[] }>(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify(d) });
            announce(r, false);
            refreshAll(qc, id);
            setEditing(false);
          }}
        />
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <AxisChip code={t.axis_code} />
            <span className="num" style={{ fontSize: 13, color: muted }}>
              {t.milestone ? `Jalon le ${fmtDate(t.start_date)}` : `${fmtDate(t.start_date)} → ${fmtDate(t.end_date)}`}
            </span>
            {late && <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--crit-text)" }}>En retard</span>}
            {canEdit && (
              <Button variant="default" size="xs" ml="auto" leftSection={<IconPencil size={14} stroke={1.6} />} onClick={() => setEditing(true)}>
                Modifier
              </Button>
            )}
          </div>

          {t.milestone ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: t.status === "done" ? "var(--ok-text)" : muted }}>
                {t.status === "done" ? "Jalon atteint" : "Jalon à venir"}
              </span>
              {canStatus && (
                <Button size="xs" ml="auto" variant={t.status === "done" ? "default" : "filled"}
                  leftSection={t.status === "done" ? <IconArrowBackUp size={14} stroke={1.6} /> : <IconCheck size={14} stroke={1.6} />}
                  onClick={() => setStatus(t.status === "done" ? "todo" : "done")}>
                  {t.status === "done" ? "Rouvrir le jalon" : "Marquer le jalon atteint"}
                </Button>
              )}
            </div>
          ) : canStatus ? (
            <SegmentedControl fullWidth value={t.status} onChange={(v) => setStatus(v)} data={STATUSES} aria-label="Statut de la tâche" />
          ) : <div><StatusPill status={t.status} /></div>}

          <section aria-label="Description">
            {t.description
              ? <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{t.description}</p>
              : <p style={{ margin: 0, fontSize: 14, color: muted }}>Pas de description.{canEdit ? " Ajoute le contexte avec « Modifier »." : ""}</p>}
            {t.done_criteria && (
              <p style={{ margin: "10px 0 0", fontSize: 14, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--sunken)" }}>
                <strong style={{ fontWeight: 600 }}>Terminé quand : </strong><span style={{ overflowWrap: "anywhere" }}>{t.done_criteria}</span>
              </p>
            )}
          </section>

          <section aria-labelledby="collab-titre">
            <h3 id="collab-titre" style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600 }}>Collaborateurs</h3>
            {t.assignments.map((a) => (
              <div key={a.user_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
                <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 10.5, fontWeight: 600, background: a.role === "lead" ? "var(--accent-soft)" : "var(--sunken-2)", color: a.role === "lead" ? "var(--accent-text)" : "var(--text-1)" }}>
                  {initials(nameOf(a.user_id))}
                </span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{nameOf(a.user_id)}</span>
                <span style={{ fontSize: 13, color: muted }}>{a.role === "lead" ? "pilote" : "appui"}</span>
                <span className="num" style={{ marginLeft: "auto", fontSize: 13, color: muted }}>{fmtH(a.planned_hours)}</span>
              </div>
            ))}
            {t.assignments.length === 0 && <p style={{ margin: 0, color: muted, fontSize: 14 }}>Personne n'est assigné.</p>}
          </section>

          {!t.milestone && <TaskHours id={id} onSaved={() => { qc.invalidateQueries({ queryKey: ["task-hours", id] }); refreshAll(qc, id); }} />}

          <section aria-labelledby="deps-titre">
            <h3 id="deps-titre" style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600 }}>Dépend de</h3>
            {(t.depends_on ?? []).map((dd) => (
              <div key={dd.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                <span style={{ flex: 1, fontSize: 14 }}>{dd.title}</span>
                {role === "pilot" && <Button variant="subtle" color="crit" size="xs" onClick={() => delDep(dd.id)}>Retirer</Button>}
              </div>
            ))}
            {(t.depends_on ?? []).length === 0 && <p style={{ margin: 0, color: muted, fontSize: 14 }}>Aucune dépendance.</p>}
            {role === "pilot" && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <Select placeholder="Tâche précédente" value={pred} onChange={setPred} searchable style={{ flex: 1 }}
                  data={(all.data ?? []).filter((x) => x.id !== id && !(t.depends_on ?? []).some((dd) => dd.id === x.id)).map((x) => ({ value: x.id, label: x.title }))} />
                <Button variant="default" onClick={addDep}>Lier</Button>
              </div>
            )}
          </section>

          <section aria-labelledby="discussion-titre">
            <h3 id="discussion-titre" style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600 }}>Discussion ({(comments.data ?? []).length})</h3>
            {(comments.data ?? []).map((c, i) => (
              <div key={i} style={{ padding: "8px 0", borderTop: `1px solid ${line}` }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{c.author}</span>
                <span style={{ fontSize: 12, color: muted }}>, {new Date(c.at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
                <p style={{ margin: "2px 0 0", fontSize: 14, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{c.body}</p>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Textarea placeholder="Écrire un commentaire" value={comment} autosize minRows={1} maxRows={6}
                onChange={(e) => setComment(e.target.value)} style={{ flex: 1 }} />
              <Button onClick={post}>Envoyer</Button>
            </div>
          </section>
        </div>
      )}
    </Sheet>
  );
}
