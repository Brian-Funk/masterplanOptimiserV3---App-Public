import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelActiveScheduleExcelExport,
  exportScheduleExcel,
} from "@/lib/excelExport";
import type {
  ElectronDiagnosticBridge,
  ExcelExportJobStatus,
  ExcelExportPayload,
} from "@/lib/electronDiagnostics";

const jobId = "d06d1f84-d7f1-4e1c-905b-2f73ebdbf422";
const payload: ExcelExportPayload = {
  title: "Plan",
  eventId: 1,
  eventName: "Synthetic Event",
  eventStartDate: "2032-04-21",
  eventEndDate: "2032-04-21",
  people: [],
  days: [{ date: "2032-04-21", alias: "Build", dayNumber: 1, tasks: [] }],
};

function status(overrides: Partial<ExcelExportJobStatus> = {}): ExcelExportJobStatus {
  return {
    jobId,
    state: "running",
    stage: "building",
    message: "Building day 1 of 1",
    completed: 0,
    total: 1,
    dayCount: 1,
    taskCount: 0,
    startedAt: "2032-04-20T12:00:00Z",
    updatedAt: "2032-04-20T12:00:01Z",
    ...overrides,
  };
}

function installBridge(bridge: ElectronDiagnosticBridge) {
  Object.defineProperty(window, "electron", {
    configurable: true,
    value: { isElectron: true, ...bridge },
  });
}

afterEach(() => {
  window.sessionStorage.clear();
  Reflect.deleteProperty(window, "electron");
  vi.restoreAllMocks();
});

describe("main-process Excel jobs", () => {
  it("starts and completes through the production job API", async () => {
    const startScheduleExcelExport = vi.fn().mockResolvedValue({ jobId, reused: false });
    const getScheduleExcelExportStatus = vi.fn().mockResolvedValue(status({
      state: "completed",
      stage: "complete",
      message: "Excel workbook saved",
      completed: 1,
      result: { success: true, path: "C:/Exports/Plan.xlsx", fileName: "Plan.xlsx" },
    }));
    installBridge({ startScheduleExcelExport, getScheduleExcelExportStatus });

    await expect(exportScheduleExcel(payload)).resolves.toMatchObject({ fileName: "Plan.xlsx" });
    expect(startScheduleExcelExport).toHaveBeenCalledWith(payload);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("resumes a running job after a renderer reload", async () => {
    window.sessionStorage.setItem("mp-opt:active-excel-export-job", jobId);
    const startScheduleExcelExport = vi.fn();
    const getScheduleExcelExportStatus = vi
      .fn()
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(status({
        state: "completed",
        stage: "complete",
        completed: 1,
        result: { success: true, path: "C:/Exports/Plan.xlsx", fileName: "Plan.xlsx" },
      }));
    installBridge({ startScheduleExcelExport, getScheduleExcelExportStatus });

    await expect(exportScheduleExcel(payload)).resolves.toMatchObject({ fileName: "Plan.xlsx" });
    expect(startScheduleExcelExport).not.toHaveBeenCalled();
  });

  it("surfaces a safe failure code and clears the resumable job", async () => {
    installBridge({
      startScheduleExcelExport: vi.fn().mockResolvedValue({ jobId, reused: false }),
      getScheduleExcelExportStatus: vi.fn().mockResolvedValue(status({
        state: "failed",
        stage: "failed",
        message: "The output folder is unavailable.",
        error: { code: "EXCEL_OUTPUT_UNAVAILABLE", message: "The output folder is unavailable." },
      })),
    });

    await expect(exportScheduleExcel(payload)).rejects.toThrow(/EXCEL_OUTPUT_UNAVAILABLE/);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("cancels only the job stored for this window", async () => {
    window.sessionStorage.setItem("mp-opt:active-excel-export-job", jobId);
    const cancelScheduleExcelExport = vi.fn().mockResolvedValue(status({
      state: "cancelled",
      stage: "cancelled",
      message: "Excel export cancelled",
    }));
    installBridge({ cancelScheduleExcelExport });

    await expect(cancelActiveScheduleExcelExport()).resolves.toBe(true);
    expect(cancelScheduleExcelExport).toHaveBeenCalledWith(jobId);
  });
});
