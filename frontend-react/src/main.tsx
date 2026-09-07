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
import { ApiError } from "./api/client";
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
      // One retry for flaky networks and server hiccups; a 4xx is the
      // backend's final word (no session, no rights, bad parameters).
      retry: (failureCount, error) =>
        failureCount < 1 && !(error instanceof ApiError && error.status < 500),
    },
  },
});

/** Applies the current light/dark mode to the antd component tree. */
function ThemedApp() {
  const { mode } = useThemeMode();
  // virtual={false}: the virtualised dropdown list renders empty in some
  // browsers found on office machines; the lists here are short anyway.
  return (
    <ConfigProvider locale={ruRU} theme={buildTheme(mode)} virtual={false}>
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
