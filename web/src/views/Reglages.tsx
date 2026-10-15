/** Écran Reglages : reprend la maquette docs/maquettes (structure + jetons), données live. */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, NumberInput, PasswordInput, Radio, Select, Switch, TextInput, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { api, useSettings, type Settings, type User } from "../api";
import { C, F_MONO, F_TITRE, PageHead, card, line, muted } from "../theme";

export function Reglages() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState("");
  const [nu, setNu] = useState({ name: "", email: "", password: "", role: "member" });
  const [importTxt, setImportTxt] = useState("");
  const [report, setReport] = useState("");

  const users = useQuery({ queryKey: ["users"], queryFn: () => api<User[]>("/api/users") });

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg("");
    try {
      await fn();
      if (ok) {
        setMsg(ok);
        notifications.show({ message: ok, color: "ok" });
      }
      qc.invalidateQueries();
    } catch (e) {
      const m = `Échec : ${String(e)}`;
      setMsg(m);
      notifications.show({ message: m, color: "crit" });
    }
  };

  return (
    <>
      <PageHead title="Réglages" sub="Seul le chef de projet voit cet écran." />

      <ReglagesProjet users={users.data ?? []} />

      <section aria-labelledby="membres-titre" style={{ ...card, padding: "8px 24px 16px" }}>
        <h2 id="membres-titre" style={{ margin: "14px 0 4px", fontFamily: F_TITRE, fontSize: 20, fontWeight: 600 }}>Membres de l'équipe</h2>
        {(users.data ?? []).map((u) => (
          <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${line}` }}>
            <span style={{ fontWeight: 600, flex: 1 }}>{u.name}</span>
            <span style={{ fontSize: 13, color: muted }}>{u.email}</span>
            <span style={{ fontSize: 13, color: muted }}>{u.role === "pilot" ? "Pilote" : "Membre"}</span>
          </div>
        ))}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, paddingTop: 16 }}>
          <TextInput label="Nom" placeholder="Ex. : Reda" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
          <TextInput label="E-mail" placeholder="reda@example.com" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />
          <PasswordInput label="Mot de passe (10 caractères min)" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
          <Select label="Rôle" value={nu.role} onChange={(v) => setNu({ ...nu, role: v ?? "member" })}
            data={[{ value: "member", label: "Membre" }, { value: "pilot", label: "Pilote" }]} />
        </div>
        <div style={{ paddingTop: 12 }}>
          <Button variant="default" onClick={() => act(
            () => api("/api/users", { method: "POST", body: JSON.stringify({ name: nu.name, email: nu.email, password: nu.password, role: nu.role }) }).then(() => setNu({ name: "", email: "", password: "", role: "member" })),
            "Compte créé."
          )}>Créer le compte</Button>
        </div>
      </section>

      <section aria-labelledby="import-titre" style={{ ...card, padding: "8px 24px 16px" }}>
        <h2 id="import-titre" style={{ margin: "14px 0 4px", fontFamily: F_TITRE, fontSize: 20, fontWeight: 600 }}>Import depuis Asana</h2>
        <p style={{ color: muted, fontSize: 14 }}>Colle le JSON produit par Cowork (format <code style={{ fontFamily: F_MONO }}>docs/import-format.md</code>). Rejouable sans doublons.</p>
        <Textarea rows={4} value={importTxt} onChange={(e) => setImportTxt(e.target.value)} placeholder='{"tasks": [...]}'
          styles={{ input: { fontFamily: F_MONO, fontSize: 13 } }} />
        <div style={{ paddingTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Button variant="default" onClick={() => act(async () => {
            const r = await api<{ created: number; updated: number; skipped: number; errors: { key: string; reason: string }[] }>("/api/import", {
              method: "POST", body: importTxt,
            });
            setReport(`${r.created} créée(s), ${r.updated} mise(s) à jour, ${r.skipped} ignorée(s), ${r.errors.length} en erreur${r.errors.length ? " : " + r.errors.map((e) => `${e.key} (${e.reason})`).join(", ") : ""}.`);
          }, "Import terminé.")}>Importer</Button>
          {report && <span role="status" style={{ fontSize: 14 }}>{report}</span>}
        </div>
      </section>

      <section aria-labelledby="save-titre" style={{ ...card, padding: "8px 24px 16px" }}>
        <h2 id="save-titre" style={{ margin: "14px 0 4px", fontFamily: F_TITRE, fontSize: 20, fontWeight: 600 }}>Sauvegardes</h2>
        <p style={{ color: muted, fontSize: 14 }}>La photo du lundi fige le « prévu » de la semaine. L'export complet est stocké en base (pas de S3 en V1).</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Button variant="default" onClick={() => act(() => api("/api/baselines", { method: "POST" }), "Baseline figée.")}>Figer la baseline</Button>
          <Button variant="default" onClick={() => act(async () => {
            // Téléchargement authentifié (le cookie suit) : la synthèse reste privée.
            const r = await fetch("/api/export");
            if (!r.ok) throw new Error(await r.text());
            const blob = await r.blob();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "suivi-export.json";
            a.click();
            URL.revokeObjectURL(a.href);
          }, "Export téléchargé.")}>Télécharger l'export</Button>
        </div>
      </section>

      <Capacites users={users.data ?? []} />

      <section aria-labelledby="ia-titre" style={{ ...card, padding: "8px 24px 16px" }}>
        <h2 id="ia-titre" style={{ margin: "14px 0 4px", fontFamily: F_TITRE, fontSize: 20, fontWeight: 600 }}>Accès IA</h2>
        <p style={{ color: muted, fontSize: 14 }}>Token personnel pour Claude / Cowork via <code style={{ fontFamily: F_MONO }}>POST /mcp</code>. Affiché une seule fois.</p>
        <Button variant="default" onClick={() => act(async () => {
          const r = await api<{ token: string }>("/api/tokens", { method: "POST" });
          setMsg(`Token à copier maintenant : ${r.token}`);
        }, "")}>Créer un token</Button>
      </section>

      {msg && <p role="status" style={{ ...card, background: C.warnFond, wordBreak: "break-all" }}>{msg}</p>}
    </>
  );
}

/** Capacités et absences : 4 h par défaut, 0 h = absence (compte dans la charge). */
function Capacites({ users }: { users: User[] }) {
  const qc = useQueryClient();
  const [who, setWho] = useState<string | null>(null);
  const [week, setWeek] = useState<number | "">(8);
  const [hours, setHours] = useState<number | "">(4);
  const caps = useQuery({
    queryKey: ["capacities"],
    queryFn: () => api<{ user_id: string; name: string; default: number; overrides: { week: number; hours: number }[] }[]>("/api/capacities"),
  });
  const save = async () => {
    if (!who || week === "" || hours === "") {
      notifications.show({ message: "Personne, semaine et heures requis.", color: "warn" });
      return;
    }
    await api("/api/capacities", { method: "PUT", body: JSON.stringify({ user_id: who, week, hours }) });
    notifications.show({ message: "Capacité enregistrée.", color: "ok" });
    qc.invalidateQueries({ queryKey: ["capacities"] });
    qc.invalidateQueries({ queryKey: ["load"] });
  };
  return (
    <section aria-labelledby="capa-titre" style={{ ...card, padding: "8px 24px 16px" }}>
      <h2 id="capa-titre" style={{ margin: "14px 0 4px", fontFamily: F_TITRE, fontSize: 20, fontWeight: 600 }}>Capacités et absences</h2>
      {(caps.data ?? []).filter((u) => u.overrides.length > 0).map((u) => (
        <div key={u.user_id} style={{ fontSize: 14, padding: "4px 0" }}>
          <strong>{u.name}</strong> (défaut {u.default} h) :{" "}
          {u.overrides.map((o) => `S${o.week} = ${o.hours} h`).join(", ")}
        </div>
      ))}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, paddingTop: 12 }}>
        <Select label="Personne" value={who} onChange={setWho} searchable
          data={users.map((u) => ({ value: u.id, label: u.name }))} />
        <NumberInput label="Semaine" min={1} max={52} value={week} onChange={(v) => setWeek(typeof v === "number" ? v : "")} />
        <NumberInput label="Heures (0 = absence)" min={0} max={80} step={0.5} decimalSeparator=","
          value={hours} onChange={(v) => setHours(typeof v === "number" ? v : "")} />
      </div>
      <div style={{ paddingTop: 12 }}>
        <Button variant="default" onClick={save}>Enregistrer</Button>
      </div>
    </section>
  );
}

const h2 = { margin: "14px 0 4px", fontFamily: F_TITRE, fontSize: 20, fontWeight: 600 } as const;

/** Une ligne « libellé + explication » avec son interrupteur, comme la maquette. */
function Ligne({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 0", borderBottom: `1px solid ${line}` }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 13, color: muted }}>{desc}</div>
      </div>
      <Switch aria-label={label} checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
    </div>
  );
}

/** Validation des tâches, collaborateurs et seuils d'alerte (maquette Reglages.dc.html). */
function ReglagesProjet({ users }: { users: User[] }) {
  const qc = useQueryClient();
  const settings = useSettings();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<boolean | null>(null);
  const s = draft ?? settings.data;
  if (!s) return null;
  const set = (patch: Partial<Settings>) => {
    setDraft({ ...s, ...patch });
    setSaved(false);
  };
  const pilot = users.find((u) => u.role === "pilot")?.name ?? "le chef de projet";
  const validator = s.validator_id ? users.find((u) => u.id === s.validator_id)?.name ?? "?" : pilot;
  const others = users.filter((u) => u.role !== "pilot").map((u) => ({ value: u.id, label: u.name }));

  const phrases: string[] = [];
  if (s.validation_enabled) {
    phrases.push(s.members_can_propose
      ? `Les membres proposent des tâches, ${validator} les valide avant qu'elles apparaissent chez les collaborateurs.`
      : `Seul ${pilot} crée les tâches, qui sont publiées dès leur création.`);
    if (s.members_can_propose && s.revalidate_on_edit) phrases.push("Toute modification d'un membre repasse par la validation.");
  } else {
    phrases.push(s.members_can_propose
      ? "Les tâches créées par n'importe quel membre sont visibles immédiatement."
      : `Seul ${pilot} crée les tâches, visibles immédiatement.`);
  }
  phrases.push(s.hours_mode === "equal_split"
    ? "Les heures prévues se saisissent en un total réparti à parts égales."
    : "Les heures prévues se saisissent pour chaque collaborateur.");

  const save = async () => {
    try {
      const { validation_enabled, revalidate_on_edit, members_can_propose, validator_id, deputy_id, reminder_days,
        hours_mode, overrun_pct, overrun_hours, blocking_days } = s;
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ validation_enabled, revalidate_on_edit,
        members_can_propose, validator_id, deputy_id, reminder_days, hours_mode, overrun_pct, overrun_hours, blocking_days }) });
      setSaved(true);
      setDraft(null);
      notifications.show({ message: "Réglages enregistrés.", color: "ok" });
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
    } catch (e) {
      notifications.show({ message: `Échec : ${String(e)}`, color: "crit" });
    }
  };

  return (
    <>
      <section aria-labelledby="validation-titre" style={{ ...card, padding: "8px 24px 16px" }}>
        <h2 id="validation-titre" style={h2}>Validation des tâches</h2>
        <Ligne label="Validation obligatoire par le chef de projet"
          desc="Une tâche créée ou proposée n'apparaît chez ses collaborateurs (Ma semaine, plan de charge, alertes) qu'après validation."
          checked={s.validation_enabled} onChange={(v) => set({ validation_enabled: v })} />
        {s.validation_enabled && (
          <>
            <Ligne label="Revalider après une modification"
              desc="Si un membre modifie une tâche, elle repasse en attente. L'ancienne version reste affichée jusqu'à la validation."
              checked={s.revalidate_on_edit} onChange={(v) => set({ revalidate_on_edit: v })} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, padding: "12px 0" }}>
              <Select label="Validateur" value={s.validator_id ?? "pilot"} allowDeselect={false}
                data={[{ value: "pilot", label: `${pilot} (chef de projet)` }, ...others]}
                onChange={(v) => set({ validator_id: v === "pilot" ? null : v })} />
              <Select label="Suppléant en cas d'absence" value={s.deputy_id ?? "none"} allowDeselect={false}
                data={[{ value: "none", label: "Aucun" }, ...others]}
                onChange={(v) => set({ deputy_id: v === "none" ? null : v })} />
              <Select label="Me rappeler une tâche en attente après" value={String(s.reminder_days ?? "never")} allowDeselect={false}
                data={[{ value: "1", label: "1 jour" }, { value: "2", label: "2 jours" }, { value: "3", label: "3 jours" }, { value: "never", label: "Jamais" }]}
                onChange={(v) => set({ reminder_days: v === "never" || !v ? null : Number(v) })} />
            </div>
          </>
        )}
        <Radio.Group label="Qui peut créer ou proposer une tâche ?" value={s.members_can_propose ? "all" : "pilot"}
          onChange={(v) => set({ members_can_propose: v === "all" })} style={{ padding: "12px 0" }}>
          <Radio value="all" mt={8} label="Tout le monde" description="Les membres proposent, le chef de projet valide." />
          <Radio value="pilot" mt={8} label="Chef de projet seulement" description="Les membres saisissent seulement leurs heures et leur statut." />
        </Radio.Group>
      </section>

      <section aria-labelledby="assign-titre" style={{ ...card, padding: "8px 24px 16px" }}>
        <h2 id="assign-titre" style={h2}>Collaborateurs par tâche</h2>
        <p style={{ color: muted, fontSize: 14 }}>
          Plusieurs collaborateurs par tâche, chacun avec ses heures prévues. Un pilote obligatoire, les autres en appui :
          une tâche sans pilote ne peut pas être validée.
        </p>
        <Radio.Group label="Heures prévues" value={s.hours_mode} onChange={(v) => set({ hours_mode: v as Settings["hours_mode"] })}>
          <Radio value="per_person" mt={8} label="Saisies pour chaque collaborateur" description="Par exemple Reda 2 h, Tom G. 1 h, Erwen 0,5 h." />
          <Radio value="equal_split" mt={8} label="Un total réparti à parts égales" description="Par exemple 3,5 h pour 3 personnes, soit 1,2 h chacune." />
        </Radio.Group>
      </section>

      <section aria-labelledby="seuils-titre" style={{ ...card, padding: "8px 24px 16px" }}>
        <h2 id="seuils-titre" style={h2}>Seuils d'alerte</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, paddingTop: 8 }}>
          <NumberInput label="Dépassement réel au-delà de (%)" min={0} max={200} step={5} suffix=" %"
            value={Math.round(s.overrun_pct * 100)} onChange={(v) => typeof v === "number" && set({ overrun_pct: v / 100 })} />
          <NumberInput label="… ou au-delà de (heures)" min={0} max={20} step={0.5} decimalSeparator="," suffix=" h"
            value={s.overrun_hours} onChange={(v) => typeof v === "number" && set({ overrun_hours: v })} />
          <NumberInput label="Retard bloquant si un successeur commence dans moins de (jours)" min={1} max={30}
            value={s.blocking_days} onChange={(v) => typeof v === "number" && set({ blocking_days: v })} />
        </div>
      </section>

      <section aria-label="Effet des réglages" className="inverse" style={{ background: "var(--surface-2)", color: "var(--text-1)", borderRadius: 12, padding: "18px 24px", marginBottom: 16, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: C.navMuted }}>Avec ces réglages</div>
        <div style={{ fontSize: 14 }}>{phrases.join(" ")}</div>
      </section>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <Button onClick={save}>Enregistrer les réglages</Button>
        <span role="status" style={{ fontSize: 14, color: muted }}>
          {saved === true ? "Réglages enregistrés." : saved === false ? "Modifications non enregistrées." : ""}
        </span>
      </div>
    </>
  );
}
