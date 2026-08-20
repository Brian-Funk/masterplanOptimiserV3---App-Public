import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelActiveSchedulePdfExport,
  exportSchedulePdf,
} from "@/lib/pdfExport";
import type {
  ElectronDiagnosticBridge,
  PdfExportJobStatus,
  PdfExportPayload,
} from "@/lib/electronDiagnostics";

const payload: PdfExportPayload = {
  title: "Plan",
  eventId: 1,
  eventName: "Synthetic Event",
  eventStartDate: "2032-04-21",
  eventEndDate: "2032-04-21",
  days: [{ date: "2032-04-21", dayLabel: "Wednesday", tasks: [] }],
};

function status(overrides: Partial<PdfExportJobStatus> = {}): PdfExportJobStatus {
  return {
    jobId: "d06d1f84-d7f1-4e1c-905b-2f73ebdbf422",
    state: "running",
    stage: "rendering",
    message: "Rendering day 1 of 1",
    completed: 0,
    total: 1,
    dayCount: 1,
    taskCount: 4,
    retry: 0,
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

describe("main-process PDF jobs", () => {
  it("starts and completes through the job API", async () => {
    const startSchedulePdfExport = vi.fn().mockResolvedValue({
      jobId: "d06d1f84-d7f1-4e1c-905b-2f73ebdbf422",
      reused: false,
    });
    const getSchedulePdfExportStatus = vi.fn().mockResolvedValue(status({
      state: "completed",
      stage: "complete",
      message: "PDF saved",
      completed: 1,
      result: { success: true, path: "C:/Exports/Plan.pdf", fileName: "Plan.pdf" },
    }));
    installBridge({ startSchedulePdfExport, getSchedulePdfExportStatus });

    await expect(exportSchedulePdf(payload)).resolves.toEqual({
      success: true,
      path: "C:/Exports/Plan.pdf",
      fileName: "Plan.pdf",
    });
    expect(startSchedulePdfExport).toHaveBeenCalledWith(payload);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("reconnects to a running job after a UI reload", async () => {
    window.sessionStorage.setItem(
      "mp-opt:active-pdf-export-job",
      "d06d1f84-d7f1-4e1c-905b-2f73ebdbf422",
    );
    const startSchedulePdfExport = vi.fn();
    const getSchedulePdfExportStatus = vi
      .fn()
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(status({
        state: "completed",
        stage: "complete",
        message: "PDF saved",
        completed: 1,
        result: { success: true, path: "C:/Exports/Plan.pdf", fileName: "Plan.pdf" },
      }));
    installBridge({ startSchedulePdfExport, getSchedulePdfExportStatus });

    await expect(exportSchedulePdf(payload)).resolves.toMatchObject({ fileName: "Plan.pdf" });
    expect(startSchedulePdfExport).not.toHaveBeenCalled();
  });

  it("surfaces stage-specific failure codes and permits a clean retry", async () => {
    const getSchedulePdfExportStatus = vi.fn().mockResolvedValue(status({
      state: "failed",
      stage: "failed",
      message: "The PDF document did not load within 20 seconds.",
      error: { code: "PDF_LOAD_TIMEOUT", message: "The PDF document did not load within 20 seconds." },
    }));
    installBridge({
      startSchedulePdfExport: vi.fn().mockResolvedValue({
        jobId: "d06d1f84-d7f1-4e1c-905b-2f73ebdbf422",
        reused: false,
      }),
      getSchedulePdfExportStatus,
    });
    await expect(exportSchedulePdf(payload)).rejects.toThrow(/PDF_LOAD_TIMEOUT/);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("cancels only the active job stored for this window", async () => {
    window.sessionStorage.setItem(
      "mp-opt:active-pdf-export-job",
      "d06d1f84-d7f1-4e1c-905b-2f73ebdbf422",
    );
    const cancelSchedulePdfExport = vi.fn().mockResolvedValue(status({
      state: "cancelled",
      stage: "cancelled",
      message: "PDF export cancelled",
    }));
    installBridge({ cancelSchedulePdfExport });
    await expect(cancelActiveSchedulePdfExport()).resolves.toBe(true);
    expect(cancelSchedulePdfExport).toHaveBeenCalledWith(
      "d06d1f84-d7f1-4e1c-905b-2f73ebdbf422",
    );
  });
});
