import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, useMe } from "./api";
import { Shell, type View } from "./Shell";
import { C, F_TITRE, btnPrimary, card, field } from "./theme";
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
      {v === "gantt" && <Gantt />}
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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.fond, padding: 16 }}>
      <div style={{ width: 420, maxWidth: "100%" }}>
        <h1 style={{ fontFamily: F_TITRE, fontWeight: 700, fontSize: 28 }}>Suivi projet</h1>
        <p style={{ color: C.discret }}>Projet : LENDRR</p>
        <div style={{ ...card, padding: "22px 24px" }}>
          <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
            {mode === "setup" && (
              <>
                <input style={field} placeholder="Code setup (SETUP_CODE)" value={f.code} onChange={set("code")} />
                <input style={field} placeholder="Nom" value={f.name} onChange={set("name")} />
              </>
            )}
            <input style={field} placeholder="E-mail" value={f.email} onChange={set("email")} autoComplete="email" />
            <input style={field} placeholder="Mot de passe" type="password" value={f.password} onChange={set("password")} autoComplete="current-password" />
            {err && <p style={{ color: C.crit }}>{err}</p>}
            <button style={btnPrimary} type="submit">{mode === "login" ? "Se connecter" : "Créer le compte pilote"}</button>
          </form>
        </div>
        <button style={{ ...btnPrimary, background: C.encre, width: "100%", marginTop: 12 }} onClick={() => setMode(mode === "login" ? "setup" : "login")}>
          {mode === "login" ? "Premier lancement ? Créer le compte" : "J'ai déjà un compte"}
        </button>
      </div>
    </div>
  );
}
