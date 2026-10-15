/**
 * Palette ⌘K (Spotlight) + raccourcis clavier + aide « ? ».
 * Raccourcis : g puis une lettre pour changer d'écran, c pour créer une tâche, / ou ⌘K pour chercher.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Kbd, Modal, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { Spotlight, spotlight, type SpotlightActionGroupData } from "@mantine/spotlight";
import { IconClockHour4, IconKeyboard, IconLogout, IconPlus, IconSearch, IconSunMoon } from "@tabler/icons-react";
import { api, fmtDate, useSettings, type Me, type Task } from "./api";
import { navFor } from "./nav";
import { navigate } from "./router";
import { AXES } from "./theme";

/** Touche de commande affichée : ⌘ sur Mac, Ctrl ailleurs (Spotlight accepte les deux via « mod »). */
export const MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest("input, textarea, select, [contenteditable='true'], [role='dialog']");

/** g puis lettre (1,2 s pour la seconde touche), c, ?. Ignoré pendant la saisie et dans les fenêtres. */
function useShortcuts(role: string, canCreate: boolean, onHelp: () => void) {
  useEffect(() => {
    let gAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (Date.now() - gAt < 1200) {
        gAt = 0;
        const item = navFor(role).find((n) => n.key === k);
        if (item) {
          e.preventDefault();
          navigate(`/${item.id}`);
        }
        return;
      }
      if (k === "g") gAt = Date.now();
      else if (k === "c" && canCreate) {
        e.preventDefault();
        navigate("/taches/nouvelle");
      } else if (e.key === "?") onHelp();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [role, canCreate, onHelp]);
}

export function CommandPalette({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [help, setHelp] = useState(false);
  const settings = useSettings();
  const canCreate = me.role === "pilot" || (settings.data?.members_can_propose ?? true);
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("light");
  const tasks = useQuery({ queryKey: ["tasks-all"], queryFn: () => api<Task[]>("/api/tasks") });
  useShortcuts(me.role, canCreate, () => setHelp(true));

  const nav = navFor(me.role);
  const actions: SpotlightActionGroupData[] = [
    {
      group: "Aller à",
      actions: nav.map((n) => ({
        id: `nav-${n.id}`,
        label: n.label,
        leftSection: <n.icon size={18} stroke={1.6} />,
        rightSection: <span className="kbd">g {n.key}</span>,
        onClick: () => navigate(`/${n.id}`),
      })),
    },
    {
      group: "Actions",
      actions: [
        ...(canCreate ? [{
          id: "new-task", label: "Créer une tâche", keywords: ["nouvelle", "ajouter"],
          leftSection: <IconPlus size={18} stroke={1.6} />, rightSection: <span className="kbd">c</span>,
          onClick: () => navigate("/taches/nouvelle"),
        }] : []),
        {
          id: "log-hours", label: "Saisir mes heures de la semaine", keywords: ["temps", "déclarer"],
          leftSection: <IconClockHour4 size={18} stroke={1.6} />, onClick: () => navigate("/semaine"),
        },
        {
          id: "theme", label: scheme === "dark" ? "Passer en thème clair" : "Passer en thème sombre", keywords: ["mode", "couleur"],
          leftSection: <IconSunMoon size={18} stroke={1.6} />, onClick: () => setColorScheme(scheme === "dark" ? "light" : "dark"),
        },
        {
          id: "shortcuts", label: "Voir les raccourcis clavier", keywords: ["aide", "clavier"],
          leftSection: <IconKeyboard size={18} stroke={1.6} />, rightSection: <span className="kbd">?</span>, onClick: () => setHelp(true),
        },
        {
          id: "logout", label: "Se déconnecter",
          leftSection: <IconLogout size={18} stroke={1.6} />,
          onClick: () => api("/api/logout", { method: "POST" }).finally(() => qc.invalidateQueries({ queryKey: ["me"] })),
        },
      ],
    },
    {
      group: "Tâches",
      actions: (tasks.data ?? []).map((t) => ({
        id: `task-${t.id}`,
        label: t.title,
        description: `${AXES[t.axis_code]?.label ?? t.axis_code}, du ${fmtDate(t.start_date)} au ${fmtDate(t.end_date)}`,
        keywords: [t.axis_code],
        leftSection: <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: AXES[t.axis_code]?.color }} />,
        onClick: () => navigate(`/taches/${t.id}`),
      })),
    },
  ];

  return (
    <>
      <Spotlight
        actions={actions}
        shortcut={["mod + K", "/"]}
        nothingFound="Aucun écran, aucune tâche ni action ne correspond."
        highlightQuery
        limit={14}
        scrollable
        maxHeight={440}
        radius="lg"
        classNames={{ action: "sp-action", actionDescription: "sp-desc", actionsGroup: "sp-group" }}
        searchProps={{ leftSection: <IconSearch size={18} stroke={1.6} />, placeholder: "Rechercher une tâche, un écran ou une action" }}
      />
      <Modal opened={help} onClose={() => setHelp(false)} title="Raccourcis clavier" radius="lg" centered>
        <dl className="shortcuts">
          <dt><Kbd>{MOD}</Kbd> <Kbd>K</Kbd> ou <Kbd>/</Kbd></dt><dd>Rechercher</dd>
          {canCreate && <><dt><Kbd>c</Kbd></dt><dd>Créer une tâche</dd></>}
          {nav.map((n) => (
            <div key={n.id} style={{ display: "contents" }}>
              <dt><Kbd>g</Kbd> <Kbd>{n.key}</Kbd></dt><dd>{n.label}</dd>
            </div>
          ))}
          <dt><Kbd>?</Kbd></dt><dd>Afficher cette aide</dd>
          <dt><Kbd>Échap</Kbd></dt><dd>Fermer une fenêtre</dd>
        </dl>
      </Modal>
    </>
  );
}

export const openSearch = () => spotlight.open();
