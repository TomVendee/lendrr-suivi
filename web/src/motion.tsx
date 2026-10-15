/** Mouvement utile : chiffres qui défilent jusqu'à leur valeur, notification avec « Annuler ». */
import { useEffect, useRef, useState } from "react";
import { Button } from "@mantine/core";
import { notifications } from "@mantine/notifications";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Anime la valeur affichée de l'ancienne vers la nouvelle (420 ms, sortie douce). Direct si mouvement réduit. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced() || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 420);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(a + (value - a) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="num">{format(shown)}</span>;
}

/** Notification de confirmation avec un bouton « Annuler » (6 s). */
export function toastUndo(message: string, onUndo: () => void) {
  const id = notifications.show({
    color: "brand",
    autoClose: 6000,
    message: (
      <span style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
        {message}
        <Button size="compact-sm" variant="subtle" onClick={() => { notifications.hide(id); onUndo(); }}>
          Annuler
        </Button>
      </span>
    ),
  });
}
