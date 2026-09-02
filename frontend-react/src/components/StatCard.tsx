import { Card } from "antd";
import type { CSSProperties, ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  /** Small line under the value: units, a cut-off date. */
  hint?: ReactNode;
  icon?: ReactNode;
  /** Resolved accent colour, plus its translucent tint for the icon chip. */
  accent: string;
  soft: string;
  onClick?: () => void;
}

/** KPI tile: label, big number, optional hint. */
export default function StatCard({ label, value, hint, icon, accent, soft, onClick }: Props) {
  const style = { "--stat-accent": accent, "--stat-soft": soft } as CSSProperties;

  return (
    <Card
      className={`stat-card${onClick ? " is-clickable" : ""}`}
      style={style}
      hoverable={!!onClick}
      onClick={onClick}
      styles={{ body: { padding: "16px 18px" } }}
    >
      <div className="stat-head">
        {icon && <span className="stat-icon">{icon}</span>}
        <span>{label}</span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-foot">{hint}</div>
    </Card>
  );
}
