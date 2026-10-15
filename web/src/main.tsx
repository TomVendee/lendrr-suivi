import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ColorSchemeScript, MantineProvider, localStorageColorSchemeManager } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/charts/styles.css";
import "./styles/tokens.css";
import "./styles/global.css";
import { App } from "./App";
import { resolver, theme } from "./mantine-theme";

const qc = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, refetchInterval: 60_000 } },
});

// Persistance explicite du thème (requis par Mantine v9).
const schemeManager = localStorageColorSchemeManager({ key: "suivi-color-scheme" });

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ColorSchemeScript defaultColorScheme="auto" />
    <MantineProvider theme={theme} cssVariablesResolver={resolver} defaultColorScheme="auto" colorSchemeManager={schemeManager}>
      <Notifications position="bottom-center" />
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>
    </MantineProvider>
  </React.StrictMode>
);
