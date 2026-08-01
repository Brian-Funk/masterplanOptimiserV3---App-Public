"use client";

import { useState, useEffect } from "react";
import { Button, Input, Card, Tooltip } from "@/components/ui";
import { appSettingsApi } from "@/lib/api";
import { ExternalLink, CheckCircle, AlertTriangle, Trash2 } from "lucide-react";

export function GoogleOAuthSection({
  onStatusChanged,
}: {
  onStatusChanged?: () => void;
}) {
  const [configured, setConfigured] = useState(false);
  const [clientIdPreview, setClientIdPreview] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const status = await appSettingsApi.getGoogleOAuth();
      setConfigured(status.configured);
      setClientIdPreview(status.client_id_preview);
    } catch {
      // Not configured yet
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      setError("Both Client ID and Client Secret are required.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await appSettingsApi.setGoogleOAuth(clientId.trim(), clientSecret.trim());
      setConfigured(true);
      setClientIdPreview(clientId.trim().substring(0, 6) + "****");
      setClientId("");
      setClientSecret("");
      setMessage("Google OAuth credentials saved successfully.");
      onStatusChanged?.();
    } catch (e: any) {
      setError(e.message || "Failed to save credentials.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (
      !confirm(
        "Remove Google OAuth credentials? Google Calendar integration will stop working.",
      )
    )
      return;
    setError("");
    setMessage("");
    try {
      await appSettingsApi.deleteGoogleOAuth();
      setConfigured(false);
      setClientIdPreview(null);
      setMessage("Google OAuth credentials removed.");
      onStatusChanged?.();
    } catch (e: any) {
      setError(e.message || "Failed to remove credentials.");
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-1">
            Google OAuth
          </h3>
          <p className="text-sm text-foreground-muted">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-1">
          Google OAuth Credentials
        </h3>
        <p className="text-sm text-foreground-muted">
          Configure Google OAuth2 credentials to enable Google Calendar
          integration. These are stored securely in the application database.
        </p>
      </div>

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

      {/* Current status */}
      <Card>
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {configured ? (
                <>
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Credentials configured
                    </p>
                    <p className="text-xs text-foreground-muted">
                      Client ID: {clientIdPreview}
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
                      Google Calendar features are disabled until credentials
                      are set.
                    </p>
                  </div>
                </>
              )}
            </div>
            {configured && (
              <Tooltip content="Remove credentials" side="top">
                <button
                  onClick={handleDelete}
                  className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 dark:bg-red-950/30 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </Card>

      {/* Setup form */}
      <Card>
        <div className="p-4 space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-1">
              {configured ? "Update Credentials" : "Set Up Credentials"}
            </h4>
            <p className="text-xs text-foreground-muted">
              Create OAuth2 credentials at the{" "}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline inline-flex items-center gap-1"
              >
                Google Cloud Console
                <ExternalLink className="w-3 h-3" />
              </a>
              . Use application type <strong>Web application</strong> with
              redirect URI:{" "}
              <code className="text-xs bg-surface-inset px-1.5 py-0.5 rounded">
                http://localhost:8000/api/v1/google/oauth2callback
              </code>
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Client ID
              </label>
              <Input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="123456789-xxxxx.apps.googleusercontent.com"
                className="font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Client Secret
              </label>
              <Input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="GOCSPX-xxxxxxxxxxxx"
                className="font-mono text-sm"
              />
            </div>
          </div>

          <Button
            variant="primary"
            onClick={handleSave}
            disabled={saving || !clientId.trim() || !clientSecret.trim()}
          >
            {saving
              ? "Saving..."
              : configured
                ? "Update Credentials"
                : "Save Credentials"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
