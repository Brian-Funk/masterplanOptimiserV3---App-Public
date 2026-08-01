"use client";

import { useState, useEffect } from "react";
import { Button, Card } from "@/components/ui";
import { appSettingsApi } from "@/lib/api";
import { RotateCcw } from "lucide-react";

interface SolverSettings {
  max_time_seconds: number;
  break_threshold_min: number;
  break_recovery_bonus: number;
  fatigue_scale: number;
}

const DEFAULTS: SolverSettings = {
  max_time_seconds: 30,
  break_threshold_min: 30,
  break_recovery_bonus: -3.0,
  fatigue_scale: 100,
};

const FLOW_CHECK_MODE_KEY = "flow-check-mode";
export type FlowCheckMode = "skip-floating" | "always-full";

export function getFlowCheckMode(): FlowCheckMode {
  if (typeof window === "undefined") return "skip-floating";
  return (
    (localStorage.getItem(FLOW_CHECK_MODE_KEY) as FlowCheckMode) ||
    "skip-floating"
  );
}

export function SolverSettingsSection() {
  const [settings, setSettings] = useState<SolverSettings>(DEFAULTS);
  const [original, setOriginal] = useState<SolverSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [flowCheckMode, setFlowCheckMode] =
    useState<FlowCheckMode>("skip-floating");

  // Load flow-check mode from localStorage on mount
  useEffect(() => {
    setFlowCheckMode(getFlowCheckMode());
  }, []);

  const handleFlowCheckModeChange = (mode: FlowCheckMode) => {
    setFlowCheckMode(mode);
    localStorage.setItem(FLOW_CHECK_MODE_KEY, mode);
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const data = await appSettingsApi.getSolverSettings();
      setSettings(data);
      setOriginal(data);
    } catch {
      // Use defaults on error
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage("");
      const data = await appSettingsApi.setSolverSettings(settings);
      setSettings(data);
      setOriginal(data);
      setMessage("Solver settings saved.");
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      setSaving(true);
      setMessage("");
      await appSettingsApi.resetSolverSettings();
      setSettings(DEFAULTS);
      setOriginal(DEFAULTS);
      setMessage("Solver settings reset to defaults.");
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const isDirty =
    settings.max_time_seconds !== original.max_time_seconds ||
    settings.break_threshold_min !== original.break_threshold_min ||
    settings.break_recovery_bonus !== original.break_recovery_bonus ||
    settings.fatigue_scale !== original.fatigue_scale;

  if (loading) {
    return (
      <div className="text-sm text-foreground-muted p-4">
        Loading solver settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-1">
          Solver Tuning
        </h3>
        <p className="text-sm text-foreground-muted">
          Configure optimisation solver parameters. Changes apply to the next
          optimisation run.
        </p>
      </div>

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

      <Card>
        <div className="p-4 space-y-5">
          {/* Max Solve Time */}
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">
              Max Solve Time (seconds)
            </label>
            <p className="text-xs text-foreground-muted mb-2">
              Maximum time the solver will spend searching for an optimal
              solution. Higher values may find better solutions but take longer.
            </p>
            <input
              type="number"
              min={1}
              max={3600}
              step={1}
              value={settings.max_time_seconds}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  max_time_seconds: Number(e.target.value),
                }))
              }
              className="w-full px-3 py-2 border rounded-lg text-foreground text-sm border-bordercl-strong focus:outline-none focus:ring-2 focus:border-transparent"
            />
            <div className="flex gap-2 mt-1.5">
              {[10, 30, 60, 120].map((v) => (
                <button
                  key={v}
                  onClick={() =>
                    setSettings((s) => ({ ...s, max_time_seconds: v }))
                  }
                  className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                    settings.max_time_seconds === v
                      ? "bg-blue-50 dark:bg-blue-950/30 border-blue-300 text-blue-700"
                      : "border-bordercl text-foreground-muted hover:border-bordercl-strong"
                  }`}
                >
                  {v}s
                </button>
              ))}
            </div>
          </div>

          {/* Break Threshold */}
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">
              Break Threshold (minutes)
            </label>
            <p className="text-xs text-foreground-muted mb-2">
              Minimum idle time between tasks for a period to count as a rest
              break. Breaks reduce accumulated fatigue.
            </p>
            <input
              type="number"
              min={1}
              max={240}
              step={5}
              value={settings.break_threshold_min}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  break_threshold_min: Number(e.target.value),
                }))
              }
              className="w-full px-3 py-2 border rounded-lg text-foreground text-sm border-bordercl-strong focus:outline-none focus:ring-2 focus:border-transparent"
            />
            <div className="flex gap-2 mt-1.5">
              {[15, 30, 45, 60].map((v) => (
                <button
                  key={v}
                  onClick={() =>
                    setSettings((s) => ({ ...s, break_threshold_min: v }))
                  }
                  className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                    settings.break_threshold_min === v
                      ? "bg-blue-50 dark:bg-blue-950/30 border-blue-300 text-blue-700"
                      : "border-bordercl text-foreground-muted hover:border-bordercl-strong"
                  }`}
                >
                  {v}min
                </button>
              ))}
            </div>
          </div>

          {/* Break Recovery Bonus */}
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">
              Break Recovery Bonus
            </label>
            <p className="text-xs text-foreground-muted mb-2">
              Fatigue points recovered per break (negative value = fatigue
              reduction). A stronger bonus incentivizes the solver to schedule
              more breaks.
            </p>
            <input
              type="number"
              min={-100}
              max={0}
              step={0.5}
              value={settings.break_recovery_bonus}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  break_recovery_bonus: Number(e.target.value),
                }))
              }
              className="w-full px-3 py-2 border rounded-lg text-foreground text-sm border-bordercl-strong focus:outline-none focus:ring-2 focus:border-transparent"
            />
            <div className="flex gap-2 mt-1.5">
              {[-1, -3, -5, -10].map((v) => (
                <button
                  key={v}
                  onClick={() =>
                    setSettings((s) => ({ ...s, break_recovery_bonus: v }))
                  }
                  className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                    settings.break_recovery_bonus === v
                      ? "bg-blue-50 dark:bg-blue-950/30 border-blue-300 text-blue-700"
                      : "border-bordercl text-foreground-muted hover:border-bordercl-strong"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Fatigue Scale */}
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">
              Fatigue Scale Factor
            </label>
            <p className="text-xs text-foreground-muted mb-2">
              Integer scaling factor for the CP-SAT solver (which only works
              with integers). Higher values give more precision but increase
              solver complexity. Default: 100.
            </p>
            <input
              type="number"
              min={1}
              max={10000}
              step={10}
              value={settings.fatigue_scale}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  fatigue_scale: Number(e.target.value),
                }))
              }
              className="w-full px-3 py-2 border rounded-lg text-foreground text-sm border-bordercl-strong focus:outline-none focus:ring-2 focus:border-transparent"
            />
          </div>
        </div>
      </Card>

      {/* Flow Check Mode */}
      <div className="mt-6">
        <h3 className="text-lg font-semibold text-foreground mb-1">
          Flow Check Mode
        </h3>
        <p className="text-sm text-foreground-muted mb-3">
          Controls how the automatic flow checker handles floating tasks.
        </p>
        <Card>
          <div className="p-4 space-y-3">
            <label
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                flowCheckMode === "skip-floating"
                  ? "bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700"
                  : "border-bordercl hover:border-bordercl-strong"
              }`}
            >
              <input
                type="radio"
                name="flowCheckMode"
                checked={flowCheckMode === "skip-floating"}
                onChange={() => handleFlowCheckModeChange("skip-floating")}
                className="mt-0.5"
              />
              <div>
                <div className="text-sm font-medium text-foreground">
                  Fast auto-check, full check before optimise{" "}
                  <span className="text-xs font-normal text-foreground-muted">
                    (default)
                  </span>
                </div>
                <p className="text-xs text-foreground-muted mt-0.5">
                  Auto-checks skip floating task candidate expansion for speed.
                  A full check (including floating tasks) runs automatically
                  before optimisation starts.
                </p>
              </div>
            </label>
            <label
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                flowCheckMode === "always-full"
                  ? "bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700"
                  : "border-bordercl hover:border-bordercl-strong"
              }`}
            >
              <input
                type="radio"
                name="flowCheckMode"
                checked={flowCheckMode === "always-full"}
                onChange={() => handleFlowCheckModeChange("always-full")}
                className="mt-0.5"
              />
              <div>
                <div className="text-sm font-medium text-foreground">
                  Always full check
                </div>
                <p className="text-xs text-foreground-muted mt-0.5">
                  Every auto-check includes floating task candidate expansion.
                  More thorough but slower on complex schedules.
                </p>
              </div>
            </label>
          </div>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={saving || !isDirty}
        >
          {saving ? "Saving..." : "Save Settings"}
        </Button>
        <Button variant="outline" onClick={handleReset} disabled={saving}>
          <RotateCcw className="w-4 h-4 mr-2" />
          Reset to Defaults
        </Button>
      </div>
    </div>
  );
}
