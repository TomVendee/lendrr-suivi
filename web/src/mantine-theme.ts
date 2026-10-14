import { createTheme } from "@mantine/core";

/**
 * Thème : jetons docs/maquettes/README.md mappés sur Mantine.
 * Chaque tuple a 10 nuances (exigé par Mantine) autour de la couleur maquette.
 */
export const theme = createTheme({
  primaryColor: "brand",
  colors: {
    brand: [
      "#E3EBFD", "#CBD9FB", "#A9C0F5", "#8FB0FF", "#5B83EB",
      "#2D5BD7", "#2549B4", "#1E40AF", "#1A387F", "#162E66",
    ],
    ok: [
      "#E3F1E8", "#C4E2CF", "#9CCBB0", "#6BAE87", "#47976A",
      "#2E7D4F", "#256841", "#23603C", "#1D4E32", "#173E28",
    ],
    warn: [
      "#FBF1DE", "#F3DFAE", "#E9C67E", "#D9A94F", "#C68D2E",
      "#B7791F", "#9A651A", "#8A5A12", "#6E4710", "#57390D",
    ],
    crit: [
      "#FDE7E4", "#F6C2BC", "#EC948A", "#DD6156", "#C93E32",
      "#B42318", "#971D14", "#8F1C13", "#731711", "#5C120E",
    ],
  },
  fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
  headings: { fontFamily: "'Space Grotesk', sans-serif" },
  fontFamilyMonospace: "'IBM Plex Mono', monospace",
  defaultRadius: "md",
});
