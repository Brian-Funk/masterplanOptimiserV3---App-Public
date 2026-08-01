"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { EventProvider, useEvent } from "@/contexts/EventContext";
import { TaskInstanceProvider } from "@/contexts/TaskInstanceContext";
import { Tooltip } from "@/components/ui";
import ThemedLogo from "@/components/ThemedLogo";
import {
  Settings,
  CalendarCheck,
  ChevronDown,
  Plus,
  Upload,
  ArrowLeft,
  Check,
  Globe,
  Info,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import {
  googleCalendarApi,
  GoogleCalendarConnection,
  appSettingsApi,
  eventsApi,
  dataManagementApi,
  mpBackendApi,
} from "@/lib/api";
import type { ImportValidationResult } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { ImportPreviewModal } from "@/components/import/ImportPreviewModal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { SwissDateInput } from "@/components/ui/SwissDateInput";
import { useToast } from "@/contexts/ToastContext";
import { Spinner } from "@/components/ui/Spinner";
import { buildInvalidJsonImportValidation } from "@/lib/importPreview";

function NavBar() {
  const router = useRouter();
  const pathname = usePathname();
  const isSettings = pathname?.startsWith("/dashboard/settings");
  const {
    selectedEventId,
    setSelectedEventId,
    availableEvents,
    refreshEvents,
  } = useEvent();

  const [calConn, setCalConn] = useState<GoogleCalendarConnection | null>(null);
  const [showCalTooltip, setShowCalTooltip] = useState(false);
  const [mpBackendConfigured, setMpBackendConfigured] = useState(false);
  const [showMpTooltip, setShowMpTooltip] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);
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
  const [showAbout, setShowAbout] = useState(false);
  const [integrityResult, setIntegrityResult] = useState<{
    valid?: boolean;
    signatureOk?: boolean;
    dev?: boolean;
    error?: string;
    files?: Array<{ path: string; status: string }>;
  } | null>(null);
  const [integrityChecking, setIntegrityChecking] = useState(false);
  const { addToast } = useToast();
  const switcherRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCheckIntegrity = useCallback(async () => {
    // @ts-ignore - Electron injects this via preload
    const electron = window.electron;
    if (!electron?.checkIntegrity) return;
    setIntegrityChecking(true);
    try {
      const result = await electron.checkIntegrity();
      setIntegrityResult(result);
    } catch {
      setIntegrityResult({ valid: false, error: "Verification failed" });
    } finally {
      setIntegrityChecking(false);
    }
  }, []);

  const selectedEvent = availableEvents.find((e) => e.id === selectedEventId);

  useEffect(() => {
    googleCalendarApi
      .getConnections()
      .then((conns) => {
        const connected = conns.find((c) => !!c.calendar_id);
        setCalConn(connected || (conns.length > 0 ? conns[0] : null));
      })
      .catch(() => {});
    if (selectedEventId) {
      mpBackendApi
        .getSettings(selectedEventId)
        .then((status) => setMpBackendConfigured(status.configured))
        .catch(() => setMpBackendConfigured(false));
    } else {
      setMpBackendConfigured(false);
    }
  }, [pathname, selectedEventId]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        switcherRef.current &&
        !switcherRef.current.contains(e.target as Node)
      ) {
        setShowSwitcher(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const isConnected = !!calConn?.calendar_id;

  const handleSwitchEvent = (id: number) => {
    setSelectedEventId(id);
    setShowSwitcher(false);
    // Reload the current page with new event context
    router.refresh();
  };

  const handleCreateEvent = async () => {
    if (!createName.trim() || !createStartDate || !createEndDate) return;
    setCreating(true);
    try {
      const newEvent = await eventsApi.create({
        name: createName.trim(),
        location: createLocation.trim(),
        start_date: createStartDate || undefined,
        end_date: createEndDate || undefined,
      });
      await refreshEvents();
      setSelectedEventId(newEvent.id);
      setShowCreate(false);
      setShowSwitcher(false);
      setCreateName("");
      setCreateLocation("");
      setCreateStartDate("");
      setCreateEndDate("");
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
      await refreshEvents();
      if (result.imported_event_ids && result.imported_event_ids.length > 0) {
        setSelectedEventId(result.imported_event_ids[0]);
        router.push("/dashboard/admin");
      }
      setShowSwitcher(false);
      clearImportPreview();
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

  return (
    <nav className="bg-surface shadow-sm border-b border-bordercl">
      <div className="mx-auto max-w-[1680px] px-8 xl:px-10">
        <div className="flex justify-between h-16">
          <div className="flex items-center gap-3">
            <ThemedLogo height={48} href="https://info.mp-opt.net" />

            {/* Project switcher */}
            {selectedEvent && (
              <div ref={switcherRef} className="relative ml-2">
                <button
                  onClick={() => setShowSwitcher(!showSwitcher)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-foreground-secondary hover:bg-surface-hover transition-colors"
                >
                  <span className="max-w-[200px] truncate">
                    {selectedEvent.name}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-foreground-faint" />
                </button>

                {showSwitcher && (
                  <div className="absolute left-0 top-full mt-1 w-64 bg-surface rounded-xl shadow-lg border border-bordercl py-1 z-50">
                    {/* Event list */}
                    <div className="max-h-64 overflow-y-auto">
                      {availableEvents.map((ev) => (
                        <button
                          key={ev.id}
                          onClick={() => handleSwitchEvent(ev.id)}
                          className={`w-full text-left px-4 py-2.5 text-sm hover:bg-surface-hover flex items-center justify-between ${
                            ev.id === selectedEventId
                              ? "text-blue-600 font-medium"
                              : "text-foreground-secondary"
                          }`}
                        >
                          <span className="truncate">{ev.name}</span>
                          {ev.id === selectedEventId && (
                            <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>

                    <div className="border-t border-bordercl-subtle mt-1 pt-1">
                      <button
                        onClick={() => {
                          setShowSwitcher(false);
                          setShowCreate(true);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-foreground-muted hover:bg-surface-hover flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        New Project
                      </button>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full text-left px-4 py-2 text-sm text-foreground-muted hover:bg-surface-hover flex items-center gap-2"
                      >
                        <Upload className="w-4 h-4" />
                        Import from File
                      </button>
                      {availableEvents.length >= 2 && (
                        <button
                          onClick={() => {
                            setShowSwitcher(false);
                            router.push("/");
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-foreground-muted hover:bg-surface-hover flex items-center gap-2"
                        >
                          <ArrowLeft className="w-4 h-4" />
                          All Projects
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            {importing && <Spinner size="sm" className="mr-2" />}

            {/* Calendar status icon */}
            <div
              className="relative"
              onMouseEnter={() => setShowCalTooltip(true)}
              onMouseLeave={() => setShowCalTooltip(false)}
            >
              <button
                onClick={() =>
                  router.push("/dashboard/settings?section=calendar")
                }
                className={`p-2 rounded-lg transition-colors ${
                  isConnected
                    ? "text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30 dark:bg-green-950/30"
                    : "text-foreground-faint hover:text-foreground-muted hover:bg-surface-hover"
                }`}
              >
                <CalendarCheck className="w-5 h-5" />
              </button>
              {showCalTooltip && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                  {isConnected ? (
                    <>
                      <div className="font-semibold text-green-400">
                        Connected
                      </div>
                      {calConn.account_email &&
                        calConn.account_email !== "unknown" && (
                          <div>{calConn.account_email}</div>
                        )}
                      <div className="text-gray-300">
                        {calConn.calendar_name || calConn.calendar_id}
                      </div>
                    </>
                  ) : calConn ? (
                    <>
                      <div className="font-semibold text-yellow-400">
                        No calendar selected
                      </div>
                      {calConn.account_email &&
                        calConn.account_email !== "unknown" && (
                          <div>{calConn.account_email}</div>
                        )}
                    </>
                  ) : (
                    <div>Google Calendar not connected</div>
                  )}
                </div>
              )}
            </div>

            {/* MP-Backend status icon */}
            <div
              className="relative"
              onMouseEnter={() => setShowMpTooltip(true)}
              onMouseLeave={() => setShowMpTooltip(false)}
            >
              <button
                onClick={() =>
                  router.push("/dashboard/settings?section=mp-backend")
                }
                className={`p-2 rounded-lg transition-colors ${
                  mpBackendConfigured
                    ? "text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30 dark:bg-green-950/30"
                    : "text-foreground-faint hover:text-foreground-muted hover:bg-surface-hover"
                }`}
              >
                <Globe className="w-5 h-5" />
              </button>
              {showMpTooltip && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                  {mpBackendConfigured ? (
                    <div className="font-semibold text-green-400">
                      MP-Backend configured
                    </div>
                  ) : (
                    <div>MP-Backend not configured</div>
                  )}
                </div>
              )}
            </div>

            {/* Settings gear */}
            <Tooltip content="Settings" side="bottom">
              <button
                onClick={() =>
                  router.push(
                    isSettings ? "/dashboard/admin" : "/dashboard/settings",
                  )
                }
                className={`p-2 rounded-lg transition-colors ${
                  isSettings
                    ? "bg-blue-100 text-blue-700"
                    : "text-foreground-muted hover:text-foreground-secondary hover:bg-surface-hover"
                }`}
              >
                <Settings className="w-5 h-5" />
              </button>
            </Tooltip>

            {/* About */}
            <Tooltip content="About" side="bottom">
              <button
                onClick={() => setShowAbout(true)}
                className="p-2 rounded-lg transition-colors text-foreground-muted hover:text-foreground-secondary hover:bg-surface-hover"
              >
                <Info className="w-5 h-5" />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleImportFile}
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

      {/* About Modal */}
      <Modal open={showAbout} onClose={() => setShowAbout(false)} maxWidth="md">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            About Masterplan Optimiser
          </h2>

          <div className="space-y-4 text-sm text-foreground-secondary">
            <div className="flex items-center gap-3">
              <span className="text-foreground-muted w-20">Version</span>
              <code className="px-1.5 py-0.5 bg-surface-hover rounded text-xs">
                v{process.env.NEXT_PUBLIC_APP_VERSION}
              </code>
            </div>

            {/* Integrity verification - only in Electron */}
            {typeof window !== "undefined" &&
              // @ts-ignore - Electron injects this via preload
              window.electron?.isElectron && (
                <div className="flex items-start gap-3">
                  <span className="text-foreground-muted w-20">Integrity</span>
                  <div className="flex-1">
                    {integrityResult ? (
                      <div className="flex items-center gap-2">
                        {integrityResult.valid ? (
                          <>
                            <ShieldCheck size={16} className="text-green-500" />
                            <span className="text-green-600 dark:text-green-400 text-xs font-medium">
                              Verified
                              {integrityResult.signatureOk && " (signed)"}
                            </span>
                          </>
                        ) : (
                          <>
                            <ShieldAlert size={16} className="text-red-500" />
                            <span className="text-red-600 dark:text-red-400 text-xs font-medium">
                              {integrityResult.error ||
                                "Modified files detected"}
                            </span>
                          </>
                        )}
                        <button
                          onClick={handleCheckIntegrity}
                          disabled={integrityChecking}
                          className="ml-auto text-xs text-foreground-muted hover:text-foreground transition-colors"
                        >
                          Re-check
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={handleCheckIntegrity}
                        disabled={integrityChecking}
                        className="px-2 py-1 text-xs bg-surface-hover rounded hover:bg-surface-active transition-colors"
                      >
                        {integrityChecking ? "Checking..." : "Verify"}
                      </button>
                    )}
                    {integrityResult &&
                      !integrityResult.valid &&
                      integrityResult.files &&
                      integrityResult.files.length > 0 &&
                      (() => {
                        const problemFiles = integrityResult.files.filter(
                          (f: any) => f.status !== "ok",
                        );
                        const okCount =
                          integrityResult.files.length - problemFiles.length;
                        return (
                          <div className="mt-2 space-y-1 text-xs">
                            {problemFiles.length > 0 && (
                              <ul className="space-y-0.5">
                                {problemFiles.map((f: any) => (
                                  <li
                                    key={f.path}
                                    className="text-red-600 dark:text-red-400"
                                  >
                                    {f.status === "missing"
                                      ? "Missing"
                                      : "Modified"}
                                    : {f.path}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {okCount > 0 && (
                              <p className="text-foreground-muted">
                                {okCount} other{" "}
                                {okCount === 1 ? "file" : "files"} verified OK
                              </p>
                            )}
                          </div>
                        );
                      })()}
                  </div>
                </div>
              )}

            <div className="flex items-start gap-3">
              <span className="text-foreground-muted w-20">Author</span>
              <span>Brian Funk</span>
            </div>

            <div className="border-t border-border pt-4">
              <p className="text-foreground-muted mb-2 font-medium">
                Description
              </p>
              <p>
                Desktop scheduling and resource-allocation tool for live event
                organisers. Combines constraint-based optimisation with an
                intuitive calendar interface to plan complex multi-day events.
              </p>
            </div>

            <div className="border-t border-border pt-4">
              <p className="text-foreground-muted mb-2 font-medium">
                Technology
              </p>
              <ul className="space-y-1">
                <li>
                  <strong>Next.js</strong> &amp; <strong>React</strong> - user
                  interface
                </li>
                <li>
                  <strong>FastAPI</strong> - backend API
                </li>
                <li>
                  <strong>Google OR-Tools</strong> - constraint-based schedule
                  optimisation
                </li>
                <li>
                  <strong>Electron</strong> - desktop shell
                </li>
                <li>
                  <strong>SQLAlchemy</strong> - database access
                </li>
                <li>
                  <strong>Tailwind CSS</strong> - styling
                </li>
              </ul>
            </div>

            <div className="border-t border-border pt-4 text-xs text-foreground-faint">
              <p>&copy; {new Date().getFullYear()} Brian Funk and contributors.</p>
              <p className="mt-2">
                Licensed under <a className="text-primary underline" href="/licence">AGPL-3.0-only</a>. Read the <a className="text-primary underline" href="/third-party-notices">third-party notices</a>.
              </p>
              <p className="mt-2 break-all">
                Corresponding source: <a className="text-primary underline" href={process.env.NEXT_PUBLIC_SOURCE_URL} rel="noreferrer" target="_blank">{process.env.NEXT_PUBLIC_SOURCE_REPOSITORY_URL}@{process.env.NEXT_PUBLIC_SOURCE_REVISION}</a>
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <Button variant="secondary" onClick={() => setShowAbout(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>

      {/* Create Event Modal */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        maxWidth="md"
      >
        <div className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Create New Project
          </h2>
          <div className="space-y-4">
            <Input
              label="Project Name *"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="e.g. Summer Conference 2025"
            />
            <Input
              label="Location"
              value={createLocation}
              onChange={(e) => setCreateLocation(e.target.value)}
              placeholder="e.g. Geneva Convention Centre"
            />
            <div className="grid grid-cols-2 gap-4">
              <SwissDateInput
                label="Start Date *"
                value={createStartDate}
                onChange={setCreateStartDate}
              />
              <SwissDateInput
                label="End Date *"
                value={createEndDate}
                min={createStartDate || undefined}
                onChange={setCreateEndDate}
                error={
                  createStartDate &&
                  createEndDate &&
                  createEndDate < createStartDate
                    ? "End date must not be before start date"
                    : undefined
                }
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => setShowCreate(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateEvent}
              disabled={
                creating ||
                !createName.trim() ||
                !createStartDate ||
                !createEndDate ||
                Boolean(
                  createStartDate &&
                  createEndDate &&
                  createEndDate < createStartDate,
                )
              }
            >
              {creating ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </Modal>
    </nav>
  );
}

function EventGuard({ children }: { children: React.ReactNode }) {
  const { selectedEventId, availableEvents, isLoadingEvents } = useEvent();
  const router = useRouter();

  useEffect(() => {
    if (!isLoadingEvents && selectedEventId === null) {
      // No event selected - redirect to hub
      if (availableEvents.length !== 1) {
        router.replace("/");
      }
    }
  }, [isLoadingEvents, selectedEventId, availableEvents, router]);

  if (isLoadingEvents) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return <>{children}</>;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <EventProvider>
      <TaskInstanceProvider>
        <div className="min-h-screen bg-surface-alt">
          <NavBar />
          <EventGuard>
            <main className="mx-auto max-w-[1680px] px-8 py-7 xl:px-10 xl:py-8">
              {children}
            </main>
          </EventGuard>
        </div>
      </TaskInstanceProvider>
    </EventProvider>
  );
}
