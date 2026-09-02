import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider } from "antd";
import ruRU from "antd/locale/ru_RU";
import { BrowserRouter } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ru";
import "antd/dist/reset.css";
import "./styles.css";
import App from "./App";
import { AuthProvider } from "./auth";
import { buildTheme } from "./lib/antdTheme";
import { applyThemeMode, initialThemeMode, ThemeModeProvider, useThemeMode } from "./theme";

dayjs.locale("ru");

// Before the first paint, so no frame renders with unresolved CSS variables.
applyThemeMode(initialThemeMode());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/** Applies the current light/dark mode to the antd component tree. */
function ThemedApp() {
  const { mode } = useThemeMode();
  return (
    <ConfigProvider locale={ruRU} theme={buildTheme(mode)}>
      {/* antd's App provides the message/notification context - the static
          message API silently does nothing under React 19. */}
      <AntApp>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeModeProvider>
        <ThemedApp />
      </ThemeModeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
