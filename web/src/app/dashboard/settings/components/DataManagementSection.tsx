"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { ImportPreviewModal } from "@/components/import/ImportPreviewModal";
import { CopiedTaskDateRepairModal } from "@/components/data/CopiedTaskDateRepairModal";
import { useEvent } from "@/contexts/EventContext";
import { useTaskInstances } from "@/contexts/TaskInstanceContext";
import {
  dataManagementApi,
  type CopiedTaskDateRepairPreview,
  type ImportValidationResult,
} from "@/lib/api";
import { buildInvalidJsonImportValidation } from "@/lib/importPreview";
import {
  Download,
  Upload,
  Copy,
  Trash2,
  AlertTriangle,
  Wrench,
} from "lucide-react";

export function DataManagementSection() {
  const router = useRouter();
  const {
    selectedEventId,
    availableEvents,
    refreshEvents,
    setSelectedEventId,
  } = useEvent();
  const { refresh: refreshTaskInstances } = useTaskInstances();

  // Export state
  const [exportScope, setExportScope] = useState<
    "event" | "global" | "full" | "shareable"
  >("event");
  const [exporting, setExporting] = useState(false);

  // Import state
  const [importPayload, setImportPayload] = useState<Record<string, any> | null>(
    null,
  );
  const [importFileName, setImportFileName] = useState("");
  const [importValidation, setImportValidation] =
    useState<ImportValidationResult | null>(null);
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Copy state
  const [copySourceId, setCopySourceId] = useState<number | null>(null);
  const [copyInclude, setCopyInclude] = useState<string[]>([
    "persons",
    "locations",
    "groups",
    "task_structure",
    "enabled_capabilities",
  ]);
  const [copying, setCopying] = useState(false);
  const [repairPreview, setRepairPreview] =
    useState<CopiedTaskDateRepairPreview | null>(null);
  const [repairSelection, setRepairSelection] = useState<number[]>([]);
  const [loadingRepairPreview, setLoadingRepairPreview] = useState(false);
  const [repairingDates, setRepairingDates] = useState(false);

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Factory reset state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetInput, setResetInput] = useState("");
  const [resetting, setResetting] = useState(false);

  // Status messages
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const currentEvent = availableEvents.find((e) => e.id === selectedEventId);
  const otherEvents = availableEvents.filter((e) => e.id !== selectedEventId);

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  // ── Export ──────────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await dataManagementApi.exportData(
        exportScope,
        exportScope === "event" && selectedEventId
          ? [selectedEventId]
          : undefined,
      );
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const scopeLabel =
        exportScope === "event"
          ? currentEvent?.name?.replace(/\s+/g, "_") || "event"
          : exportScope === "shareable"
            ? "shareable_setup"
            : exportScope;
      a.download = `masterplan_${scopeLabel}_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      if (exportScope === "shareable") {
        const report = data.shareable_setup_report as
          | { included_counts?: Record<string, number>; redactions?: number }
          | undefined;
        const included = Object.values(report?.included_counts || {}).reduce(
          (total, count) => total + count,
          0,
        );
        showMessage(
          "success",
          `Shareable setup downloaded with ${included} reusable records and ${report?.redactions || 0} automatic ${report?.redactions === 1 ? "redaction" : "redactions"}.`,
        );
      } else {
        showMessage("success", "Export downloaded successfully");
      }
    } catch (err) {
      showMessage("error", `Export failed: ${err}`);
    } finally {
      setExporting(false);
    }
  };

  // ── Import ─────────────────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    let data: Record<string, any>;
    try {
      const text = await file.text();
      data = JSON.parse(text);
    } catch {
      setImportPayload(null);
      setImportFileName(file.name);
      setImportValidation(buildInvalidJsonImportValidation());
      setShowImportPreview(true);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    try {
      const validation = await dataManagementApi.previewImport(data);
      setImportPayload(data);
      setImportFileName(file.name);
      setImportValidation(validation);
      setShowImportPreview(true);
    } catch (err) {
      showMessage("error", `Import preview failed: ${err}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleImport = async () => {
    if (!importPayload) return;
    setImporting(true);
    try {
      const result = await dataManagementApi.importData(importPayload);
      await refreshEvents();

      // Navigate to the first imported project if events were imported
      if (result.imported_event_ids && result.imported_event_ids.length > 0) {
        setSelectedEventId(result.imported_event_ids[0]);
      }

      showMessage("success", result.message);
      clearImportPreview();
    } catch (err) {
      showMessage("error", `Import failed: ${err}`);
    } finally {
      setImporting(false);
    }
  };

  const clearImportPreview = () => {
    setImportPayload(null);
    setImportFileName("");
    setImportValidation(null);
    setShowImportPreview(false);
  };

  const chooseAnotherImportFile = () => {
    clearImportPreview();
    fileInputRef.current?.click();
  };

  // ── Copy ───────────────────────────────────────────────
  const toggleCopyInclude = (key: string) => {
    setCopyInclude((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const handleCopy = async () => {
    if (!copySourceId || !selectedEventId) return;
    setCopying(true);
    try {
      const result = await dataManagementApi.copyFromEvent(
        copySourceId,
        selectedEventId,
        copyInclude,
      );
      const summary = Object.entries(result.summary)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      await refreshTaskInstances();
      showMessage("success", `Copied: ${summary}`);
    } catch (err) {
      showMessage("error", `Copy failed: ${err}`);
    } finally {
      setCopying(false);
    }
  };

  const openRepairPreview = async () => {
    if (!copySourceId || !selectedEventId) return;
    setLoadingRepairPreview(true);
    try {
      const preview = await dataManagementApi.previewCopiedTaskDateRepair(
        copySourceId,
        selectedEventId,
      );
      setRepairPreview(preview);
      setRepairSelection(
        preview.candidates
          .filter((candidate) => candidate.repairable)
          .map((candidate) => candidate.task_instance_id),
      );
    } catch (err) {
      showMessage("error", `Repair preview failed: ${err}`);
    } finally {
      setLoadingRepairPreview(false);
    }
  };

  const toggleRepairSelection = (taskInstanceId: number) => {
    setRepairSelection((current) =>
      current.includes(taskInstanceId)
        ? current.filter((id) => id !== taskInstanceId)
        : [...current, taskInstanceId],
    );
  };

  const applyTaskDateRepair = async () => {
    if (!copySourceId || !selectedEventId || repairSelection.length === 0) return;
    setRepairingDates(true);
    try {
      const result = await dataManagementApi.repairCopiedTaskDates(
        copySourceId,
        selectedEventId,
        repairSelection,
      );
      await refreshTaskInstances();
      setRepairPreview(null);
      setRepairSelection([]);
      showMessage(
        "success",
        `Repaired ${result.repaired_count} copied task ${
          result.repaired_count === 1 ? "date" : "dates"
        }.`,
      );
    } catch (err) {
      showMessage("error", `Task date repair failed: ${err}`);
    } finally {
      setRepairingDates(false);
    }
  };

  // ── Delete ─────────────────────────────────────────────
  const handleDelete = async () => {
    if (!selectedEventId) return;
    setDeleting(true);
    try {
      await dataManagementApi.deleteEvent(selectedEventId);
      setSelectedEventId(null);
      await refreshEvents();
      setShowDeleteConfirm(false);
      router.push("/");
    } catch (err) {
      showMessage("error", `Delete failed: ${err}`);
    } finally {
      setDeleting(false);
    }
  };

  // ── Factory Reset ──────────────────────────────────────
  const handleFactoryReset = async () => {
    if (resetInput !== "RESET") return;
    setResetting(true);
    try {
      await dataManagementApi.factoryReset();
      setSelectedEventId(null);
      setShowResetConfirm(false);
      router.push("/");
    } catch (err) {
      showMessage("error", `Reset failed: ${err}`);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-1">
          Data Management
        </h3>
        <p className="text-sm text-foreground-muted">
          Export, import, copy data between projects, or reset the application.
        </p>
      </div>

      {/* Status message */}
      {message && (
        <div
          className={`px-4 py-3 rounded-lg text-sm ${
            message.type === "success"
              ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800"
              : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* ── Section A: Transfer Data ────────────────────── */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wider">
          Transfer Data
        </h4>

        {/* Export to File */}
        <Card>
          <div className="p-5">
            <div className="flex items-start gap-3">
              <Download className="w-5 h-5 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <h5 className="font-medium text-foreground">Export to File</h5>
                <p className="text-sm text-foreground-muted mt-1">
                  Download a JSON backup of your data.
                </p>
                <div className="mt-3 flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="export-scope"
                      checked={exportScope === "event"}
                      onChange={() => setExportScope("event")}
                      className="text-blue-600"
                    />
                    This Project
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="export-scope"
                      checked={exportScope === "global"}
                      onChange={() => setExportScope("global")}
                      className="text-blue-600"
                    />
                    Application Settings
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="export-scope"
                      checked={exportScope === "full"}
                      onChange={() => setExportScope("full")}
                      className="text-blue-600"
                    />
                    Full Backup
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="export-scope"
                      checked={exportScope === "shareable"}
                      onChange={() => setExportScope("shareable")}
                      className="text-blue-600"
                    />
                    Shareable Setup
                  </label>
                </div>
                {exportScope === "event" && (
                  <p className="mt-1.5 text-xs text-foreground-faint">
                    Exports &ldquo;{currentEvent?.name || "current project"}
                    &rdquo; along with application settings.
                  </p>
                )}
                {exportScope === "global" && (
                  <p className="mt-1.5 text-xs text-foreground-faint">
                    Exports task types, capabilities, templates, and other
                    global configuration.
                  </p>
                )}
                {exportScope === "full" && (
                  <p className="mt-1.5 text-xs text-foreground-faint">
                    Exports all projects and application settings.
                  </p>
                )}
                {exportScope === "shareable" && (
                  <p className="mt-1.5 max-w-2xl text-xs leading-5 text-foreground-faint">
                    Exports reusable themes, types, capabilities, templates,
                    roles, sources, and calendar formats. Projects, people,
                    groups, locations, schedules, results, publishing details,
                    and credentials are excluded. Known identifying text is
                    removed automatically.
                  </p>
                )}
                <div className="mt-3">
                  <Button
                    size="sm"
                    onClick={handleExport}
                    disabled={
                      exporting || (exportScope === "event" && !selectedEventId)
                    }
                  >
                    {exporting ? (
                      <>
                        <Spinner size="sm" className="mr-2" /> Exporting...
                      </>
                    ) : (
                      "Export"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Import from File */}
        <Card>
          <div className="p-5">
            <div className="flex items-start gap-3">
              <Upload className="w-5 h-5 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <h5 className="font-medium text-foreground">Import from File</h5>
                <p className="text-sm text-foreground-muted mt-1">
                  Restore data from a previously exported JSON file.
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose File
                  </Button>
                  {importValidation && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowImportPreview(true)}
                    >
                      Review selected file
                    </Button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Copy from Another Project */}
        {otherEvents.length > 0 && (
          <Card>
            <div className="p-5">
              <div className="flex items-start gap-3">
                <Copy className="w-5 h-5 text-blue-600 mt-0.5" />
                <div className="flex-1">
                  <h5 className="font-medium text-foreground">
                    Copy from Another Project
                  </h5>
                  <p className="text-sm text-foreground-muted mt-1">
                    Clone data from another project into this one.
                  </p>
                  <div className="mt-3 space-y-3">
                    <select
                      value={copySourceId ?? ""}
                      onChange={(e) => {
                        setCopySourceId(
                          e.target.value ? Number(e.target.value) : null,
                        );
                        setRepairPreview(null);
                        setRepairSelection([]);
                      }}
                      className="block w-full max-w-xs rounded-lg border-bordercl-strong text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    >
                      <option value="">Select source project...</option>
                      {otherEvents.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.name}
                        </option>
                      ))}
                    </select>

                    {copySourceId && (
                      <>
                        <div className="flex flex-wrap gap-3">
                          {[
                            { key: "persons", label: "Persons" },
                            { key: "locations", label: "Locations" },
                            { key: "groups", label: "Groups" },
                            { key: "task_structure", label: "Task Structure" },
                            {
                              key: "enabled_capabilities",
                              label: "Enabled Capabilities",
                            },
                          ].map((opt) => (
                            <label
                              key={opt.key}
                              className="flex items-center gap-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={copyInclude.includes(opt.key)}
                                onChange={() => toggleCopyInclude(opt.key)}
                                className="rounded text-blue-600"
                              />
                              {opt.label}
                            </label>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={handleCopy}
                            disabled={copying || copyInclude.length === 0}
                          >
                            {copying ? (
                              <>
                                <Spinner size="sm" className="mr-2" /> Copying...
                              </>
                            ) : (
                              "Copy"
                            )}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={openRepairPreview}
                            disabled={loadingRepairPreview}
                          >
                            {loadingRepairPreview ? (
                              <>
                                <Spinner size="sm" className="mr-2" /> Checking...
                              </>
                            ) : (
                              <>
                                <Wrench className="mr-2 h-4 w-4" /> Review copied task dates
                              </>
                            )}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* ── Section B: Danger Zone ──────────────────────── */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-red-600 uppercase tracking-wider">
          Danger Zone
        </h4>

        {/* Delete This Project */}
        {currentEvent && (
          <Card className="border-red-200 dark:border-red-800">
            <div className="p-5">
              <div className="flex items-start gap-3">
                <Trash2 className="w-5 h-5 text-red-500 mt-0.5" />
                <div className="flex-1">
                  <h5 className="font-medium text-foreground">
                    Delete This Project
                  </h5>
                  <p className="text-sm text-foreground-muted mt-1">
                    Permanently delete &ldquo;{currentEvent.name}&rdquo; and all
                    its data. This cannot be undone.
                  </p>
                  <div className="mt-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="!text-red-600 !border-red-300 hover:!bg-red-50 dark:bg-red-950/30"
                    >
                      Delete Project
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Factory Reset */}
        <Card className="border-red-200 dark:border-red-800">
          <div className="p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5" />
              <div className="flex-1">
                <h5 className="font-medium text-foreground">Factory Reset</h5>
                <p className="text-sm text-foreground-muted mt-1">
                  Delete ALL data - every project, all settings, OAuth
                  credentials. Restores the app to a fresh state.
                </p>
                <div className="mt-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowResetConfirm(true)}
                    className="!text-red-600 !border-red-300 hover:!bg-red-50 dark:bg-red-950/30"
                  >
                    Factory Reset
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <ImportPreviewModal
        open={showImportPreview}
        fileName={importFileName}
        validation={importValidation}
        importing={importing}
        onCancel={clearImportPreview}
        onChooseAnother={chooseAnotherImportFile}
        onConfirm={handleImport}
      />

      <CopiedTaskDateRepairModal
        preview={repairPreview}
        selectedTaskIds={repairSelection}
        repairing={repairingDates}
        onToggleTask={toggleRepairSelection}
        onCancel={() => {
          setRepairPreview(null);
          setRepairSelection([]);
        }}
        onConfirm={applyTaskDateRepair}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        maxWidth="sm"
      >
        <div className="p-6">
          <h2 className="text-lg font-semibold text-foreground">
            Delete Project
          </h2>
          <p className="mt-2 text-sm text-foreground-muted">
            Are you sure you want to permanently delete &ldquo;
            {currentEvent?.name}&rdquo;? All persons, locations, tasks,
            assignments and optimisation data will be lost.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => setShowDeleteConfirm(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="!bg-red-600 hover:!bg-red-700"
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Factory Reset Confirmation Modal */}
      <Modal
        open={showResetConfirm}
        onClose={() => {
          setShowResetConfirm(false);
          setResetInput("");
        }}
        maxWidth="sm"
      >
        <div className="p-6">
          <h2 className="text-lg font-semibold text-red-600 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            Factory Reset
          </h2>
          <p className="mt-2 text-sm text-foreground-muted">
            This will permanently delete <strong>all</strong> projects,
            settings, and data. This cannot be undone.
          </p>
          <p className="mt-3 text-sm text-foreground-muted">
            Type <span className="font-mono font-bold">RESET</span> to confirm:
          </p>
          <Input
            value={resetInput}
            onChange={(e) => setResetInput(e.target.value)}
            placeholder="Type RESET"
            className="mt-2"
          />
          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setShowResetConfirm(false);
                setResetInput("");
              }}
              disabled={resetting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleFactoryReset}
              disabled={resetting || resetInput !== "RESET"}
              className="!bg-red-600 hover:!bg-red-700"
            >
              {resetting ? "Resetting..." : "Reset Everything"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
