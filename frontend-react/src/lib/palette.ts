export type ThemeMode = "light" | "dark";

/**
 * One source of truth for colour. The same values feed three consumers:
 * antd (ConfigProvider tokens in main.tsx), plain CSS (ThemeModeProvider
 * writes `tokens` onto <html> as custom properties) and ECharts
 * (chartTheme.ts). Nothing below should be duplicated as a literal elsewhere.
 */

/** Data-series colours, tuned per mode so both keep 3:1 against the surface. */
export const accent = {
  blue: { light: "#3d6ff5", dark: "#5b8dff" },
  green: { light: "#0f9d76", dark: "#26cb9c" },
  amber: { light: "#d98004", dark: "#f5a623" },
  rose: { light: "#dc4560", dark: "#ff6b83" },
  violet: { light: "#7256e8", dark: "#a68bff" },
  cyan: { light: "#0b93bd", dark: "#38bdf8" },
} as const;

export type Accent = keyof typeof accent;

/** Picks one accent for a mode. */
export const hue = (name: Accent, mode: ThemeMode) => accent[name][mode];

/**
 * Surface / text / border scale. Dark is a layered near-black with a blue
 * cast rather than antd's flat #141414, so cards read as raised instead of
 * dissolving into the page.
 */
export const tokens: Record<ThemeMode, Record<string, string>> = {
  light: {
    brand: "#3d6ff5",
    "brand-deep": "#2a54cc",
    success: accent.green.light,
    warning: accent.amber.light,
    danger: accent.rose.light,
    bg: "#eef1f7",
    surface: "#ffffff",
    "surface-muted": "#f6f8fc",
    "surface-hover": "#eaeff7",
    "surface-sunken": "#f2f5fa",
    border: "#dfe5ee",
    "border-soft": "#ebeff5",
    text: "#0f172a",
    "text-muted": "#56637a",
    "text-faint": "#6f7d92",
    shadow: "0 1px 2px rgba(15, 23, 42, 0.04), 0 10px 28px -18px rgba(15, 23, 42, 0.35)",
    "shadow-raised": "0 2px 6px rgba(15, 23, 42, 0.06), 0 18px 40px -24px rgba(15, 23, 42, 0.45)",
    "accent-soft": "rgba(61, 111, 245, 0.1)",
    scrim: "rgba(15, 23, 42, 0.45)",
  },
  dark: {
    brand: "#5b8dff",
    "brand-deep": "#3a63d6",
    success: accent.green.dark,
    warning: accent.amber.dark,
    danger: accent.rose.dark,
    bg: "#0a0c11",
    surface: "#12151c",
    "surface-muted": "#171b24",
    "surface-hover": "#1d2230",
    "surface-sunken": "#0e1116",
    border: "#242a36",
    "border-soft": "#1b202a",
    text: "#e7eaf0",
    "text-muted": "#9aa4b5",
    "text-faint": "#838ea1",
    shadow: "0 1px 2px rgba(0, 0, 0, 0.5), 0 12px 32px -20px rgba(0, 0, 0, 0.9)",
    "shadow-raised": "0 2px 8px rgba(0, 0, 0, 0.55), 0 24px 48px -28px rgba(0, 0, 0, 1)",
    "accent-soft": "rgba(91, 141, 255, 0.14)",
    scrim: "rgba(3, 5, 9, 0.6)",
  },
};

/** `#rrggbb` to `rgba(...)`, for tints derived from an accent. */
export function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Shorthand for a token of the active mode. */
export const token = (name: keyof (typeof tokens)["light"], mode: ThemeMode) => tokens[mode][name];

/**
 * Segoe UI Variable ships with Windows 11 and is what the operators run;
 * the rest is the usual fallback chain. Kept local so the app never waits
 * on a webfont over an intranet link.
 */
export const FONT_STACK =
  '"Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, Inter, Roboto, ' +
  '"Helvetica Neue", Arial, sans-serif';

export const FONT_MONO = '"Cascadia Mono", "JetBrains Mono", Consolas, "SF Mono", ui-monospace, monospace';
