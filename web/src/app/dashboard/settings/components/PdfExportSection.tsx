"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle, FileDown, FolderOpen, Trash2 } from "lucide-react";
import { eventsApi } from "@/lib/api";
import {
  choosePdfExportDirectory,
  clearPdfExportDirectory,
  getPdfExportDirectory,
  isPdfExportAvailable,
  sanitisePdfTitleForPreview,
} from "@/lib/pdfExport";
import type { PdfExportDirectoryState } from "@/lib/electronDiagnostics";
import { isExcelExportAvailable } from "@/lib/excelExport";

interface PdfExportSectionProps {
  eventId?: number;
  eventName?: string;
  onReadinessChange?: (ready: boolean) => void;
  onExcelReadinessChange?: (ready: boolean) => void;
}

function previewTimestamp(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ].join("_");
}

function excelPreviewTimestamp(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}-${String(date.getMinutes()).padStart(2, "0")}`;
}

export function PdfExportSection({
  eventId,
  eventName,
  onReadinessChange,
  onExcelReadinessChange,
}: PdfExportSectionProps) {
  const [title, setTitle] = useState(eventName ?? "Optimised Schedule");
  const [customised, setCustomised] = useState(false);
  const [directory, setDirectory] = useState<PdfExportDirectoryState>({
    outputDirectory: null,
    available: false,
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const bridgeAvailable = isPdfExportAvailable();
  const excelBridgeAvailable = isExcelExportAvailable();

  useEffect(() => {
    let cancelled = false;
    getPdfExportDirectory().then((next) => {
      if (!cancelled) setDirectory(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!eventId) {
      setTitle(eventName ?? "Optimised Schedule");
      setCustomised(false);
      return;
    }
    eventsApi
      .getPdfExportSettings(eventId)
      .then((settings) => {
        if (cancelled) return;
        setTitle(settings.title);
        setCustomised(settings.customised);
      })
      .catch(() => {
        if (!cancelled) setTitle(eventName ?? "Optimised Schedule");
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, eventName]);

  const ready = Boolean(bridgeAvailable && eventId && title.trim() && directory.available);
  const excelReady = Boolean(
    excelBridgeAvailable && eventId && title.trim() && directory.available,
  );
  useEffect(() => onReadinessChange?.(ready), [onReadinessChange, ready]);
  useEffect(
    () => onExcelReadinessChange?.(excelReady),
    [excelReady, onExcelReadinessChange],
  );

  const filenamePreview = useMemo(
    () => `${sanitisePdfTitleForPreview(title || eventName || "Optimised Schedule")}_${previewTimestamp()}.pdf`,
    [eventName, title],
  );
  const excelFilenamePreview = useMemo(
    () => `${sanitisePdfTitleForPreview(title || eventName || "Optimised Schedule")}_${excelPreviewTimestamp()}.xlsx`,
    [eventName, title],
  );

  const saveTitle = async () => {
    if (!eventId || !title.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const saved = await eventsApi.setPdfExportSettings(eventId, title.trim());
      setTitle(saved.title);
      setCustomised(saved.customised);
      setMessage("Document title saved for this event.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the document title.");
    } finally {
      setBusy(false);
    }
  };

  const chooseFolder = async () => {
    setBusy(true);
    setMessage("");
    try {
      const selected = await choosePdfExportDirectory();
      setDirectory(selected);
      if (!selected.cancelled) setMessage("Local document output folder selected for this workstation.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not select the document folder.");
    } finally {
      setBusy(false);
    }
  };

  const clearFolder = async () => {
    setBusy(true);
    try {
      setDirectory(await clearPdfExportDirectory());
      setMessage("Local document output folder cleared from this workstation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Local document exports</h3>
        <p className="mt-1 text-sm text-foreground-muted">
          Publish the Optimised Schedule as a readable PDF, a structured Excel workbook, or both.
          The title belongs to this event; the folder stays only on this workstation. Excel files
          contain the event&apos;s person assignments and are never uploaded automatically.
        </p>
      </div>

      <div className="space-y-5 rounded-lg border border-bordercl bg-surface p-5">
        <div>
          <label htmlFor="pdf-export-title" className="text-sm font-medium text-foreground">
            Document title
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="pdf-export-title"
              value={title}
              disabled={!eventId || busy}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-bordercl-strong bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              disabled={!eventId || !title.trim() || busy}
              onClick={saveTitle}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save title
            </button>
          </div>
          <p className="mt-1 text-xs text-foreground-faint">
            {customised ? "Custom title for this event." : "Currently follows the event name."}
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-foreground">Workstation output folder</p>
          <div className="mt-2 rounded-lg border border-bordercl bg-surface-alt p-3">
            <div className="flex items-start gap-2">
              <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" />
              <span className="min-w-0 break-all text-sm text-foreground-secondary">
                {directory.outputDirectory ?? "No folder selected"}
              </span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!bridgeAvailable || busy}
              onClick={chooseFolder}
              className="inline-flex items-center gap-2 rounded-lg border border-bordercl-strong px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-hover disabled:opacity-50"
            >
              <FolderOpen className="h-4 w-4" />
              {directory.outputDirectory ? "Change folder" : "Choose folder"}
            </button>
            {directory.outputDirectory && (
              <button
                type="button"
                disabled={busy}
                onClick={clearFolder}
                className="inline-flex items-center gap-2 rounded-lg border border-bordercl-strong px-3 py-2 text-sm text-foreground-muted hover:bg-surface-hover"
              >
                <Trash2 className="h-4 w-4" />
                Clear folder
              </button>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-bordercl bg-surface-alt p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-foreground">
            {ready || excelReady ? <CheckCircle className="h-4 w-4 text-green-600" /> : <FileDown className="h-4 w-4" />}
            Local publication readiness
          </div>
          <div className="mt-2 grid gap-2 text-xs text-foreground-muted sm:grid-cols-2">
            <div className="rounded border border-bordercl bg-surface px-2 py-2">
              <span className="font-medium text-foreground">PDF:</span>{" "}
              {ready ? "ready" : "not ready"}
              <p className="mt-1 break-all">{filenamePreview}</p>
            </div>
            <div className="rounded border border-bordercl bg-surface px-2 py-2">
              <span className="font-medium text-foreground">Excel:</span>{" "}
              {excelReady ? "ready" : "not ready"}
              <p className="mt-1 break-all">{excelFilenamePreview}</p>
            </div>
          </div>
          {!bridgeAvailable && !excelBridgeAvailable && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              Folder selection and local document generation are available in the Desktop application only.
            </p>
          )}
        </div>

        {message && <p className="text-sm text-foreground-secondary">{message}</p>}
      </div>
    </div>
  );
}
