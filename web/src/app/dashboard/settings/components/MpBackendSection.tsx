"use client";

import { useState, useEffect } from "react";
import { Button, Card, Input, Tooltip } from "@/components/ui";
import { useEvent } from "@/contexts/EventContext";
import {
  mpBackendApi,
  MpBackendSettings,
  MpBackendPingResult,
  MpBackendDataPolicy,
} from "@/lib/api";
import {
  CheckCircle,
  AlertTriangle,
  Trash2,
  Send,
  Download,
  RefreshCw,
  Globe,
  Server,
  ShieldCheck,
} from "lucide-react";

export function MpBackendSection() {
  const { selectedEventId, availableEvents } = useEvent();
  const selectedEvent =
    availableEvents.find((e) => e.id === selectedEventId) || null;

  const [settings, setSettings] = useState<MpBackendSettings | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [publishSecret, setPublishSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [syncingDeletion, setSyncingDeletion] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pingResult, setPingResult] = useState<MpBackendPingResult | null>(
    null,
  );
  const [dataPolicy, setDataPolicy] = useState<MpBackendDataPolicy | null>(null);
  const [acknowledgingPolicy, setAcknowledgingPolicy] = useState(false);

  useEffect(() => {
    if (selectedEventId) {
      loadSettings();
    } else {
      setSettings(null);
      setLoading(false);
    }
  }, [selectedEventId]);

  const loadSettings = async () => {
    if (!selectedEventId) return;
    setLoading(true);
    try {
      const s = await mpBackendApi.getSettings(selectedEventId);
      setSettings(s);
      setServerUrl(s.server_url || "");
      // Don't populate secret  -  it's masked
      setPublishSecret("");
      if (s.configured) {
        try {
          setDataPolicy(await mpBackendApi.getDataPolicy(selectedEventId));
        } catch (policyError) {
          setDataPolicy(null);
          setError(
            policyError instanceof Error
              ? policyError.message
              : "The Server permitted-data policy is unavailable.",
          );
        }
      } else {
        setDataPolicy(null);
      }
    } catch {
      // Not configured yet
      setSettings(null);
      setDataPolicy(null);
    } finally {
      setLoading(false);
    }
  };

  const handlePolicyAcknowledgement = async () => {
    if (!selectedEventId || !dataPolicy) return;
    setAcknowledgingPolicy(true);
    setError("");
    try {
      await mpBackendApi.acknowledgeDataPolicy(
        selectedEventId,
        dataPolicy.policy_version,
        dataPolicy.policy_sha256,
      );
      setDataPolicy(await mpBackendApi.getDataPolicy(selectedEventId));
      setMessage("Exact Server permitted-data policy acknowledged for this local installation.");
    } catch (policyError) {
      setError(policyError instanceof Error ? policyError.message : "Policy acknowledgement failed");
    } finally {
      setAcknowledgingPolicy(false);
    }
  };

  const handleSave = async () => {
    if (!serverUrl.trim()) {
      setError("Server URL is required");
      return;
    }
    // If already configured and no new secret entered, warn
    if (settings?.configured && !publishSecret.trim()) {
      setError("Enter the publish secret to update settings");
      return;
    }
    if (!publishSecret.trim()) {
      setError("Publish secret is required");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await mpBackendApi.saveSettings(
        selectedEventId!,
        serverUrl.trim(),
        publishSecret.trim(),
      );
      setSettings(result);
      setPublishSecret("");
      setMessage("Settings saved!");
      setPingResult(null);
    } catch (e: any) {
      setError(e.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setError("");
    setMessage("");
    try {
      await mpBackendApi.deleteSettings(selectedEventId!);
      setSettings(null);
      setServerUrl("");
      setPublishSecret("");
      setPingResult(null);
      setMessage("Settings removed");
    } catch (e: any) {
      setError(e.message || "Failed to remove settings");
    }
  };

  const handlePing = async () => {
    setPinging(true);
    setError("");
    setMessage("");
    setPingResult(null);
    try {
      const result = await mpBackendApi.ping(selectedEventId!);
      setPingResult(result);
      if (result.status === "ok") {
        setMessage(`Connected to "${result.event_name}"`);
      } else if (result.status === "auth_failed") {
        setError("Authentication failed  -  check your publish secret");
      } else if (result.status === "unreachable") {
        setError("Server unreachable  -  check the URL");
      } else {
        setError(`Connection test returned: ${result.status}`);
      }
    } catch (e: any) {
      setError(e.message || "Ping failed");
    } finally {
      setPinging(false);
    }
  };

  const handlePublish = async () => {
    if (!selectedEventId) {
      setError("No event selected");
      return;
    }
    setPublishing(true);
    setError("");
    setMessage("");
    try {
      const result = await mpBackendApi.publish(selectedEventId);
      setMessage(
        `Published: ${result.tasks_created} tasks, ${result.persons_created} persons`,
      );
    } catch (e: any) {
      setError(e.message || "Publish failed");
    } finally {
      setPublishing(false);
    }
  };

  const handleDeletionSync = async () => {
    if (!selectedEventId) {
      setError("No event selected");
      return;
    }
    setSyncingDeletion(true);
    setError("");
    setMessage("");
    try {
      const result = await mpBackendApi.syncDeletionWorkOrders(
        selectedEventId,
      );
      setMessage(
        `Deletion requests processed: ${result.applied}; reports sent: ${result.reports_sent}; reports pending: ${result.reports_pending}`,
      );
    } catch (e: any) {
      setError(e.message || "Deletion request synchronisation failed");
    } finally {
      setSyncingDeletion(false);
    }
  };

  const handleDeletionRetry = async () => {
    setSyncingDeletion(true);
    setError("");
    setMessage("");
    try {
      const result = await mpBackendApi.retryDeletionReports();
      setMessage(
        `Deletion reports sent: ${result.reports_sent}; reports pending: ${result.reports_pending}`,
      );
    } catch (e: any) {
      setError(e.message || "Deletion report retry failed");
    } finally {
      setSyncingDeletion(false);
    }
  };

  const handleExportSetup = async () => {
    if (!selectedEventId) {
      setError("No event selected");
      return;
    }
    setExporting(true);
    setError("");
    try {
      const data = await mpBackendApi.exportSetup(selectedEventId);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `server-setup-${data.event.name.replace(/\s+/g, "-").toLowerCase()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage("Setup file downloaded");
    } catch (e: any) {
      setError(e.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="text-sm text-foreground-muted">Loading settings…</div>
    );
  }

  if (!selectedEventId) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-1">
            MP-Backend Server
          </h3>
          <p className="text-sm text-foreground-muted">
            Select an event to configure publishing. Privacy reports can still
            be retried after a whole-event erasure removed the local event.
          </p>
        </div>
        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300">
            {error}
          </div>
        )}
        {message && (
          <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm text-green-800 dark:text-green-300">
            {message}
          </div>
        )}
        <Card>
          <div className="p-4 space-y-3">
            <p className="text-xs text-foreground-muted">
              This sends only already committed, privacy-safe deletion reports
              from the encrypted local outbox.
            </p>
            <Button variant="outline" onClick={handleDeletionRetry} disabled={syncingDeletion}>
              <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
              {syncingDeletion ? "Retrying deletion reports…" : "Retry pending deletion reports"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-1">
          MP-Backend Server
        </h3>
        <p className="text-sm text-foreground-muted">
          Connect to the Masterplan Optimiser web server to publish schedules
          for participants to view online.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300">
          {error}
        </div>
      )}
      {message && (
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm text-green-800 dark:text-green-300">
          {message}
        </div>
      )}

      {/* Connection status */}
      <Card>
        <div className="p-4">
          <div className="flex items-center gap-3">
            {settings?.configured ? (
              <>
                {pingResult?.status === "ok" ? (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                ) : (
                  <Server className="w-5 h-5 text-blue-500" />
                )}
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Server configured
                  </p>
                  <p className="text-xs text-foreground-muted">
                    {settings.server_url}
                    {pingResult?.status === "ok" &&
                      pingResult.event_name &&
                      ` → ${pingResult.event_name}`}
                  </p>
                </div>
              </>
            ) : (
              <>
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Not configured
                  </p>
                  <p className="text-xs text-foreground-muted">
                    Enter the server URL and publish secret to connect.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Settings form */}
      <Card>
        <div className="p-4 space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-1">
              Connection Settings
            </h4>
            <p className="text-xs text-foreground-muted">
              Get these from your server administrator. The publish secret
              authenticates this app to push data to a specific event on the
              server.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Server URL
              </label>
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-foreground-faint flex-shrink-0" />
                <input
                  type="url"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="https://mp-opt.net"
                  className="flex-1 px-3 py-2 text-sm border border-bordercl-strong rounded-md bg-surface focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Publish Secret
                {settings?.configured && settings.secret_preview && (
                  <span className="ml-2 text-xs text-foreground-faint font-normal">
                    Current: {settings.secret_preview}
                  </span>
                )}
              </label>
              <input
                type="password"
                value={publishSecret}
                onChange={(e) => setPublishSecret(e.target.value)}
                placeholder={
                  settings?.configured
                    ? "Enter new secret to update"
                    : "Paste the publish secret"
                }
                className="w-full px-3 py-2 text-sm border border-bordercl-strong rounded-md bg-surface focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {settings?.configured && (
              <>
                <Button
                  variant="outline"
                  onClick={handlePing}
                  disabled={pinging}
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 mr-1.5 ${pinging ? "animate-spin" : ""}`}
                  />
                  {pinging ? "Testing…" : "Test Connection"}
                </Button>
                <Tooltip content="Remove settings" side="top">
                  <button
                    onClick={handleDelete}
                    className="p-2 text-red-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </Tooltip>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Publish  -  only when configured */}
      {settings?.configured && (
        <Card>
          <div className="p-4 space-y-4">
            {dataPolicy && (
              <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                <h4 className="font-semibold">Exact permitted-data policy</h4>
                <p className="mt-1">{dataPolicy.purpose}</p>
                <p className="mt-1">Allowed: {dataPolicy.allowed.join(", ") || "none stated"}.</p>
                <p className="mt-1">Unsupported: {dataPolicy.unsupported.join(", ") || "none stated"}.</p>
                <p className="mt-2 break-all font-mono text-xs">Version {dataPolicy.policy_version}; SHA-256 {dataPolicy.policy_sha256}</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <a className="underline" href={dataPolicy.policy_url} target="_blank" rel="noreferrer">Open permanent exact policy</a>
                  {!dataPolicy.acknowledged ? (
                    <Button variant="outline" onClick={handlePolicyAcknowledgement} disabled={acknowledgingPolicy}>
                      {acknowledgingPolicy ? "Recording..." : "I reviewed necessity and permitted audiences"}
                    </Button>
                  ) : (
                    <span className="font-medium text-green-700 dark:text-green-300">Acknowledged by this pseudonymous Desktop installation</span>
                  )}
                </div>
              </section>
            )}
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-1">
                Publish to Server
              </h4>
              <p className="text-xs text-foreground-muted">
                Push the current event&apos;s schedule, persons, and theme to
                the web server. This replaces any previously published data.
                {selectedEvent && (
                  <span className="font-medium">
                    {" "}
                    Event: {selectedEvent.name}
                  </span>
                )}
              </p>
            </div>

            <Button
              variant="primary"
              onClick={handlePublish}
              disabled={publishing || !selectedEventId || !dataPolicy?.acknowledged}
            >
              <Send className="w-3.5 h-3.5 mr-1.5" />
              {publishing ? "Publishing…" : "Publish to Server"}
            </Button>
          </div>
        </Card>
      )}

      {settings?.configured && (
        <Card>
          <div className="p-4 space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-1">
                Privacy deletion requests
              </h4>
              <p className="text-xs text-foreground-muted">
                Check for deletion requests authorised on the server. Matching
                personal data is deleted from this desktop database in one
                transaction, then a report containing only identifiers,
                counters and outstanding external actions is sent to the
                server. Failed report delivery is retried from the durable
                local outbox.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleDeletionSync}
              disabled={syncingDeletion || !selectedEventId}
            >
              <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
              {syncingDeletion
                ? "Processing deletion requests…"
                : "Process deletion requests"}
            </Button>
          </div>
        </Card>
      )}

      {/* Export Server Setup  -  always available */}
      <Card>
        <div className="p-4 space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-1">
              Export Server Setup
            </h4>
            <p className="text-xs text-foreground-muted">
              Download a JSON file with event details and persons as suggested
              user accounts. Give this to the server administrator to bootstrap
              the event on the server.
              {selectedEvent && (
                <span className="font-medium">
                  {" "}
                  Event: {selectedEvent.name}
                </span>
              )}
            </p>
          </div>

          <Button
            variant="outline"
            onClick={handleExportSetup}
            disabled={exporting || !selectedEventId}
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            {exporting ? "Exporting…" : "Export Server Setup"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
