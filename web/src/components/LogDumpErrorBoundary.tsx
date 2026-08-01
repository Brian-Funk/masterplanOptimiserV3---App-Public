"use client";

import React from "react";
import { AlertTriangle, Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { recordRendererError, saveLogDump } from "@/lib/electronDiagnostics";

interface LogDumpErrorBoundaryState {
  error: Error | null;
  saving: boolean;
  status: string | null;
}

/** Catch React render errors and offer a downloadable diagnostic log dump. */
export class LogDumpErrorBoundary extends React.Component<
  { children: React.ReactNode },
  LogDumpErrorBoundaryState
> {
  state: LogDumpErrorBoundaryState = {
    error: null,
    saving: false,
    status: null,
  };

  static getDerivedStateFromError(error: Error): Partial<LogDumpErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    void recordRendererError("react-error-boundary", error, {
      componentStack: errorInfo.componentStack,
    });
  }

  private handleDownload = async () => {
    this.setState({ saving: true, status: "Preparing log dump..." });
    try {
      const result = await saveLogDump(
        "Renderer error",
        this.state.error?.message || "React error boundary",
      );
      if (result.cancelled) {
        this.setState({ status: "Log dump save cancelled." });
      } else if (result.success) {
        this.setState({ status: "Log dump saved." });
      } else {
        this.setState({
          status: result.error || "Could not save the log dump.",
        });
      }
    } catch (error) {
      this.setState({
        status:
          error instanceof Error
            ? error.message
            : "Could not save the log dump.",
      });
    } finally {
      this.setState({ saving: false });
    }
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-surface-alt flex items-center justify-center px-6">
        <div className="w-full max-w-2xl rounded-lg border border-bordercl bg-surface shadow-xl p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-semibold text-foreground">
                Something went wrong
              </h1>
              <p className="mt-2 text-sm leading-6 text-foreground-secondary">
                A log dump is a text file containing recent diagnostic messages
                from the desktop shell, local backend, web interface, and
                browser error handler. Download it and forward it to the
                developer so they can analyse what happened and fix the problem.
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-bordercl bg-surface-hover p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
              Error detail
            </p>
            <p className="mt-2 break-words text-sm text-foreground-secondary">
              {this.state.error.message || this.state.error.name}
            </p>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={this.handleDownload}
              disabled={this.state.saving}
            >
              {this.state.saving ? (
                <Spinner size="sm" className="border-white border-t-white/40" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Download Log Dump
            </Button>
            <Button type="button" variant="outline" onClick={this.handleReload}>
              <RotateCcw className="h-4 w-4" />
              Reload App
            </Button>
            {this.state.status && (
              <span className="text-sm text-foreground-muted">
                {this.state.status}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }
}
