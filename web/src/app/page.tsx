"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { eventsApi, dataManagementApi, taskTypesApi } from "@/lib/api";
import type { ImportValidationResult } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ImportPreviewModal } from "@/components/import/ImportPreviewModal";
import { Spinner } from "@/components/ui/Spinner";
import { SwissDateInput } from "@/components/ui/SwissDateInput";
import ThemedLogo from "@/components/ThemedLogo";
import { Plus, Upload, MapPin, Calendar, ChevronRight } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import {
  confidenceClasses,
  getEventStatusConfidence,
} from "@/lib/confidence";
import { formatDateRange } from "@/lib/dateFormat";
import { buildInvalidJsonImportValidation } from "@/lib/importPreview";

interface HubEvent {
  id: number;
  name: string;
  location: string;
  start_date?: string;
  end_date?: string;
  status?: string;
  updated_at?: string;
}

export default function ProjectHub() {
  const router = useRouter();
  const { addToast } = useToast();
  const [events, setEvents] = useState<HubEvent[]>([]);
  const [hasConfig, setHasConfig] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLocation, setCreateLocation] = useState("");
  const [createStartDate, setCreateStartDate] = useState("");
  const [createEndDate, setCreateEndDate] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPayload, setImportPayload] = useState<Record<string, any> | null>(
    null,
  );
  const [importFileName, setImportFileName] = useState("");
  const [importValidation, setImportValidation] =
    useState<ImportValidationResult | null>(null);
  const [showImportPreview, setShowImportPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    try {
      setLoading(true);
      const [data, taskTypes] = await Promise.all([
        eventsApi.getAll(),
        taskTypesApi.getAll().catch(() => []),
      ]);
      setEvents(data as HubEvent[]);
      setHasConfig(taskTypes.length > 0);

      // Auto-skip: single event → go straight in
      if (data.length === 1) {
        sessionStorage.setItem(
          "masterplan_selected_event_id",
          String(data[0].id),
        );
        router.replace("/dashboard/admin");
        return;
      }
    } catch {
      console.error("Failed to load events");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectEvent = (id: number) => {
    sessionStorage.setItem("masterplan_selected_event_id", String(id));
    router.push("/dashboard/admin");
  };

  const handleCreate = async () => {
    if (!createName.trim() || !createStartDate || !createEndDate) return;
    setCreating(true);
    try {
      const newEvent = await eventsApi.create({
        name: createName.trim(),
        location: createLocation.trim(),
        start_date: createStartDate || undefined,
        end_date: createEndDate || undefined,
      });
      sessionStorage.setItem(
        "masterplan_selected_event_id",
        String(newEvent.id),
      );
      router.push("/dashboard/admin");
    } catch (err) {
      console.error("Failed to create event:", err);
    } finally {
      setCreating(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    let data: Record<string, any>;
    try {
      const text = await file.text();
      data = JSON.parse(text);
    } catch {
      setImportPayload(null);
      setImportValidation(buildInvalidJsonImportValidation());
      setShowImportPreview(true);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    try {
      const validation = await dataManagementApi.previewImport(data);
      setImportPayload(data);
      setImportValidation(validation);
      setShowImportPreview(true);
    } catch (err) {
      addToast(
        `Import preview failed: ${err instanceof Error ? err.message : err}`,
        "error",
      );
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
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

  const confirmImport = async () => {
    if (!importPayload) return;
    setImporting(true);
    try {
      const result = await dataManagementApi.importData(importPayload);
      addToast(result.message || "Import successful.", "success");
      clearImportPreview();

      if (result.imported_event_ids && result.imported_event_ids.length > 0) {
        sessionStorage.setItem(
          "masterplan_selected_event_id",
          String(result.imported_event_ids[0]),
        );
        router.push("/dashboard/admin");
      } else {
        await loadEvents();
      }
    } catch (err) {
      console.error("Import failed:", err);
      addToast(
        `Import failed: ${err instanceof Error ? err.message : err}`,
        "error",
      );
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-alt">
        <Spinner size="lg" />
      </div>
    );
  }

  // Zero events - welcome screen
  if (events.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface-alt px-4">
        <ThemedLogo height={64} href="https://info.mp-opt.net" />
        <h1 className="mt-6 text-2xl font-bold text-foreground">
          Welcome to Masterplan Optimiser
        </h1>
        <p className="mt-2 text-foreground-muted text-center max-w-md">
          {hasConfig
            ? "Your application settings are configured. Create a new project or import one from a file."
            : "Get started by importing a backup or application settings, or create your first project."}
        </p>
        <div className="mt-8 flex gap-3">
          {hasConfig && (
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Project
            </Button>
          )}
          <Button
            variant={hasConfig ? "secondary" : "primary"}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4 mr-2" />
            {hasConfig ? "Import Project" : "Import Backup"}
          </Button>
          {!hasConfig && (
            <Button variant="secondary" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Project
            </Button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImportFile}
        />
        {importing && (
          <div className="mt-4 flex items-center gap-2 text-sm text-foreground-muted">
            <Spinner size="sm" /> Importing...
          </div>
        )}

        {/* Create modal */}
        <CreateEventModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          name={createName}
          setName={setCreateName}
          location={createLocation}
          setLocation={setCreateLocation}
          startDate={createStartDate}
          setStartDate={setCreateStartDate}
          endDate={createEndDate}
          setEndDate={setCreateEndDate}
          creating={creating}
          onCreate={handleCreate}
        />
        <ImportPreviewModal
          open={showImportPreview}
          fileName={importFileName}
          validation={importValidation}
          importing={importing}
          onCancel={clearImportPreview}
          onChooseAnother={chooseAnotherImportFile}
          onConfirm={confirmImport}
        />
      </div>
    );
  }

  // 2+ events - card grid
  return (
    <div className="min-h-screen bg-surface-alt">
      <div className="max-w-5xl mx-auto py-12 px-6">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <ThemedLogo height={40} href="https://info.mp-opt.net" />
            <h1 className="text-2xl font-bold text-foreground">Projects</h1>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-4 h-4 mr-1" />
              Import
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-1" />
              New Project
            </Button>
          </div>
        </div>

        {importing && (
          <div className="mb-4 flex items-center gap-2 text-sm text-foreground-muted">
            <Spinner size="sm" /> Importing...
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map((ev) => {
            const statusConfidence = getEventStatusConfidence(ev.status);
            return (
              <div
                key={ev.id}
                className="cursor-pointer"
                onClick={() => handleSelectEvent(ev.id)}
              >
                <Card
                  hover
                  className={`group border-l-4 ${confidenceClasses(
                    statusConfidence.level,
                    "border",
                  )}`}
                >
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold text-foreground group-hover:text-blue-600 transition-colors">
                        {ev.name}
                      </h3>
                      <ChevronRight className="w-4 h-4 text-foreground-faint group-hover:text-blue-500 transition-colors mt-1" />
                    </div>
                    {ev.location && (
                      <div className="mt-2 flex items-center gap-1 text-sm text-foreground-muted">
                        <MapPin className="w-3.5 h-3.5" />
                        {ev.location}
                      </div>
                    )}
                    {(ev.start_date || ev.end_date) && (
                      <div className="mt-1 flex items-center gap-1 text-sm text-foreground-muted">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDateRange(ev.start_date, ev.end_date)}
                      </div>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${confidenceClasses(
                          statusConfidence.level,
                          "badge",
                        )}`}
                        title={statusConfidence.description}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${confidenceClasses(
                            statusConfidence.level,
                            "dot",
                          )}`}
                        />
                        {statusConfidence.label}
                      </span>
                    </div>
                  </div>
                </Card>
              </div>
            );
          })}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImportFile}
        />

        <CreateEventModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          name={createName}
          setName={setCreateName}
          location={createLocation}
          setLocation={setCreateLocation}
          startDate={createStartDate}
          setStartDate={setCreateStartDate}
          endDate={createEndDate}
          setEndDate={setCreateEndDate}
          creating={creating}
          onCreate={handleCreate}
        />
        <ImportPreviewModal
          open={showImportPreview}
          fileName={importFileName}
          validation={importValidation}
          importing={importing}
          onCancel={clearImportPreview}
          onChooseAnother={chooseAnotherImportFile}
          onConfirm={confirmImport}
        />
      </div>
    </div>
  );
}

function CreateEventModal({
  open,
  onClose,
  name,
  setName,
  location,
  setLocation,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  creating,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  setName: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  startDate: string;
  setStartDate: (v: string) => void;
  endDate: string;
  setEndDate: (v: string) => void;
  creating: boolean;
  onCreate: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} maxWidth="md">
      <div className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Create New Project
        </h2>
        <div className="space-y-4">
          <Input
            label="Project Name *"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Summer Conference 2025"
          />
          <Input
            label="Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Geneva Convention Centre"
          />
          <div className="grid grid-cols-2 gap-4">
            <SwissDateInput
              label="Start Date *"
              value={startDate}
              onChange={setStartDate}
            />
            <SwissDateInput
              label="End Date *"
              value={endDate}
              min={startDate || undefined}
              onChange={setEndDate}
              error={
                startDate && endDate && endDate < startDate
                  ? "End date must not be before start date"
                  : undefined
              }
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={creating}>
            Cancel
          </Button>
          <Button
            onClick={onCreate}
            disabled={
              creating ||
              !name.trim() ||
              !startDate ||
              !endDate ||
              Boolean(startDate && endDate && endDate < startDate)
            }
          >
            {creating ? "Creating..." : "Create"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
