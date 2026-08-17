"use client";

export interface LogDumpResult {
  success: boolean;
  cancelled?: boolean;
  path?: string;
  error?: string;
}

export interface LogDumpPayload {
  reason?: string;
  detail?: string;
}

export interface RendererDiagnosticPayload {
  source: string;
  message: string;
  stack?: string;
  extra?: string;
}

export interface PdfExportDirectoryState {
  outputDirectory: string | null;
  available: boolean;
  cancelled?: boolean;
}

export interface PdfExportScheduleDay {
  date: string;
  dayLabel: string;
  tasks: unknown[];
}

export interface PdfExportPayload {
  title: string;
  eventId: number;
  eventName: string;
  eventLocation?: string;
  eventStartDate: string;
  eventEndDate: string;
  scheduleDayRange?: unknown;
  scheduleDayBoundary?: unknown;
  days: PdfExportScheduleDay[];
}

export interface PdfExportResult {
  success: boolean;
  path: string;
  fileName: string;
}

export interface ElectronDiagnosticBridge {
  isElectron?: boolean;
  platform?: string;
  versions?: Record<string, string>;
  apiUrl?: string;
  checkIntegrity?: () => Promise<any>;
  setWindowFullscreen?: (
    fullscreen: boolean,
  ) => Promise<{ success: boolean; isFullscreen?: boolean; error?: string }>;
  getWindowFullscreenState?: () => Promise<{
    success: boolean;
    isFullscreen?: boolean;
    error?: string;
  }>;
  onWindowFullscreenChange?: (
    callback: (fullscreen: boolean) => void,
  ) => () => void;
  saveLogDump?: (payload?: LogDumpPayload) => Promise<LogDumpResult>;
  recordRendererError?: (
    payload: RendererDiagnosticPayload,
  ) => Promise<{ success: boolean; error?: string }>;
  getPdfExportDirectory?: () => Promise<PdfExportDirectoryState>;
  choosePdfExportDirectory?: () => Promise<PdfExportDirectoryState>;
  clearPdfExportDirectory?: () => Promise<PdfExportDirectoryState>;
  exportSchedulePdf?: (payload: PdfExportPayload) => Promise<PdfExportResult>;
  getPdfExportJob?: (jobId: string) => Promise<PdfExportPayload & { generatedAt: string }>;
  notifyPdfExportReady?: (jobId: string) => Promise<{ success: boolean }>;
  notifyPdfExportFailed?: (
    jobId: string,
    code: string,
  ) => Promise<{ success: boolean }>;
}

declare global {
  interface Window {
    electron?: ElectronDiagnosticBridge;
  }
}

/** Return true when the Electron preload bridge can save diagnostic log dumps. */
export function isLogDumpAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.electron?.saveLogDump);
}

/** Convert any thrown value into a stable renderer diagnostic payload. */
export function normaliseErrorForLog(error: unknown): {
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      message: error.message || error.name,
      stack: error.stack,
    };
  }

  if (typeof error === "string") {
    return { message: error };
  }

  try {
    return { message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { message: String(error) };
  }
}

/** Forward a renderer error to Electron so it is included in future log dumps. */
export async function recordRendererError(
  source: string,
  error: unknown,
  extra?: unknown,
): Promise<void> {
  if (typeof window === "undefined" || !window.electron?.recordRendererError) {
    return;
  }

  const normalised = normaliseErrorForLog(error);
  let extraText: string | undefined;
  if (extra !== undefined) {
    try {
      extraText = typeof extra === "string" ? extra : JSON.stringify(extra);
    } catch {
      extraText = String(extra);
    }
  }

  await window.electron.recordRendererError({
    source,
    message: normalised.message,
    stack: normalised.stack,
    extra: extraText,
  });
}

/** Ask Electron to save a UTF-8 diagnostic log dump through the native file picker. */
export async function saveLogDump(
  reason = "Manual diagnostic log dump",
  detail?: string,
): Promise<LogDumpResult> {
  if (typeof window === "undefined" || !window.electron?.saveLogDump) {
    return {
      success: false,
      error: "Log dumps are only available in the desktop app.",
    };
  }

  return window.electron.saveLogDump({ reason, detail });
}
