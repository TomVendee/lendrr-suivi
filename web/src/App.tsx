/** Racine : login/setup puis Shell + vues, choisies par l'URL (Météo par défaut côté pilote, Ma semaine côté membre). */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, PasswordInput, TextInput } from "@mantine/core";
import { api, useMe } from "./api";
import { Shell } from "./Shell";
import { navigate, useRoute, type View } from "./router";
import { muted } from "./theme";
import { LockerMark } from "./nav";
import "./styles/login.css";
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
  const route = useRoute();
  const fallback: View | null = me.data ? (me.data.role === "pilot" ? "meteo" : "semaine") : null;
  // Adresse vide ou inconnue : écran par défaut du rôle, sans entrée d'historique en plus.
  useEffect(() => {
    if (fallback && !route.view) navigate(`/${fallback}`, { replace: true });
  }, [fallback, route.view]);

  // Rien tant que la session n'a jamais été vérifiée ; ensuite, pas de données = écran de connexion.
  // (Une nouvelle vérification remet la requête « en attente » : il ne faut pas démonter la saisie.)
  // Un 401 déconnecte (fin de session, déconnexion) ; une coupure réseau garde l'app affichée.
  if (!me.isFetched) return null;
  if (!me.data || me.error?.message === "unauthorized") return <Login />;
  const v: View = route.view ?? fallback!;
  const go = (to: View) => navigate(`/${to}`);

  return (
    <Shell me={me.data} view={v} setView={go}>
      {v === "meteo" && <Meteo goSynthese={() => go("synthese")} />}
      {v === "semaine" && <Semaine me={me.data} />}
      {v === "taches" && <Taches role={me.data.role} taskId={route.id} />}
      {v === "charge" && <Charge />}
      {v === "graphes" && <Graphes goCharge={() => go("charge")} />}
      {v === "gantt" && <Gantt role={me.data.role} taskId={route.id} />}
      {v === "alertes" && <Alertes goTaches={(id) => navigate(id ? `/taches/${id}` : "/taches")} />}
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
      setErr(mode === "login" ? "E-mail ou mot de passe incorrect." : "Création refusée : vérifie le code de premier lancement.");
    }
  };

  const setup = mode === "setup";
  return (
    <div className="login">
      <aside className="login-brand inverse" aria-hidden="true">
        <div className="login-locker">
          {Array.from({ length: 6 }, (_, k) => <span key={k} style={{ "--k": k } as React.CSSProperties} data-on={k === 3 || undefined} />)}
        </div>
        <p className="login-pitch">Le planning du casier connecté, au même endroit.</p>
        <p className="login-sub">Tâches, charge, alertes et chemin critique de l'équipe LENDRR.</p>
      </aside>
      <main className="login-main">
        <div className="login-card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <LockerMark size={30} />
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: "-0.02em" }}>Suivi projet</div>
              <div style={{ fontSize: 13, color: muted }}>LENDRR</div>
            </div>
          </div>
          <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 600, letterSpacing: "-0.025em" }}>{setup ? "Créer le compte du chef de projet" : "Connexion"}</h1>
          <p style={{ margin: "0 0 20px", color: muted }}>{setup ? "Premier lancement : le code vient de la configuration du serveur." : "Avec l'e-mail et le mot de passe donnés par le chef de projet."}</p>
          <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
            {setup && (
              <>
                <TextInput label="Code de premier lancement" value={f.code} onChange={set("code")} autoComplete="off" />
                <TextInput label="Nom" placeholder="Tom A." value={f.name} onChange={set("name")} autoComplete="name" />
              </>
            )}
            <TextInput label="E-mail" placeholder="prenom.nom@epita.fr" value={f.email} onChange={set("email")} autoComplete="email" type="email" />
            <PasswordInput label="Mot de passe" value={f.password} onChange={set("password")} autoComplete={setup ? "new-password" : "current-password"} />
            {err && <p role="alert" style={{ margin: 0, color: "var(--crit-text)", fontSize: 14 }}>{err}</p>}
            <Button type="submit" size="md" fullWidth mt={4}>{setup ? "Créer le compte" : "Se connecter"}</Button>
          </form>
          <Button variant="subtle" color="gray" fullWidth mt="sm" onClick={() => { setErr(""); setMode(setup ? "login" : "setup"); }}>
            {setup ? "J'ai déjà un compte" : "Premier lancement ? Créer le compte"}
          </Button>
        </div>
      </main>
    </div>
  );
}
