/** Racine : login/setup puis Shell + vues (Météo par défaut côté pilote, Ma semaine côté membre). */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Card, PasswordInput, TextInput, Title } from "@mantine/core";
import { api, useMe } from "./api";
import { Shell, type View } from "./Shell";
import { C, F_TITRE, muted } from "./theme";
import { Meteo } from "./views/Meteo";
import { Semaine } from "./views/Semaine";
import { Taches } from "./views/Taches";
import { Charge } from "./views/Charge";
import { Graphes } from "./views/Graphes";
import { Gantt } from "./views/Gantt";
import { Alertes, Synthese } from "./views/Alertes";
import { Reglages } from "./views/Reglages";

export function App() {
  const me = useMe();
  // Météo par défaut pour le pilote, Ma semaine pour les membres (cahier).
  const [view, setView] = useState<View | null>(null);

  if (me.isLoading) return <p style={{ padding: 24 }}>Chargement…</p>;
  if (me.isError || !me.data) return <Login />;
  const v: View = view ?? (me.data.role === "pilot" ? "meteo" : "semaine");

  return (
    <Shell me={me.data} view={v} setView={setView}>
      {v === "meteo" && <Meteo goSynthese={() => setView("synthese")} />}
      {v === "semaine" && <Semaine me={me.data} />}
      {v === "taches" && <Taches role={me.data.role} />}
      {v === "charge" && <Charge />}
      {v === "graphes" && <Graphes goCharge={() => setView("charge")} />}
      {v === "gantt" && <Gantt role={me.data.role} />}
      {v === "alertes" && <Alertes goTaches={() => setView("taches")} />}
      {v === "synthese" && <Synthese role={me.data.role} />}
      {v === "reglages" && (me.data.role === "pilot" ? <Reglages /> : <p>Réservé au pilote.</p>)}
    </Shell>
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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "light-dark(#F4F5F7, #101114)", padding: 16 }}>
      <div style={{ width: 420, maxWidth: "100%" }}>
        <Title order={1} style={{ fontFamily: F_TITRE, fontWeight: 700, fontSize: 28 }}>Suivi projet</Title>
        <p style={{ color: muted }}>Projet : LENDRR</p>
        <Card withBorder radius="lg" p="lg">
          <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
            {mode === "setup" && (
              <>
                <TextInput label="Code setup (SETUP_CODE)" placeholder="Code setup (SETUP_CODE)" value={f.code} onChange={set("code")} />
                <TextInput label="Nom" placeholder="Nom" value={f.name} onChange={set("name")} />
              </>
            )}
            <TextInput label="E-mail" placeholder="E-mail" value={f.email} onChange={set("email")} autoComplete="email" />
            <PasswordInput label="Mot de passe" placeholder="Mot de passe" value={f.password} onChange={set("password")} autoComplete="current-password" />
            {err && <p style={{ color: C.crit }}>{err}</p>}
            <Button type="submit" size="md" fullWidth>{mode === "login" ? "Se connecter" : "Créer le compte pilote"}</Button>
          </form>
        </Card>
        <Button variant="filled" color="dark" fullWidth mt="md" onClick={() => setMode(mode === "login" ? "setup" : "login")}>
          {mode === "login" ? "Premier lancement ? Créer le compte" : "J'ai déjà un compte"}
        </Button>
      </div>
    </div>
  );
}
