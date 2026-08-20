"use client";

import type {
  ExcelExportJobStatus,
  ExcelExportPayload,
  ExcelExportResult,
} from "@/lib/electronDiagnostics";

const EXCEL_JOB_SESSION_KEY = "mp-opt:active-excel-export-job";

function excelBridge() {
  if (typeof window === "undefined" || !window.electron?.isElectron) return null;
  return window.electron;
}

export function isExcelExportAvailable(): boolean {
  const bridge = excelBridge();
  return Boolean(
    bridge?.startScheduleExcelExport && bridge.getScheduleExcelExportStatus,
  );
}

export async function exportScheduleExcel(
  payload: ExcelExportPayload,
  onProgress?: (status: ExcelExportJobStatus) => void,
): Promise<ExcelExportResult> {
  const bridge = excelBridge();
  if (!bridge?.startScheduleExcelExport || !bridge.getScheduleExcelExportStatus) {
    throw new Error("Excel publishing is only available in the Desktop application.");
  }

  let jobId = window.sessionStorage.getItem(EXCEL_JOB_SESSION_KEY) || "";
  if (jobId) {
    try {
      const existing = await bridge.getScheduleExcelExportStatus(jobId);
      if (existing.state === "completed" && existing.result) {
        window.sessionStorage.removeItem(EXCEL_JOB_SESSION_KEY);
        return existing.result;
      }
      if (existing.state === "failed" || existing.state === "cancelled") {
        window.sessionStorage.removeItem(EXCEL_JOB_SESSION_KEY);
        jobId = "";
      }
    } catch {
      window.sessionStorage.removeItem(EXCEL_JOB_SESSION_KEY);
      jobId = "";
    }
  }

  if (!jobId) {
    const started = await bridge.startScheduleExcelExport(payload);
    jobId = started.jobId;
    window.sessionStorage.setItem(EXCEL_JOB_SESSION_KEY, jobId);
  }

  while (true) {
    const status = await bridge.getScheduleExcelExportStatus(jobId);
    onProgress?.(status);
    if (status.state === "completed" && status.result) {
      window.sessionStorage.removeItem(EXCEL_JOB_SESSION_KEY);
      return status.result;
    }
    if (status.state === "failed") {
      window.sessionStorage.removeItem(EXCEL_JOB_SESSION_KEY);
      throw new Error(
        status.error
          ? `${status.error.message} (${status.error.code})`
          : "The Excel export failed.",
      );
    }
    if (status.state === "cancelled") {
      window.sessionStorage.removeItem(EXCEL_JOB_SESSION_KEY);
      throw new Error("The Excel export was cancelled.");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 200));
  }
}

export async function cancelActiveScheduleExcelExport(): Promise<boolean> {
  const bridge = excelBridge();
  const jobId = typeof window !== "undefined"
    ? window.sessionStorage.getItem(EXCEL_JOB_SESSION_KEY)
    : null;
  if (!jobId || !bridge?.cancelScheduleExcelExport) return false;
  await bridge.cancelScheduleExcelExport(jobId);
  return true;
}
