/** Accès IA : tokens personnels pour le MCP (`/mcp`), créés, listés et révoqués par chacun. */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CopyButton, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { api } from "./api";
import { F_MONO, line, muted } from "./theme";

interface Token { id: string; label: string; created_at: string }

const fmtCreated = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

export function TokenManager() {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null); // visible une seule fois
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: () => api<Token[]>("/api/tokens") });

  const create = async () => {
    try {
      const r = await api<{ token: string }>("/api/tokens", { method: "POST", body: JSON.stringify({ label }) });
      setFresh(r.token);
      setLabel("");
      qc.invalidateQueries({ queryKey: ["tokens"] });
    } catch (e) {
      notifications.show({ message: `Échec : ${String(e)}`, color: "crit" });
    }
  };
  const revoke = async (t: Token) => {
    if (!window.confirm(`Révoquer « ${t.label || "sans nom"} » ? Les outils qui l'utilisent cesseront de fonctionner.`)) return;
    try {
      await api(`/api/tokens/${t.id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["tokens"] });
      notifications.show({ message: "Token révoqué.", color: "ok" });
    } catch (e) {
      notifications.show({ message: `Échec : ${String(e)}`, color: "crit" });
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <p style={{ margin: 0, color: muted, fontSize: 14 }}>
        Un token donne à Claude ou Cowork les mêmes droits que vous, via <code style={{ fontFamily: F_MONO }}>/mcp</code>.
        Il n'est affiché qu'une fois : copiez-le dans la configuration de l'outil.
      </p>

      {fresh && (
        <div role="status" style={{ padding: 12, borderRadius: 8, border: `1px solid ${line}`, display: "grid", gap: 8 }}>
          <strong style={{ fontSize: 14 }}>Copiez ce token maintenant, il ne sera plus affiché.</strong>
          <code style={{ fontFamily: F_MONO, fontSize: 13, wordBreak: "break-all" }}>{fresh}</code>
          <div style={{ display: "flex", gap: 8 }}>
            <CopyButton value={fresh}>
              {({ copied, copy }) => <Button size="xs" onClick={copy}>{copied ? "Copié" : "Copier"}</Button>}
            </CopyButton>
            <Button size="xs" variant="default" onClick={() => setFresh(null)}>J'ai copié le token</Button>
          </div>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); create(); }} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <TextInput style={{ flex: 1 }} label="Nom du nouveau token" placeholder="Ex. : Claude Code" maxLength={60}
          value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button type="submit" variant="default">Créer</Button>
      </form>

      <div>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600 }}>Mes tokens actifs</h3>
        {tokens.data?.length === 0 && <p style={{ margin: 0, color: muted, fontSize: 14 }}>Aucun token actif.</p>}
        {(tokens.data ?? []).map((t) => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${line}` }}>
            <span style={{ flex: 1, fontWeight: 600 }}>{t.label || <span style={{ color: muted, fontWeight: 400 }}>sans nom</span>}</span>
            <span style={{ fontSize: 13, color: muted }}>créé le {fmtCreated(t.created_at)}</span>
            <Button size="xs" variant="default" color="red" onClick={() => revoke(t)}>Révoquer</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
