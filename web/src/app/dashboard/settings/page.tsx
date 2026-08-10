"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Card, Badge, Tooltip } from "@/components/ui";
import { useTheme } from "@/contexts/ThemeContext";
import { useEvent } from "@/contexts/EventContext";
import {
  eventsApi,
  googleCalendarApi,
  appSettingsApi,
  mpBackendApi,
  GoogleCalendarConnection,
  GoogleCalendar,
  type PublishDestination,
  type PublishTarget,
} from "@/lib/api";
import { getApiUrl } from "@/lib/environment";
import {
  confidenceClasses,
  getPublishTargetConfidence,
  type ConfidenceDescriptor,
} from "@/lib/confidence";
import {
  ArrowLeft,
  Calendar,
  Palette,
  Settings2,
  List,
  FileText,
  Layers,
  Wrench,
  Trash2,
  ExternalLink,
  RefreshCw,
  FileOutput,
  FileDown,
  Monitor,
  Database,
  KeyRound,
  AlertTriangle,
  CheckCircle,
  SlidersHorizontal,
  Sun,
  Moon,
  Globe,
  Send,
  Keyboard,
  ShieldCheck,
} from "lucide-react";
import { EventConfigSection } from "./components/EventConfigSection";
import { TaskTypesSection } from "./components/TaskTypesSection";
import { SessionElementTypesSection } from "./components/SessionElementTypesSection";
import { TaskTemplatesSection } from "./components/TaskTemplatesSection";
import { CapabilityTypesSection } from "./components/CapabilityTypesSection";
import { CapabilitiesSection } from "./components/CapabilitiesSection";
import { CalendarPersonLinking } from "./components/CalendarPersonLinking";
import { ExportFormatSection } from "./components/ExportFormatSection";
import { DataManagementSection } from "./components/DataManagementSection";
import { GoogleOAuthSection } from "./components/GoogleOAuthSection";
import { SolverSettingsSection } from "./components/SolverSettingsSection";
import { MpBackendSection } from "./components/MpBackendSection";
import { ShortcutSettingsSection } from "./components/ShortcutSettingsSection";
import { ProcessorEvidenceSection } from "./components/ProcessorEvidenceSection";
import { PdfExportSection } from "./components/PdfExportSection";
import { getPdfExportDirectory, isPdfExportAvailable } from "@/lib/pdfExport";

interface ThemeSettings {
  name: string;
  primary_color_1: string;
  primary_color_2: string;
  primary_color_3: string;
  success_color: string;
  warning_color: string;
  error_color: string;
  info_color: string;
  dark_mode: "light" | "dark" | "system";
}

type SettingsSection =
  | "event"
  | "task-types"
  | "session-element-types"
  | "task-templates"
  | "capability-types"
  | "capabilities"
  | "theme"
  | "google-oauth"
  | "calendar"
  | "mp-backend"
  | "pdf"
  | "publish-target"
  | "format"
  | "solver"
  | "shortcuts"
  | "operator-evidence"
  | "data-management";

const SETTINGS_SECTIONS: SettingsSection[] = [
  "event",
  "task-types",
  "session-element-types",
  "task-templates",
  "capability-types",
  "capabilities",
  "theme",
  "google-oauth",
  "calendar",
  "mp-backend",
  "pdf",
  "publish-target",
  "format",
  "solver",
  "shortcuts",
  "operator-evidence",
  "data-management",
];

// ── Moved outside the component so React doesn't re-create it on every render
function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <label className="w-40 text-sm font-medium text-foreground-secondary">
        {label}
      </label>
      <div className="flex items-center gap-3 flex-1">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-16 h-10 rounded border border-bordercl-strong cursor-pointer"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          pattern="^#[0-9A-Fa-f]{6}$"
          className="flex-1 font-mono text-sm w-full px-3 py-2 border rounded-lg text-foreground placeholder-foreground-faint transition-colors duration-200 focus:outline-none focus:ring-2 focus:border-transparent border-bordercl-strong"
        />
      </div>
    </div>
  );
}

// ── Inline OAuth Card for Google Calendar Publishing ──────────────────
function GoogleCalendarOAuthCard({
  eventId,
  currentCalendarId,
  onCalendarIdChanged,
  onConnectionsChanged,
}: {
  eventId: number;
  currentCalendarId: string | null;
  onCalendarIdChanged: (calendarId: string | null) => void;
  onConnectionsChanged: () => void;
}) {
  const [connections, setConnections] = useState<GoogleCalendarConnection[]>(
    [],
  );
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<
    number | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingOAuthState, setPendingOAuthState] = useState<string | null>(
    null,
  );
  const pendingOAuthStateRef = useRef<string | null>(null);

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    const handleOAuthMessage = async (data: any) => {
      if (
        data?.type !== "google-calendar-callback" ||
        typeof data.code !== "string" ||
        typeof data.state !== "string"
      ) {
        return;
      }

      const expectedState = pendingOAuthStateRef.current;
      if (!expectedState || data.state !== expectedState) {
        setError("OAuth callback state did not match the active connection.");
        return;
      }

      try {
        await googleCalendarApi.handleCallback(data.code, data.state);
        await loadConnections();
        onConnectionsChanged();
        setMessage("Google account connected successfully!");
      } catch (e: any) {
        console.error("[OAuth] handleCallback FAILED:", e);
        setError(e.message || "OAuth callback failed.");
      } finally {
        pendingOAuthStateRef.current = null;
        setPendingOAuthState(null);
      }
    };

    // Primary: window.opener.postMessage from popup
    const handleMessage = (event: MessageEvent) => {
      const allowedOrigins = new Set([
        "http://127.0.0.1:8000",
        "http://localhost:8000",
      ]);
      if (!allowedOrigins.has(event.origin)) return;
      handleOAuthMessage(event.data);
    };
    window.addEventListener("message", handleMessage);

    // Fallback: BroadcastChannel for Electron (window.opener may be null)
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("google-oauth");
      bc.onmessage = (event) => {
        handleOAuthMessage(event.data);
      };
    } catch {
      console.warn("[OAuth] BroadcastChannel not supported");
    }

    return () => {
      window.removeEventListener("message", handleMessage);
      bc?.close();
    };
  }, [onConnectionsChanged]);

  const loadConnections = async () => {
    try {
      const data = await googleCalendarApi.getConnections();
      setConnections(data);
      const matched = data.find(
        (c) => c.calendar_id && c.calendar_id === currentCalendarId,
      );
      if (matched) {
        setSelectedConnectionId(matched.id);
        loadCalendars(matched.id);
      } else if (data.length === 1) {
        setSelectedConnectionId(data[0].id);
        loadCalendars(data[0].id);
      }
    } catch {
      // No connections yet
    }
  };

  const loadCalendars = async (connectionId: number) => {
    try {
      const cals = await googleCalendarApi.listCalendars(connectionId);
      setCalendars(cals);
    } catch (e: any) {
      setError(`Failed to list calendars: ${e.message}`);
      setCalendars([]);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { auth_url, state } = await googleCalendarApi.connect();
      pendingOAuthStateRef.current = state;
      setPendingOAuthState(state);
      window.open(auth_url, "_blank", "width=600,height=700");
    } catch (e: any) {
      pendingOAuthStateRef.current = null;
      setPendingOAuthState(null);
      setError(e.message || "Failed to start connection.");
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async (connectionId: number) => {
    try {
      await googleCalendarApi.deleteConnection(connectionId);
      setConnections((prev) => prev.filter((c) => c.id !== connectionId));
      onConnectionsChanged();
      if (selectedConnectionId === connectionId) {
        setSelectedConnectionId(null);
        setCalendars([]);
      }
      const conn = connections.find((c) => c.id === connectionId);
      if (conn?.calendar_id === currentCalendarId) {
        handleSetCalendar("");
      }
    } catch (e: any) {
      setError(e.message || "Failed to disconnect.");
    }
  };

  const handleSetCalendar = async (calendarId: string) => {
    if (!selectedConnectionId) return;
    setError("");
    try {
      if (calendarId) {
        const cal = calendars.find((c) => c.id === calendarId);
        await googleCalendarApi.setCalendar(
          selectedConnectionId,
          calendarId,
          cal?.summary || "",
        );
      }
      const response = await fetch(
        `${getApiUrl()}/api/v1/events/${eventId}/calendar`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ google_calendar_id: calendarId || null }),
        },
      );
      if (!response.ok) throw new Error("Failed to update event calendar");
      onCalendarIdChanged(calendarId || null);
      onConnectionsChanged();
      setMessage(
        calendarId
          ? "Calendar selected for publishing!"
          : "Calendar publishing disabled.",
      );
    } catch (e: any) {
      setError(e.message || "Failed to set calendar.");
    }
  };

  return (
    <>
      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {connections.length > 0 ? (
                <>
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {connections.length} account
                      {connections.length !== 1 ? "s" : ""} connected
                    </p>
                    <p className="text-xs text-foreground-muted">
                      {connections.map((c) => c.account_email).join(", ")}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      No accounts connected
                    </p>
                    <p className="text-xs text-foreground-muted">
                      Connect a Google account to publish tasks as calendar
                      events.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>

      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {message && (
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm text-green-800">
          {message}
        </div>
      )}

      <Card>
        <div className="p-4 space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-1">
              Google Calendar Publishing
            </h4>
            <p className="text-xs text-foreground-muted">
              Connect a Google account with OAuth to publish tasks as Google
              Calendar events.
            </p>
          </div>

          {connections.length > 0 && (
            <div className="space-y-2">
              {connections.map((conn) => (
                <div
                  key={conn.id}
                  className="flex items-center justify-between p-3 border border-bordercl rounded-lg text-sm"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span className="font-medium text-foreground">
                      {conn.account_email}
                    </span>
                    {conn.calendar_name && (
                      <span className="text-foreground-muted text-xs">
                        &rarr; {conn.calendar_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Tooltip content="Refresh calendars" side="top">
                      <button
                        onClick={() => {
                          setSelectedConnectionId(conn.id);
                          loadCalendars(conn.id);
                        }}
                        className="p-1 text-foreground-faint hover:text-foreground-muted"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>
                    <Tooltip content="Disconnect" side="top">
                      <button
                        onClick={() => handleDisconnect(conn.id)}
                        className="p-1 text-red-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedConnectionId && calendars.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Publish to Calendar
              </label>
              <select
                value={currentCalendarId || ""}
                onChange={(e) => handleSetCalendar(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-bordercl-strong rounded-md bg-surface"
              >
                <option value="">- No calendar (publishing disabled) -</option>
                {calendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.summary}
                    {cal.primary ? " (Primary)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Button
            variant="primary"
            onClick={handleConnect}
            disabled={loading || Boolean(pendingOAuthState)}
          >
            {loading ? (
              "Connecting..."
            ) : (
              <>
                <ExternalLink className="w-3.5 h-3.5 mr-1" />
                {pendingOAuthState
                  ? "Waiting for Google..."
                  : connections.length > 0
                  ? "Connect Another Account"
                  : "Connect Google Account"}
              </>
            )}
          </Button>
        </div>
      </Card>
    </>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme, refreshTheme } = useTheme();

  const requestedSection = searchParams.get("section") as SettingsSection | null;
  const initialSection =
    requestedSection && SETTINGS_SECTIONS.includes(requestedSection)
      ? requestedSection
      : "event";
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // ── Event state (from shared context) ────────────────────────────
  const { selectedEventId, availableEvents, refreshEvents } = useEvent();
  const selectedEvent =
    availableEvents.find((e) => e.id === selectedEventId) || null;

  // ── Theme state ───────────────────────────────────────────────────
  const [themeForm, setThemeForm] = useState<ThemeSettings>({
    name: "Default Theme",
    primary_color_1: "#2563eb",
    primary_color_2: "#7c3aed",
    primary_color_3: "#0891b2",
    success_color: "#10b981",
    warning_color: "#f59e0b",
    error_color: "#ef4444",
    info_color: "#3b82f6",
    dark_mode: "light",
  });

  // ── Google Calendar connection state ────────────────────────────────
  const [calConnections, setCalConnections] = useState<
    GoogleCalendarConnection[]
  >([]);

  // ── Google OAuth configured status ────────────────────────────────
  const [oauthConfigured, setOauthConfigured] = useState(false);

  // ── MP-Backend configured status ──────────────────────────────────
  const [mpBackendConfigured, setMpBackendConfigured] = useState(false);

  // ── Publish target state ──────────────────────────────────────────
  const [publishTarget, setPublishTarget] = useState<PublishTarget>([]);
  const [publishTargetLoading, setPublishTargetLoading] = useState(false);
  const [pdfReady, setPdfReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPdfExportDirectory().then((directory) => {
      if (!cancelled) {
        setPdfReady(Boolean(selectedEventId && isPdfExportAvailable() && directory.available));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedEventId]);

  useEffect(() => {
    const nextSection = searchParams.get("section") as SettingsSection | null;
    if (nextSection && SETTINGS_SECTIONS.includes(nextSection)) {
      setSection(nextSection);
    }
  }, [searchParams]);

  // ── Load calendar connections, OAuth status, and MP-Backend status on mount
  useEffect(() => {
    loadCalConnections();
    loadOauthStatus();
    loadMpBackendStatus();
    loadPublishTarget();
  }, []);

  useEffect(() => {
    if (theme) {
      setThemeForm({
        name: theme.name,
        primary_color_1: theme.primary_color_1,
        primary_color_2: theme.primary_color_2 || "#7c3aed",
        primary_color_3: theme.primary_color_3 || "#0891b2",
        success_color: theme.success_color,
        warning_color: theme.warning_color,
        error_color: theme.error_color,
        info_color: theme.info_color,
        dark_mode: (theme as any).dark_mode || "light",
      });
    }
  }, [theme]);

  const loadCalConnections = async () => {
    try {
      const data = await googleCalendarApi.getConnections();
      setCalConnections(data);
    } catch (e) {
      console.error("Failed to load calendar connections:", e);
    }
  };

  const loadOauthStatus = async () => {
    try {
      const status = await appSettingsApi.getGoogleOAuth();
      setOauthConfigured(status.configured);
    } catch {
      setOauthConfigured(false);
    }
  };

  const loadMpBackendStatus = async () => {
    if (!selectedEventId) {
      setMpBackendConfigured(false);
      return;
    }
    try {
      const status = await mpBackendApi.getSettings(selectedEventId);
      setMpBackendConfigured(status.configured);
    } catch {
      setMpBackendConfigured(false);
    }
  };

  const loadPublishTarget = async () => {
    try {
      const data = await appSettingsApi.getPublishTarget();
      setPublishTarget(data.targets);
    } catch {
      setPublishTarget([]);
    }
  };

  const handlePublishTargetChange = async (destination: PublishDestination) => {
    const target = publishTarget.includes(destination)
      ? publishTarget.filter((item) => item !== destination)
      : [...publishTarget, destination];
    setPublishTargetLoading(true);
    try {
      const saved = await appSettingsApi.setPublishTarget(target);
      setPublishTarget(saved.targets);
    } catch {
      // revert on failure
    } finally {
      setPublishTargetLoading(false);
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────
  const handleEventUpdated = (updated: any) => {
    refreshEvents();
  };

  const handleSaveTheme = async () => {
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch(`${getApiUrl()}/api/v1/theme/${theme?.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(themeForm),
      });
      if (response.ok) {
        setMessage("Theme updated!");
        await refreshTheme();
      } else {
        const err = await response.json();
        setMessage(`Error: ${err.detail || "Failed to update theme"}`);
      }
    } catch (e) {
      setMessage("Network error. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const sidebarItems: {
    key: SettingsSection;
    label: string;
    icon: React.ReactNode;
    group?: string;
    subgroup?: string;
  }[] = [
    {
      key: "event",
      label: "Event",
      icon: <Settings2 className="w-4 h-4" />,
      group: "General",
    },
    {
      key: "task-types",
      label: "Task Types",
      icon: <List className="w-4 h-4" />,
      group: "Configuration",
    },
    {
      key: "session-element-types",
      label: "Schedule Item Types",
      icon: <Calendar className="w-4 h-4" />,
      group: "Configuration",
    },
    {
      key: "task-templates",
      label: "Task Templates",
      icon: <FileText className="w-4 h-4" />,
      group: "Configuration",
    },
    {
      key: "capability-types",
      label: "Capability Types",
      icon: <Layers className="w-4 h-4" />,
      group: "Configuration",
    },
    {
      key: "capabilities",
      label: "Capabilities",
      icon: <Wrench className="w-4 h-4" />,
      group: "Configuration",
    },
    {
      key: "theme",
      label: "Theme & Colours",
      icon: <Palette className="w-4 h-4" />,
      group: "Appearance",
    },
    {
      key: "google-oauth",
      label: "Google OAuth",
      icon: <KeyRound className="w-4 h-4" />,
      group: "Integrations",
      subgroup: "Google Calendar",
    },
    {
      key: "calendar",
      label: "Calendar Connection",
      icon: <Calendar className="w-4 h-4" />,
      group: "Integrations",
      subgroup: "Google Calendar",
    },
    {
      key: "format",
      label: "Export Format",
      icon: <FileOutput className="w-4 h-4" />,
      group: "Integrations",
      subgroup: "Google Calendar",
    },
    {
      key: "mp-backend",
      label: "MP-Backend Server",
      icon: <Globe className="w-4 h-4" />,
      group: "Integrations",
      subgroup: "MP-Backend",
    },
    {
      key: "pdf",
      label: "PDF Export",
      icon: <FileDown className="w-4 h-4" />,
      group: "Integrations",
      subgroup: "PDF",
    },
    {
      key: "publish-target",
      label: "Publish Target",
      icon: <Send className="w-4 h-4" />,
      group: "Integrations",
    },
    {
      key: "solver",
      label: "Solver Tuning",
      icon: <SlidersHorizontal className="w-4 h-4" />,
      group: "System",
    },
    {
      key: "shortcuts",
      label: "Shortcuts",
      icon: <Keyboard className="w-4 h-4" />,
      group: "System",
    },
    {
      key: "operator-evidence",
      label: "Evidence Keys",
      icon: <ShieldCheck className="w-4 h-4" />,
      group: "System",
    },
    {
      key: "data-management",
      label: "Data Management",
      icon: <Database className="w-4 h-4" />,
      group: "System",
    },
  ];

  const sidebarGroups = [
    "General",
    "Configuration",
    "Appearance",
    "Integrations",
    "System",
  ];

  const publishTargetOptions: Array<{
    value: PublishDestination;
    label: string;
    description: string;
    enabled: boolean;
    disabledHint: string;
  }> = [
    {
      value: "google",
      label: "Google Calendar",
      description: "Publish tasks as Google Calendar events.",
      enabled: calConnections.some((c) => !!c.calendar_id),
      disabledHint: "Connect a Google Calendar first.",
    },
    {
      value: "mp-backend",
      label: "MP-Backend Server",
      description: "Publish to the web server for participants.",
      enabled: mpBackendConfigured,
      disabledHint: "Configure the MP-Backend connection first.",
    },
    {
      value: "pdf",
      label: "PDF",
      description: "Create a local light-mode A4 landscape schedule PDF.",
      enabled: pdfReady,
      disabledHint: "Choose an available PDF output folder first.",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/dashboard/admin")}
            className="p-2 text-foreground-muted hover:text-foreground-secondary hover:bg-surface-hover rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Settings</h2>
            <p className="text-sm text-foreground-muted">
              Configure event, tasks, capabilities, theme, and integrations
            </p>
          </div>
        </div>
      </div>

      {/* Message bar */}
      {message && (
        <div
          className={`p-3 rounded-lg text-sm ${
            message.startsWith("Error")
              ? "bg-red-50 dark:bg-red-950/30 text-red-800 border border-red-200 dark:border-red-800"
              : "bg-green-50 dark:bg-green-950/30 text-green-800 border border-green-200 dark:border-green-800"
          }`}
        >
          {message}
        </div>
      )}

      {/* Main content with sidebar */}
      <div className="bg-surface rounded-lg shadow-sm border border-bordercl flex min-h-[600px]">
        {/* Sidebar */}
        <div className="w-56 border-r border-bordercl">
          <nav className="p-4 space-y-4">
            {sidebarGroups.map((group) => {
              const items = sidebarItems.filter((i) => i.group === group);
              if (items.length === 0) return null;

              // Collect unique subgroups in order, plus ungrouped items
              const subgroups: (string | null)[] = [];
              items.forEach((item) => {
                const sg = item.subgroup || null;
                if (!subgroups.includes(sg)) subgroups.push(sg);
              });

              return (
                <div key={group}>
                  <div className="text-xs font-semibold text-foreground-faint uppercase tracking-wider px-3 mb-1">
                    {group}
                  </div>
                  <div className="space-y-0.5">
                    {subgroups.map((sg) => {
                      const subItems = items.filter(
                        (i) => (i.subgroup || null) === sg,
                      );
                      return (
                        <div key={sg || "__none"}>
                          {sg && (
                            <div className="text-[10px] font-medium text-foreground-faint uppercase tracking-wider px-3 pt-2 pb-0.5">
                              {sg}
                            </div>
                          )}
                          {subItems.map((item) => (
                            <button
                              key={item.key}
                              onClick={() => {
                                setSection(item.key);
                                setMessage("");
                              }}
                              className={`w-full text-left ${sg ? "pl-5 pr-3" : "px-3"} py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                                section === item.key
                                  ? "bg-blue-100 text-blue-700"
                                  : "text-foreground-secondary hover:bg-surface-hover"
                              }`}
                            >
                              {item.icon}
                              {item.label}
                              {item.key === "calendar" && (
                                <div
                                  className={`w-2 h-2 rounded-full ml-auto ${calConnections.some((c) => !!c.calendar_id) ? "bg-green-500" : "bg-bordercl-strong"}`}
                                />
                              )}
                              {item.key === "google-oauth" && (
                                <div
                                  className={`w-2 h-2 rounded-full ml-auto ${oauthConfigured ? "bg-green-500" : "bg-bordercl-strong"}`}
                                />
                              )}
                              {item.key === "mp-backend" && (
                                <div
                                  className={`w-2 h-2 rounded-full ml-auto ${mpBackendConfigured ? "bg-green-500" : "bg-bordercl-strong"}`}
                                />
                              )}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 p-6">
          {/* ── Event Settings ──────────────────────────────────────── */}
          {section === "event" && selectedEvent && (
            <div>
              <EventConfigSection
                selectedEvent={selectedEvent}
                onEventUpdated={handleEventUpdated}
              />
            </div>
          )}

          {/* ── Task Types ─────────────────────────────────────────── */}
          {section === "task-types" && (
            <div>
              <TaskTypesSection />
            </div>
          )}

          {/* ── Task Templates ─────────────────────────────────────── */}
          {section === "session-element-types" && (
            <div>
              <SessionElementTypesSection eventId={selectedEvent?.id} />
            </div>
          )}

          {section === "task-templates" && (
            <div>
              <TaskTemplatesSection />
            </div>
          )}

          {/* ── Capability Types ───────────────────────────────────── */}
          {section === "capability-types" && (
            <div>
              <CapabilityTypesSection />
            </div>
          )}

          {/* ── Capabilities ───────────────────────────────────────── */}
          {section === "capabilities" && (
            <div>
              <CapabilitiesSection />
            </div>
          )}

          {/* ── Theme Settings ─────────────────────────────────────── */}
          {section === "theme" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-1">
                  Theme & Colours
                </h3>
                <p className="text-sm text-foreground-muted">
                  Customise brand colours and semantic colours for the
                  application.
                </p>
              </div>

              {/* Theme Name */}
              <Card>
                <div className="p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-3">
                    Theme Name
                  </h4>
                  <Input
                    value={themeForm.name}
                    onChange={(e) =>
                      setThemeForm({ ...themeForm, name: e.target.value })
                    }
                    placeholder="My Custom Theme"
                  />
                </div>
              </Card>

              {/* Appearance Mode */}
              <Card>
                <div className="p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-3">
                    Appearance
                  </h4>
                  <p className="text-sm text-foreground-muted mb-4">
                    Choose between light and dark mode, or follow your system
                    preference.
                  </p>
                  <div className="flex gap-3">
                    {(
                      [
                        { value: "light", label: "Light", icon: Sun },
                        { value: "dark", label: "Dark", icon: Moon },
                        { value: "system", label: "System", icon: Monitor },
                      ] as const
                    ).map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() =>
                          setThemeForm({ ...themeForm, dark_mode: value })
                        }
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                          themeForm.dark_mode === value
                            ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                            : "border-bordercl text-foreground-secondary hover:bg-surface-hover"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </Card>

              {/* Primary Colors */}
              <Card>
                <div className="p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-3">
                    Primary Brand Colours
                  </h4>
                  <div className="space-y-3">
                    <ColorPicker
                      label="Primary Colour 1"
                      value={themeForm.primary_color_1}
                      onChange={(v) =>
                        setThemeForm({ ...themeForm, primary_color_1: v })
                      }
                    />
                    <ColorPicker
                      label="Primary Colour 2"
                      value={themeForm.primary_color_2}
                      onChange={(v) =>
                        setThemeForm({ ...themeForm, primary_color_2: v })
                      }
                    />
                    <ColorPicker
                      label="Primary Colour 3"
                      value={themeForm.primary_color_3}
                      onChange={(v) =>
                        setThemeForm({ ...themeForm, primary_color_3: v })
                      }
                    />
                  </div>
                </div>
              </Card>

              {/* Semantic Colors */}
              <Card>
                <div className="p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-3">
                    Semantic Colours
                  </h4>
                  <div className="space-y-3">
                    <ColorPicker
                      label="Success"
                      value={themeForm.success_color}
                      onChange={(v) =>
                        setThemeForm({ ...themeForm, success_color: v })
                      }
                    />
                    <ColorPicker
                      label="Warning"
                      value={themeForm.warning_color}
                      onChange={(v) =>
                        setThemeForm({ ...themeForm, warning_color: v })
                      }
                    />
                    <ColorPicker
                      label="Error"
                      value={themeForm.error_color}
                      onChange={(v) =>
                        setThemeForm({ ...themeForm, error_color: v })
                      }
                    />
                    <ColorPicker
                      label="Info"
                      value={themeForm.info_color}
                      onChange={(v) =>
                        setThemeForm({ ...themeForm, info_color: v })
                      }
                    />
                  </div>
                </div>
              </Card>

              {/* Preview */}
              <Card>
                <div className="p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-3">
                    Preview
                  </h4>
                  <div className="flex gap-3 flex-wrap">
                    <Badge variant="primary">Primary</Badge>
                    <Badge variant="secondary">Secondary</Badge>
                    <Badge variant="success">Success</Badge>
                    <Badge variant="warning">Warning</Badge>
                    <Badge variant="danger">Error</Badge>
                  </div>
                </div>
              </Card>

              <Button
                variant="primary"
                onClick={handleSaveTheme}
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Save Theme"}
              </Button>
            </div>
          )}

          {/* ── Google Calendar ─────────────────────────────────────── */}
          {section === "calendar" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-1">
                  Google Calendar
                </h3>
                <p className="text-sm text-foreground-muted">
                  Connect a Google account via OAuth to publish tasks as
                  calendar events and manage person linking.
                </p>
              </div>

              {!oauthConfigured ? (
                <Card>
                  <div className="p-4">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-500" />
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          OAuth Credentials Required
                        </p>
                        <p className="text-xs text-foreground-muted">
                          Google Calendar integration requires OAuth credentials
                          to be configured first.
                        </p>
                        <button
                          onClick={() => setSection("google-oauth")}
                          className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Go to Google OAuth settings &rarr;
                        </button>
                      </div>
                    </div>
                  </div>
                </Card>
              ) : (
                <>
                  {/* Google Calendar OAuth Connection */}
                  {selectedEvent && (
                    <GoogleCalendarOAuthCard
                      eventId={selectedEvent.id}
                      currentCalendarId={
                        selectedEvent.google_calendar_id || null
                      }
                      onCalendarIdChanged={(calId) => refreshEvents()}
                      onConnectionsChanged={loadCalConnections}
                    />
                  )}

                  {/* Person-Calendar Linking */}
                  {selectedEvent && (
                    <CalendarPersonLinking eventId={selectedEvent.id} />
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Export Format ──────────────────────────────────────── */}
          {/* ── MP-Backend Server ─────────────────────────────────── */}
          {section === "mp-backend" && (
            <div>
              <MpBackendSection />
            </div>
          )}
          {section === "pdf" && (
            <PdfExportSection
              eventId={selectedEvent?.id}
              eventName={selectedEvent?.name}
              onReadinessChange={setPdfReady}
            />
          )}
          {/* ── Publish Target ─────────────────────────────────────── */}
          {section === "publish-target" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-1">
                  Publish Target
                </h3>
                <p className="text-sm text-foreground-muted">
                  Select any combination of destinations. Leave all three
                  unselected to keep publishing unconfigured.
                </p>
              </div>

              <Card>
                <div className="p-4 space-y-3">
                  {publishTargetOptions.map((option) => {
                    const selected = publishTarget.includes(option.value);
                    const disabled = (!option.enabled && !selected) || publishTargetLoading;
                    const confidence: ConfidenceDescriptor = option.enabled
                      ? getPublishTargetConfidence(option.value)
                      : {
                          level: "blocked",
                          label: "Blocked",
                          description: option.disabledHint,
                        };

                    return (
                      <label
                        key={option.value}
                        className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                          selected
                            ? `${confidenceClasses(confidence.level, "border")} ${confidenceClasses(confidence.level, "panel")}`
                            : "border-bordercl hover:border-bordercl-strong"
                        } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
                      >
                        <input
                          type="checkbox"
                          name="publish-target"
                          value={option.value}
                          checked={selected}
                          disabled={disabled}
                          onChange={() =>
                            handlePublishTargetChange(option.value)
                          }
                          className="mt-0.5"
                        />
                        <div className="flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-foreground">
                              {option.label}
                            </p>
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${confidenceClasses(
                                confidence.level,
                                "badge",
                              )}`}
                              title={confidence.description}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${confidenceClasses(
                                  confidence.level,
                                  "dot",
                                )}`}
                              />
                              {confidence.label}
                            </span>
                          </div>
                          <p className="text-xs text-foreground-muted">
                            {option.enabled
                              ? option.description
                              : option.disabledHint}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </Card>
            </div>
          )}
          {section === "format" && (
            <div>
              <ExportFormatSection eventId={selectedEvent?.id} />
            </div>
          )}
          {/* ── Google OAuth ───────────────────────────────────────── */}
          {section === "google-oauth" && (
            <div>
              <GoogleOAuthSection onStatusChanged={loadOauthStatus} />
            </div>
          )}
          {/* ── Solver Tuning ─────────────────────────────────────── */}
          {section === "solver" && (
            <div>
              <SolverSettingsSection />
            </div>
          )}
          {section === "shortcuts" && (
            <div>
              <ShortcutSettingsSection />
            </div>
          )}
          {section === "operator-evidence" && (
            <div>
              <ProcessorEvidenceSection />
            </div>
          )}
          {/* ── Data Management ────────────────────────────────────── */}
          {section === "data-management" && (
            <div>
              <DataManagementSection />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
