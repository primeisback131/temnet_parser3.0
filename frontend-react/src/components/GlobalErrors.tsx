import { App } from "antd";
import { useEffect } from "react";
import { describeError } from "../lib/errors";

/**
 * A promise nobody awaited (an export started with `void`, a click handler
 * returning a promise) used to fail in silence. Its message goes on screen.
 */
export default function GlobalErrors() {
  const { message } = App.useApp();

  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      message.error(describeError(event.reason));
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, [message]);

  return null;
}
