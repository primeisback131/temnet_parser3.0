import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { FONT_MONO, FONT_STACK, tokens, type ThemeMode } from "./lib/palette";

const STORAGE_KEY = "theme";

/** The mode to start in: last choice, else the OS preference. */
export function initialThemeMode(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Publishes the palette to CSS as custom properties on <html>. Called once
 * before the first render (so there is no flash of unstyled variables) and
 * again on every switch.
 */
export function applyThemeMode(mode: ThemeMode) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  root.style.setProperty("--font-sans", FONT_STACK);
  root.style.setProperty("--font-mono", FONT_MONO);
  for (const [name, value] of Object.entries(tokens[mode])) {
    root.style.setProperty(`--${name}`, value);
  }
}

const ThemeContext = createContext<{ mode: ThemeMode; toggle: () => void }>({
  mode: "light",
  toggle: () => {},
});

// eslint-disable-next-line react-refresh/only-export-components
export function useThemeMode() {
  return useContext(ThemeContext);
}

/** Holds the light/dark mode and persists it. */
export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(initialThemeMode);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
    applyThemeMode(mode);
  }, [mode]);

  const value = useMemo(
    () => ({ mode, toggle: () => setMode((m) => (m === "light" ? "dark" : "light")) }),
    [mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
