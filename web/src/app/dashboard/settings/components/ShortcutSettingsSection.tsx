"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Edit3,
  Keyboard,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useShortcuts } from "@/contexts/ShortcutContext";
import {
  SHORTCUT_DEFINITIONS,
  ShortcutBindingMap,
  ShortcutDefinition,
  ShortcutId,
  buildShortcutOverrides,
  detectShortcutConflicts,
  resolveShortcutBindings,
  shortcutFromKeyboardEvent,
} from "@/lib/shortcuts";

const GROUP_ORDER = [
  "Global",
  "Optimised Schedule",
  "CMI",
  "Optimisation",
  "Schedule",
  "Presentation",
  "Calendar Export Editor",
];

const FIXED_SHORTCUT_HINTS = [
  {
    id: "cmi.optimiseAllDaysModifier",
    scope: "cmi",
    group: "CMI",
    label: "Optimise all days",
    description:
      "Hold Shift while clicking Optimise day to check and optimise every event day in order.",
    gesture: "Shift + click",
  },
] as const;

function ShortcutPill({
  value,
  conflict = false,
}: {
  value: string;
  conflict?: boolean;
}) {
  return (
    <span
      className={`inline-flex min-w-[5.5rem] items-center justify-center rounded-md border px-2 py-1 text-xs font-semibold ${
        conflict
          ? "border-red-400 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
          : "border-bordercl bg-surface-hover text-foreground"
      }`}
    >
      {value || "Unassigned"}
    </span>
  );
}

export function ShortcutSettingsSection() {
  const {
    bindings,
    loading,
    error,
    saveShortcutOverrides,
    resetShortcutOverrides,
  } = useShortcuts();
  const [draftBindings, setDraftBindings] =
    useState<ShortcutBindingMap>(() => resolveShortcutBindings({}));
  const [editingId, setEditingId] = useState<ShortcutId | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDraftBindings(bindings);
  }, [bindings]);

  const conflicts = useMemo(
    () => detectShortcutConflicts(draftBindings),
    [draftBindings],
  );
  const conflictCount = conflicts.size;
  const changedCount = SHORTCUT_DEFINITIONS.filter(
    (definition) =>
      draftBindings[definition.id] !== definition.defaultBinding,
  ).length;
  const dirty = SHORTCUT_DEFINITIONS.some(
    (definition) => draftBindings[definition.id] !== bindings[definition.id],
  );

  const groupedDefinitions = useMemo(() => {
    const groups = new Map<string, ShortcutDefinition[]>();
    for (const definition of SHORTCUT_DEFINITIONS) {
      const current = groups.get(definition.group) || [];
      current.push(definition);
      groups.set(definition.group, current);
    }
    return GROUP_ORDER.map((group) => ({
      group,
      definitions: groups.get(group) || [],
    })).filter((group) => group.definitions.length > 0);
  }, []);

  const setBinding = (id: ShortcutId, value: string) => {
    setDraftBindings((current) => ({
      ...current,
      [id]: value,
    }));
    setMessage("");
  };

  const handleCapture = (
    id: ShortcutId,
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Backspace" || event.key === "Delete") {
      setBinding(id, "");
      setEditingId(null);
      return;
    }

    const nextBinding = shortcutFromKeyboardEvent(event);
    if (!nextBinding) return;
    setBinding(id, nextBinding);
    setEditingId(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const overrides = buildShortcutOverrides(draftBindings);
      await saveShortcutOverrides(overrides);
      setMessage("Shortcut changes saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to save shortcuts.");
    } finally {
      setSaving(false);
    }
  };

  const handleResetAll = async () => {
    setSaving(true);
    setMessage("");
    try {
      await resetShortcutOverrides();
      setDraftBindings(resolveShortcutBindings({}));
      setEditingId(null);
      setMessage("Shortcuts reset to defaults.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to reset shortcuts.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-hover text-foreground">
              <Keyboard className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground">
                Keyboard Shortcuts
              </h2>
              <p className="text-sm text-foreground-secondary">
                Customise app-wide shortcuts. Fixed interaction shortcuts are
                also shown for reference.
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="rounded-lg border border-bordercl bg-surface px-3 py-2">
            <div className="text-xs text-foreground-tertiary">Total</div>
            <div className="text-lg font-semibold text-foreground">
              {SHORTCUT_DEFINITIONS.length + FIXED_SHORTCUT_HINTS.length}
            </div>
          </div>
          <div className="rounded-lg border border-bordercl bg-surface px-3 py-2">
            <div className="text-xs text-foreground-tertiary">Changed</div>
            <div className="text-lg font-semibold text-foreground">
              {changedCount}
            </div>
          </div>
          <div
            className={`rounded-lg border px-3 py-2 ${
              conflictCount
                ? "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                : "border-bordercl bg-surface text-foreground"
            }`}
          >
            <div className="text-xs opacity-75">Conflicts</div>
            <div className="text-lg font-semibold">{conflictCount}</div>
          </div>
        </div>
      </div>

      {(error || message || dirty) && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            error
              ? "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
              : "border-bordercl bg-surface-hover text-foreground-secondary"
          }`}
        >
          {error || message || "You have unsaved shortcut changes."}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={!dirty || saving || loading}
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : "Save changes"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setDraftBindings(bindings);
            setEditingId(null);
            setMessage("");
          }}
          disabled={!dirty || saving}
        >
          <X className="h-4 w-4" />
          Discard
        </Button>
        <Button variant="ghost" onClick={handleResetAll} disabled={saving}>
          <RotateCcw className="h-4 w-4" />
          Reset all
        </Button>
      </div>

      <div className="space-y-5">
        {groupedDefinitions.map(({ group, definitions }) => (
          <Card key={group} className="overflow-hidden">
            <div className="border-b border-bordercl px-5 py-4">
              <h3 className="text-base font-semibold text-foreground">
                {group}
              </h3>
            </div>
            <div className="divide-y divide-bordercl">
              {definitions.map((definition) => {
                const shortcutId = definition.id as ShortcutId;
                const currentBinding = draftBindings[shortcutId] || "";
                const conflictDefinitions = conflicts.get(shortcutId) || [];
                const hasConflict = conflictDefinitions.length > 0;
                const isEditing = editingId === shortcutId;

                return (
                  <div
                    key={shortcutId}
                    data-testid={`shortcut-row-${definition.id}`}
                    className={`grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_7rem_7rem_minmax(10rem,auto)] lg:items-center ${
                      hasConflict
                        ? "border-l-4 border-red-500 bg-red-50/70 dark:bg-red-950/20"
                        : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-medium text-foreground">
                          {definition.label}
                        </h4>
                        <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-foreground-tertiary">
                          {definition.scope}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-foreground-secondary">
                        {definition.description}
                      </p>
                      {hasConflict && (
                        <div
                          data-testid={`shortcut-conflict-${definition.id}`}
                          className="mt-2 flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-300"
                        >
                          <AlertTriangle className="h-4 w-4" />
                          Conflicts with:{" "}
                          {conflictDefinitions
                            .map((item) => item.label)
                            .join(", ")}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="mb-1 text-xs text-foreground-tertiary">
                        Default
                      </div>
                      <ShortcutPill value={definition.defaultBinding} />
                    </div>

                    <div>
                      <div className="mb-1 text-xs text-foreground-tertiary">
                        Current
                      </div>
                      <span
                        data-testid={`shortcut-binding-${definition.id}`}
                        className="inline-flex"
                      >
                        <ShortcutPill
                          value={currentBinding}
                          conflict={hasConflict}
                        />
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      {isEditing ? (
                        <button
                          type="button"
                          autoFocus
                          data-testid={`shortcut-capture-${definition.id}`}
                          onKeyDown={(event) =>
                            handleCapture(shortcutId, event)
                          }
                          onBlur={() => setEditingId(null)}
                          className="rounded-lg border-2 border-dashed border-bordercl-strong px-3 py-1.5 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          Press shortcut
                        </button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Edit ${definition.label}`}
                          onClick={() => setEditingId(shortcutId)}
                        >
                          <Edit3 className="h-4 w-4" />
                          Edit
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Clear ${definition.label}`}
                        onClick={() => setBinding(shortcutId, "")}
                        disabled={!currentBinding}
                      >
                        <Trash2 className="h-4 w-4" />
                        Clear
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Reset ${definition.label}`}
                        onClick={() =>
                          setBinding(shortcutId, definition.defaultBinding)
                        }
                        disabled={currentBinding === definition.defaultBinding}
                      >
                        <RotateCcw className="h-4 w-4" />
                        Reset
                      </Button>
                    </div>
                  </div>
                );
              })}
              {FIXED_SHORTCUT_HINTS.filter(
                (hint) => hint.group === group,
              ).map((hint) => (
                <div
                  key={hint.id}
                  data-testid={`shortcut-row-${hint.id}`}
                  className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_14rem_minmax(10rem,auto)] lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-medium text-foreground">
                        {hint.label}
                      </h4>
                      <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-foreground-tertiary">
                        {hint.scope}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-foreground-secondary">
                      {hint.description}
                    </p>
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-foreground-tertiary">
                      Gesture
                    </div>
                    <ShortcutPill value={hint.gesture} />
                  </div>
                  <div className="flex lg:justify-end">
                    <span className="rounded-full border border-bordercl bg-surface-alt px-3 py-1 text-xs font-medium text-foreground-secondary">
                      Built in
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
