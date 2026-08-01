"use client";

import { useEffect } from "react";
import { recordRendererError } from "@/lib/electronDiagnostics";

/** Record browser-level errors so they are included in downloadable log dumps. */
export function RendererErrorReporter() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      void recordRendererError("window-error", event.error || event.message, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      void recordRendererError("unhandled-promise-rejection", event.reason);
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
