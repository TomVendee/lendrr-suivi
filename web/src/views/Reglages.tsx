/** Écran Reglages : reprend la maquette docs/maquettes (structure + jetons), données live. */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, NumberInput, PasswordInput, Select, TextInput, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { api, type User } from "../api";
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
      <PageHead title="Réglages" sub="Projet LENDRR · seul le chef de projet voit cet écran" />

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
          {u.overrides.map((o) => `S${o.week} = ${o.hours} h`).join(" · ")}
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
