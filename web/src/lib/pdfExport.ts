"use client";

import type {
  PdfExportDirectoryState,
  PdfExportPayload,
  PdfExportResult,
} from "@/lib/electronDiagnostics";

const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

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
  return Boolean(pdfBridge()?.exportSchedulePdf);
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
): Promise<PdfExportResult> {
  const bridge = pdfBridge();
  if (!bridge?.exportSchedulePdf) {
    throw new Error("PDF publishing is only available in the Desktop application.");
  }
  return bridge.exportSchedulePdf(payload);
}
