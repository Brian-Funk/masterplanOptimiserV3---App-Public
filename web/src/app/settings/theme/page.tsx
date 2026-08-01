"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Card, Badge } from "@/components/ui";
import { useTheme } from "@/contexts/ThemeContext";
import { getApiUrl } from "@/lib/environment";
import { Monitor, Sun, Moon } from "lucide-react";

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

// Moved outside the component so React doesn't re-create it on every render
function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
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
          className="flex-1 font-mono text-sm w-full px-3 py-2 border rounded-lg text-foreground placeholder-foreground-faint transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent border-bordercl-strong"
        />
      </div>
    </div>
  );
}

export default function ThemeSettingsPage() {
  const router = useRouter();
  const { theme, refreshTheme } = useTheme();
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [formData, setFormData] = useState<ThemeSettings>({
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

  useEffect(() => {
    // Session-based auth - no token check needed; AuthContext handles redirects

    if (theme) {
      setFormData({
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
  }, [theme, router]);

  const handleSave = async () => {
    setIsSaving(true);
    setMessage("");

    try {
      const response = await fetch(`${getApiUrl()}/api/v1/theme/${theme?.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setMessage("Theme updated successfully!");
        await refreshTheme();
      } else {
        const error = await response.json();
        setMessage(`Error: ${error.detail || "Failed to update theme"}`);
      }
    } catch (error) {
      setMessage("Network error. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-alt">
      <nav className="bg-surface shadow-sm border-b border-bordercl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-violet-600 rounded-lg" />
              <h1 className="text-xl font-semibold text-foreground">
                Masterplan Optimiser - Theme Settings
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/dashboard")}
              >
                Back to Dashboard
              </Button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h2 className="text-3xl font-semibold text-foreground mb-2">
            Customise Theme Colours
          </h2>
          <p className="text-foreground-muted">
            Configure your brand colours and semantic colours for the entire
            application.
          </p>
        </div>

        {message && (
          <div
            className={`mb-6 p-4 rounded-lg ${
              message.startsWith("Error")
                ? "bg-red-50 dark:bg-red-950/30 text-red-800"
                : "bg-green-50 dark:bg-green-950/30 text-green-800"
            }`}
          >
            {message}
          </div>
        )}

        <div className="space-y-6">
          {/* Theme Name */}
          <Card>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                Theme Name
              </h3>
              <Input
                label="Name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="My Custom Theme"
              />
            </div>
          </Card>

          {/* Appearance Mode */}
          <Card>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                Appearance
              </h3>
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
                      setFormData({ ...formData, dark_mode: value })
                    }
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      formData.dark_mode === value
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
            <div className="p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                Primary Brand Colours
              </h3>
              <div className="space-y-4">
                <ColorPicker
                  label="Primary Colour 1"
                  value={formData.primary_color_1}
                  onChange={(value) =>
                    setFormData({ ...formData, primary_color_1: value })
                  }
                />
                <ColorPicker
                  label="Primary Colour 2"
                  value={formData.primary_color_2}
                  onChange={(value) =>
                    setFormData({ ...formData, primary_color_2: value })
                  }
                />
                <ColorPicker
                  label="Primary Colour 3"
                  value={formData.primary_color_3}
                  onChange={(value) =>
                    setFormData({ ...formData, primary_color_3: value })
                  }
                />
              </div>
              <p className="mt-4 text-sm text-foreground-muted">
                Primary colours are used for main UI elements like buttons,
                links, and highlights.
              </p>
            </div>
          </Card>

          {/* Semantic Colors */}
          <Card>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                Semantic Colours
              </h3>
              <div className="space-y-4">
                <ColorPicker
                  label="Success"
                  value={formData.success_color}
                  onChange={(value) =>
                    setFormData({ ...formData, success_color: value })
                  }
                />
                <ColorPicker
                  label="Warning"
                  value={formData.warning_color}
                  onChange={(value) =>
                    setFormData({ ...formData, warning_color: value })
                  }
                />
                <ColorPicker
                  label="Error"
                  value={formData.error_color}
                  onChange={(value) =>
                    setFormData({ ...formData, error_color: value })
                  }
                />
                <ColorPicker
                  label="Info"
                  value={formData.info_color}
                  onChange={(value) =>
                    setFormData({ ...formData, info_color: value })
                  }
                />
              </div>
              <p className="mt-4 text-sm text-foreground-muted">
                Semantic colours are used for status indicators, alerts, and
                notifications.
              </p>
            </div>
          </Card>

          {/* Preview */}
          <Card>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                Preview
              </h3>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-foreground-muted mb-2">Buttons:</p>
                  <div className="flex gap-3">
                    <Button variant="primary">Primary</Button>
                    <Button variant="secondary">Secondary</Button>
                    <Button variant="outline">Outline</Button>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-foreground-muted mb-2">Badges:</p>
                  <div className="flex gap-3">
                    <Badge variant="primary">Primary</Badge>
                    <Badge variant="secondary">Secondary</Badge>
                    <Badge variant="success">Success</Badge>
                    <Badge variant="warning">Warning</Badge>
                    <Badge variant="danger">Error</Badge>
                    <Badge variant="neutral">Info</Badge>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={isSaving}
              className="min-w-32"
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
            <Button variant="outline" onClick={() => router.push("/dashboard")}>
              Cancel
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
