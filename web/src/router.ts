/**
 * Routage par URL sur l'API History native (pas de librairie). Chaque écran a son adresse,
 * partageable et conservée au rechargement ; le serveur renvoie index.html (src/web.rs).
 */
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

export type View =
  | "semaine" | "taches" | "meteo" | "charge" | "graphes"
  | "gantt" | "alertes" | "synthese" | "reglages";

const VIEWS: View[] = ["semaine", "taches", "meteo", "charge", "graphes", "gantt", "alertes", "synthese", "reglages"];

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("popstate", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("popstate", fn);
  };
}

/** `/taches/42` → { view: "taches", id: "42" } ; adresse inconnue → view null. */
export function parse(path: string): { view: View | null; id?: string } {
  const [, first, id] = path.split("/");
  const view = VIEWS.includes(first as View) ? (first as View) : null;
  return { view, id: view && id ? decodeURIComponent(id) : undefined };
}

export function useRoute() {
  return parse(useSyncExternalStore(subscribe, () => location.pathname));
}

/** Change d'écran avec un fondu (View Transitions) quand le navigateur sait le faire. */
export function navigate(to: string, { replace = false } = {}) {
  if (to === location.pathname) return;
  const go = () => {
    if (replace) history.replaceState(null, "", to);
    else history.pushState(null, "", to);
    notify();
  };
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Transition seulement quand l'écran change : ouvrir une fiche (/taches → /taches/42) ne doit pas
  // animer la page, sinon la liste est peinte au-dessus de la fenêtre pendant l'animation.
  const sameView = parse(to.split("?")[0]).view === parse(location.pathname).view;
  if (replace || reduce || sameView || !document.startViewTransition || document.visibilityState !== "visible") go();
  else document.startViewTransition(() => flushSync(go)).ready.catch(() => {});
}
