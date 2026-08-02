import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider, theme as antdTheme } from "antd";
import ruRU from "antd/locale/ru_RU";
import { BrowserRouter } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ru";
import "antd/dist/reset.css";
import "./styles.css";
import App from "./App";
import { ThemeModeProvider, useThemeMode } from "./theme";

dayjs.locale("ru");

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
    <ConfigProvider
      locale={ruRU}
      theme={{
        algorithm: mode === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: "#3e79f7" },
      }}
    >
      {/* antd's App provides the message/notification context — the static
          message API silently does nothing under React 19. */}
      <AntApp>
        <BrowserRouter>
          <App />
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
