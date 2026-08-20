"use client";

import type {
  PdfExportDirectoryState,
  PdfExportJobStatus,
  PdfExportPayload,
  PdfExportResult,
} from "@/lib/electronDiagnostics";

const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const PDF_JOB_SESSION_KEY = "mp-opt:active-pdf-export-job";

/** Match the main-process filename policy for a non-authoritative UI preview. */
export function sanitisePdfTitleForPreview(value: string): string {
  let title = value.normalize("NFKC").trim();
  title = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  title = title.replace(/\s+/g, " ").replace(/[. ]+$/g, "").slice(0, 120).trim();
  title = title.replace(/^\.+/, "_");
  if (!title || title === "." || title === ".." || RESERVED_WINDOWS_NAMES.test(title)) {
    return "Optimised Schedule";
  }
  return title;
}

function pdfBridge() {
  if (typeof window === "undefined" || !window.electron?.isElectron) {
    return null;
  }
  return window.electron;
}

export function isPdfExportAvailable(): boolean {
  const bridge = pdfBridge();
  return Boolean(
    bridge?.startSchedulePdfExport && bridge.getSchedulePdfExportStatus,
  );
}

export async function getPdfExportDirectory(): Promise<PdfExportDirectoryState> {
  const bridge = pdfBridge();
  if (!bridge?.getPdfExportDirectory) {
    return { outputDirectory: null, available: false };
  }
  return bridge.getPdfExportDirectory();
}

export async function choosePdfExportDirectory(): Promise<PdfExportDirectoryState> {
  const bridge = pdfBridge();
  if (!bridge?.choosePdfExportDirectory) {
    throw new Error("PDF export folders can only be selected in the Desktop application.");
  }
  return bridge.choosePdfExportDirectory();
}

export async function clearPdfExportDirectory(): Promise<PdfExportDirectoryState> {
  const bridge = pdfBridge();
  if (!bridge?.clearPdfExportDirectory) {
    return { outputDirectory: null, available: false };
  }
  return bridge.clearPdfExportDirectory();
}

export async function exportSchedulePdf(
  payload: PdfExportPayload,
  onProgress?: (status: PdfExportJobStatus) => void,
): Promise<PdfExportResult> {
  const bridge = pdfBridge();
  if (!bridge?.startSchedulePdfExport || !bridge.getSchedulePdfExportStatus) {
    throw new Error("PDF publishing is only available in the Desktop application.");
  }

  let jobId = window.sessionStorage.getItem(PDF_JOB_SESSION_KEY) || "";
  if (jobId) {
    try {
      const existing = await bridge.getSchedulePdfExportStatus(jobId);
      if (existing.state === "completed" && existing.result) {
        window.sessionStorage.removeItem(PDF_JOB_SESSION_KEY);
        return existing.result;
      }
      if (existing.state === "failed" || existing.state === "cancelled") {
        window.sessionStorage.removeItem(PDF_JOB_SESSION_KEY);
        jobId = "";
      }
    } catch {
      window.sessionStorage.removeItem(PDF_JOB_SESSION_KEY);
      jobId = "";
    }
  }

  if (!jobId) {
    const started = await bridge.startSchedulePdfExport(payload);
    jobId = started.jobId;
    window.sessionStorage.setItem(PDF_JOB_SESSION_KEY, jobId);
  }

  while (true) {
    const status = await bridge.getSchedulePdfExportStatus(jobId);
    onProgress?.(status);
    if (status.state === "completed" && status.result) {
      window.sessionStorage.removeItem(PDF_JOB_SESSION_KEY);
      return status.result;
    }
    if (status.state === "failed") {
      window.sessionStorage.removeItem(PDF_JOB_SESSION_KEY);
      const error = status.error;
      throw new Error(
        error ? `${error.message} (${error.code})` : "The PDF export failed.",
      );
    }
    if (status.state === "cancelled") {
      window.sessionStorage.removeItem(PDF_JOB_SESSION_KEY);
      throw new Error("The PDF export was cancelled.");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 300));
  }
}

export async function cancelActiveSchedulePdfExport(): Promise<boolean> {
  const bridge = pdfBridge();
  const jobId = typeof window !== "undefined"
    ? window.sessionStorage.getItem(PDF_JOB_SESSION_KEY)
    : null;
  if (!jobId || !bridge?.cancelSchedulePdfExport) return false;
  await bridge.cancelSchedulePdfExport(jobId);
  return true;
}
