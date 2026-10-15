/** Squelettes à la forme réelle de chaque écran : le contenu arrive sans que la page saute. */
import { Skeleton } from "@mantine/core";

const grid = (min: number) => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12 });
const tile = { borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", background: "var(--surface-1)", padding: 18, display: "grid", gap: 10 };

function Head() {
  return (
    <div style={{ display: "grid", gap: 8 }} aria-hidden="true">
      <Skeleton height={26} width={220} radius="sm" />
      <Skeleton height={14} width={160} radius="sm" />
    </div>
  );
}

function Kpis({ n = 4 }: { n?: number }) {
  return (
    <div style={grid(190)}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={tile}><Skeleton height={12} width="45%" /><Skeleton height={28} width="60%" /><Skeleton height={6} /></div>
      ))}
    </div>
  );
}

/** kind : météo (indicateurs + cartes d'axe), table (indicateurs + grille), liste (cartes), frise (Gantt). */
export function PageSkeleton({ kind }: { kind: "meteo" | "table" | "liste" | "frise" }) {
  return (
    <div style={{ display: "grid", gap: 20 }} role="status" aria-label="Chargement">
      <Head />
      {(kind === "meteo" || kind === "table") && <Kpis />}
      {kind === "meteo" && (
        <div style={grid(280)}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} style={tile}><Skeleton height={16} width="30%" /><Skeleton height={6} /><Skeleton height={12} width="70%" /><Skeleton height={12} width="50%" /></div>
          ))}
        </div>
      )}
      {kind === "table" && (
        <div style={{ ...tile, gap: 8 }}>
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={36} />)}
        </div>
      )}
      {kind === "liste" && (
        <>
          <Skeleton height={84} radius="lg" />
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} style={tile}><Skeleton height={14} width={70} /><Skeleton height={18} width="55%" /><Skeleton height={12} width="35%" /><Skeleton height={40} /></div>
          ))}
        </>
      )}
      {kind === "frise" && (
        <div style={{ ...tile, gap: 10 }}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 16, alignItems: "center" }}>
              <Skeleton height={12} />
              <Skeleton height={14} width={`${30 + ((i * 37) % 50)}%`} ml={`${(i * 13) % 40}%`} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
