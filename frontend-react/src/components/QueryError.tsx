import { Alert } from "antd";
import type { CSSProperties } from "react";

interface Props {
  /** The `error` of a TanStack query or of a manual call; nothing is rendered when it is empty. */
  error: unknown;
  style?: CSSProperties;
}

/**
 * A failed request shown as what it is. Without it a page silently fell back
 * to empty data and read as "no data" instead of "the request failed".
 */
export default function QueryError({ error, style }: Props) {
  if (!error) {
    return null;
  }
  const text = error instanceof Error ? error.message : "Не удалось загрузить данные";
  return <Alert type="error" showIcon message={text} style={{ marginBottom: 16, ...style }} />;
}
