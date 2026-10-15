/** Écrans de l'app : libellé, icône, groupe et raccourci (« g » puis la touche). Source unique de la navigation. */
import {
  IconBell, IconCalendarWeek, IconChartBar, IconChartLine, IconChecklist, IconCloud,
  IconFileExport, IconSettings, IconTimeline, type Icon,
} from "@tabler/icons-react";
import type { View } from "./router";

export interface NavItem {
  id: View;
  label: string;
  short: string; // libellé court (barre du bas)
  icon: Icon;
  group: "travail" | "projet" | "outil";
  key: string; // raccourci : g puis key
  pilotOnly?: boolean;
}

export const NAV: NavItem[] = [
  { id: "semaine", label: "Ma semaine", short: "Semaine", icon: IconCalendarWeek, group: "travail", key: "s" },
  { id: "taches", label: "Tâches", short: "Tâches", icon: IconChecklist, group: "travail", key: "t" },
  { id: "meteo", label: "Météo", short: "Météo", icon: IconCloud, group: "projet", key: "m" },
  { id: "charge", label: "Plan de charge", short: "Charge", icon: IconChartBar, group: "projet", key: "c" },
  { id: "graphes", label: "Graphes", short: "Graphes", icon: IconChartLine, group: "projet", key: "r" },
  { id: "gantt", label: "Gantt", short: "Gantt", icon: IconTimeline, group: "projet", key: "p" },
  { id: "alertes", label: "Alertes", short: "Alertes", icon: IconBell, group: "projet", key: "a" },
  { id: "synthese", label: "Synthèse et export", short: "Synthèse", icon: IconFileExport, group: "projet", key: "e" },
  { id: "reglages", label: "Réglages", short: "Réglages", icon: IconSettings, group: "outil", key: "o", pilotOnly: true },
];

export const navFor = (role: string) => NAV.filter((n) => !n.pilotOnly || role === "pilot");

/** Logo : un casier à six compartiments, dont un allumé (le produit du projet). */
export function LockerMark({ size = 22 }: { size?: number }) {
  const cells = [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]];
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 22 22">
      <rect x="1" y="1" width="20" height="20" rx="5" fill="var(--text-1)" />
      {cells.map(([c, r], i) => (
        <rect key={i} x={5 + c * 6.5} y={4.5 + r * 4.6} width="5.5" height="3.6" rx="1"
          fill={i === 3 ? "var(--accent)" : "var(--bg)"} opacity={i === 3 ? 1 : 0.9} />
      ))}
    </svg>
  );
}
