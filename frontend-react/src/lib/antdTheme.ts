import { theme as antdAlgorithms, type ThemeConfig } from "antd";
import { accent, FONT_STACK, tokens, type ThemeMode } from "./palette";

/** Maps the palette (lib/palette.ts) onto antd's design tokens. */
export function buildTheme(mode: ThemeMode): ThemeConfig {
  const t = tokens[mode];
  const dark = mode === "dark";
  return {
    algorithm: dark ? antdAlgorithms.darkAlgorithm : antdAlgorithms.defaultAlgorithm,
    token: {
      // No transitions: popups that fade and slide in stay blank on virtual
      // machines and remote desktops without GPU compositing.
      motion: false,
      colorPrimary: t.brand,
      colorInfo: t.brand,
      colorLink: t.brand,
      colorSuccess: accent.green[mode],
      colorWarning: accent.amber[mode],
      colorError: accent.rose[mode],
      colorBgLayout: t.bg,
      colorBgContainer: t.surface,
      colorBgElevated: dark ? t["surface-muted"] : t.surface,
      colorBorder: t.border,
      colorBorderSecondary: t["border-soft"],
      colorText: t.text,
      colorTextSecondary: t["text-muted"],
      colorTextTertiary: t["text-faint"],
      colorTextDescription: t["text-faint"],
      fontFamily: FONT_STACK,
      fontSize: 14,
      borderRadius: 10,
      borderRadiusSM: 8,
      borderRadiusLG: 14,
      controlHeight: 36,
      wireframe: false,
      boxShadowSecondary: t["shadow-raised"],
    },
    components: {
      Layout: {
        bodyBg: t.bg,
        headerBg: dark ? "rgba(18, 21, 28, 0.82)" : "rgba(255, 255, 255, 0.82)",
        headerHeight: 60,
        headerPadding: "0 24px",
        // Sider and Menu always run in antd's "light" theme so the explicit
        // tokens below drive both modes; that keeps one set of colours
        // instead of the parallel dark* family.
        siderBg: t.surface,
        lightSiderBg: t.surface,
        triggerBg: t["surface-muted"],
        triggerColor: t.text,
        lightTriggerBg: t["surface-muted"],
        lightTriggerColor: t.text,
      },
      Menu: {
        itemBg: "transparent",
        subMenuItemBg: "transparent",
        itemColor: t["text-muted"],
        itemHoverColor: t.text,
        itemHoverBg: t["surface-hover"],
        itemSelectedBg: t["accent-soft"],
        itemSelectedColor: t.brand,
        itemBorderRadius: 9,
        itemMarginInline: 10,
        itemHeight: 38,
        iconSize: 15,
        groupTitleColor: t["text-faint"],
        groupTitleFontSize: 11,
      },
      Card: {
        headerBg: "transparent",
        headerHeight: 52,
        headerFontSize: 15,
        bodyPadding: 20,
      },
      Table: {
        headerBg: t["surface-muted"],
        headerColor: t["text-muted"],
        headerSplitColor: "transparent",
        rowHoverBg: t["surface-hover"],
        borderColor: t["border-soft"],
        cellPaddingBlock: 11,
        footerBg: "transparent",
      },
      Segmented: {
        trackBg: t["surface-muted"],
        itemSelectedBg: t.surface,
        itemSelectedColor: t.text,
        itemHoverBg: t["surface-hover"],
        trackPadding: 3,
      },
      Modal: { contentBg: t.surface, headerBg: t.surface, titleFontSize: 16 },
      Descriptions: { labelBg: "transparent" },
      Tag: { defaultBg: t["surface-muted"], defaultColor: t["text-muted"] },
      Button: { primaryShadow: "none", defaultShadow: "none", dangerShadow: "none" },
      Tooltip: { colorBgSpotlight: dark ? "#242a36" : "#1e293b" },
      Statistic: { titleFontSize: 13, contentFontSize: 26 },
    },
  };
}
