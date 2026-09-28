import { Button, Result, Typography } from "antd";
import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import { describeError, isStaleBuild } from "../lib/errors";

interface State {
  error: Error | null;
}

/**
 * A render crash shows what happened instead of an empty screen. Around a
 * page it is keyed by the path, so the menu stays usable and another section
 * starts clean. A chunk that vanished after a redeploy asks for a reload.
 */
export default class PageErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    const stale = isStaleBuild(error);
    return (
      <Result
        status={stale ? "info" : "error"}
        title={stale ? describeError(error) : "Страница не открылась"}
        extra={
          <Button type="primary" onClick={() => window.location.reload()}>
            Обновить
          </Button>
        }
      >
        {!stale && (
          <Typography.Text type="secondary" code>
            {error.message}
          </Typography.Text>
        )}
      </Result>
    );
  }
}
