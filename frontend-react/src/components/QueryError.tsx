import { LockOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import type { CSSProperties } from "react";
import { ForbiddenError } from "../api/client";
import { describeError } from "../lib/errors";

interface Props {
  /** The `error` of a TanStack query or of a manual call; nothing is rendered when it is empty. */
  error: unknown;
  style?: CSSProperties;
}

/**
 * A failed request shown as what it is. Without it a page silently fell back
 * to empty data and read as "no data" instead of "the request failed". A
 * missing right is a warning, not a failure, and retrying it is pointless;
 * anything else offers to repeat every failed request of the screen.
 */
export default function QueryError({ error, style }: Props) {
  const queryClient = useQueryClient();
  if (!error) {
    return null;
  }
  const forbidden = error instanceof ForbiddenError;
  return (
    <Alert
      type={forbidden ? "warning" : "error"}
      showIcon
      icon={forbidden ? <LockOutlined /> : undefined}
      message={describeError(error)}
      action={
        forbidden ? undefined : (
          <Button
            size="small"
            onClick={() =>
              void queryClient.refetchQueries({ type: "active", predicate: (q) => q.state.status === "error" })
            }
          >
            Повторить
          </Button>
        )
      }
      style={{ marginBottom: 16, ...style }}
    />
  );
}
