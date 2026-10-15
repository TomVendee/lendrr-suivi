import { createTheme, type CSSVariablesResolver } from "@mantine/core";

/**
 * Thème « Précision » (D23). Les rampes servent aux composants Mantine (boutons, interrupteurs…) ;
 * les surfaces et le texte viennent des jetons de styles/tokens.css.
 */
export const theme = createTheme({
  primaryColor: "brand",
  primaryShade: { light: 6, dark: 4 },
  colors: {
    brand: [
      "#EEF0FF", "#E0E3FF", "#C7CBFE", "#A5ABFC", "#8287F8",
      "#6366F1", "#5048E5", "#4338CA", "#3730A3", "#312E81",
    ],
    ok: [
      "#E6F6EE", "#C5EBD7", "#9DDBBB", "#6FC79A", "#46B07B",
      "#2E9A66", "#247F54", "#1D6644", "#174F35", "#113B28",
    ],
    warn: [
      "#FDF4E1", "#FAE6BA", "#F5D38A", "#EFBE58", "#E6A933",
      "#D4941A", "#B07813", "#8C5E10", "#6B470D", "#4F340A",
    ],
    crit: [
      "#FDECEC", "#F9CFCF", "#F2A7A7", "#EA7A7B", "#E25556",
      "#D63A3C", "#B52D2F", "#912426", "#6F1C1E", "#521517",
    ],
  },
  fontFamily: "var(--font-sans)",
  fontFamilyMonospace: "var(--font-mono)",
  headings: { fontFamily: "var(--font-sans)", fontWeight: "600" },
  defaultRadius: "md",
  radius: { xs: "4px", sm: "6px", md: "10px", lg: "14px", xl: "20px" },
  cursorType: "pointer",
  focusRing: "auto",
  components: {
    // Pas de capitales décoratives (D23) : les libellés restent en casse normale.
    Badge: { styles: { root: { textTransform: "none", fontWeight: 500, letterSpacing: 0 } } },
  },
});

/** Surfaces, texte et bordures de Mantine alignés sur nos jetons, en clair comme en sombre. */
const shared = {
  "--mantine-color-body": "var(--bg)",
  "--mantine-color-text": "var(--text-1)",
  "--mantine-color-dimmed": "var(--text-2)",
  "--mantine-color-placeholder": "var(--text-3)",
  "--mantine-color-default": "var(--surface-1)",
  "--mantine-color-default-hover": "var(--sunken)",
  "--mantine-color-default-color": "var(--text-1)",
  "--mantine-color-default-border": "var(--border-strong)",
};

export const resolver: CSSVariablesResolver = () => ({ variables: {}, light: shared, dark: shared });
