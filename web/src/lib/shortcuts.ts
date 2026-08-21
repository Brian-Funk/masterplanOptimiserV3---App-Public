"use client";

import type React from "react";

/** Metadata for a configurable keyboard shortcut action. */
export interface ShortcutDefinition {
  id: string;
  scope: string;
  group: string;
  label: string;
  description: string;
  defaultBinding: string;
}

/** Parsed keyboard shortcut with a normalised key and modifier flags. */
export interface ShortcutBinding {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/** Built-in shortcut catalogue used by settings UI and page-level handlers. */
export const SHORTCUT_DEFINITIONS = [
  {
    id: "global.openSettings",
    scope: "global",
    group: "Global",
    label: "Open Settings",
    description: "Open the application settings page.",
    defaultBinding: "Ctrl+,",
  },
  {
    id: "global.backToDashboard",
    scope: "global",
    group: "Global",
    label: "Back to Dashboard",
    description: "Return to the main dashboard.",
    defaultBinding: "Ctrl+H",
  },
  {
    id: "optimised.openMetrics",
    scope: "optimised",
    group: "Optimised Schedule",
    label: "Open Metrics Board",
    description: "Open or focus the metrics board window.",
    defaultBinding: "Ctrl+M",
  },
  {
    id: "optimised.openPresentation",
    scope: "optimised",
    group: "Optimised Schedule",
    label: "Open Presentation",
    description: "Open or focus presentation mode for the selected day.",
    defaultBinding: "Ctrl+P",
  },
  {
    id: "optimised.publishDay",
    scope: "optimised",
    group: "Optimised Schedule",
    label: "Publish Selected Day",
    description: "Publish the currently selected optimised day.",
    defaultBinding: "Ctrl+Enter",
  },
  {
    id: "optimised.publishAllDays",
    scope: "optimised",
    group: "Optimised Schedule",
    label: "Publish All Days",
    description: "Publish all optimised days.",
    defaultBinding: "Ctrl+Shift+Enter",
  },
  {
    id: "generalSchedule.saveItem",
    scope: "general-schedule",
    group: "General Schedule",
    label: "Save Schedule Item",
    description: "Save the schedule item currently being edited.",
    defaultBinding: "Ctrl+Enter",
  },
  {
    id: "generalSchedule.saveAndAdd",
    scope: "general-schedule",
    group: "General Schedule",
    label: "Save and Add Another",
    description: "Save the current schedule item and open the next quick-add row.",
    defaultBinding: "Ctrl+Shift+Enter",
  },
  {
    id: "generalSchedule.duplicateSelected",
    scope: "general-schedule",
    group: "General Schedule",
    label: "Duplicate Selected Item",
    description: "Duplicate the single selected public schedule item.",
    defaultBinding: "Ctrl+D",
  },
  {
    id: "optimised.resetSelected",
    scope: "optimised",
    group: "Optimised Schedule",
    label: "Reset Selected to Optimised",
    description: "Restore selected tasks to their original optimised state.",
    defaultBinding: "R",
  },
  {
    id: "optimised.moveEarlier",
    scope: "optimised",
    group: "Optimised Schedule",
    label: "Move Selected Earlier",
    description: "Move selected tasks earlier by 5 minutes.",
    defaultBinding: "ArrowUp",
  },
  {
    id: "optimised.moveLater",
    scope: "optimised",
    group: "Optimised Schedule",
    label: "Move Selected Later",
    description: "Move selected tasks later by 5 minutes.",
    defaultBinding: "ArrowDown",
  },
  {
    id: "optimised.moveEarlierLarge",
    scope: "optimised",
    group: "Optimised Schedule",
    label: "Move Selected Earlier Large Step",
    description: "Move selected tasks earlier by 15 minutes.",
    defaultBinding: "Shift+ArrowUp",
  },
  {
    id: "optimised.moveLaterLarge",
    scope: "optimised",
    group: "Optimised Schedule",
    label: "Move Selected Later Large Step",
    description: "Move selected tasks later by 15 minutes.",
    defaultBinding: "Shift+ArrowDown",
  },
  {
    id: "optimised.clearSelection",
    scope: "optimised",
    group: "Optimised Schedule",
    label: "Clear Selection",
    description: "Clear selected tasks.",
    defaultBinding: "Escape",
  },
  {
    id: "cmi.toggleIgnored",
    scope: "cmi",
    group: "CMI",
    label: "Ignore or Include Selected Tasks",
    description:
      "Toggle selected tasks in flow checking and optimisation without changing them.",
    defaultBinding: "I",
  },
  {
    id: "cmi.deleteSelected",
    scope: "cmi",
    group: "CMI",
    label: "Delete Selected Tasks",
    description: "Delete selected CMI tasks.",
    defaultBinding: "Delete",
  },
  {
    id: "cmi.duplicateSelected",
    scope: "cmi",
    group: "CMI",
    label: "Duplicate Selected Tasks",
    description: "Duplicate selected CMI tasks.",
    defaultBinding: "D",
  },
  {
    id: "cmi.moveEarlier",
    scope: "cmi",
    group: "CMI",
    label: "Move Selected Earlier",
    description: "Move selected CMI tasks earlier by 5 minutes.",
    defaultBinding: "ArrowUp",
  },
  {
    id: "cmi.moveLater",
    scope: "cmi",
    group: "CMI",
    label: "Move Selected Later",
    description: "Move selected CMI tasks later by 5 minutes.",
    defaultBinding: "ArrowDown",
  },
  {
    id: "cmi.moveEarlierLarge",
    scope: "cmi",
    group: "CMI",
    label: "Move Selected Earlier Large Step",
    description: "Move selected CMI tasks earlier by 15 minutes.",
    defaultBinding: "Shift+ArrowUp",
  },
  {
    id: "cmi.moveLaterLarge",
    scope: "cmi",
    group: "CMI",
    label: "Move Selected Later Large Step",
    description: "Move selected CMI tasks later by 15 minutes.",
    defaultBinding: "Shift+ArrowDown",
  },
  {
    id: "cmi.clearSelection",
    scope: "cmi",
    group: "CMI",
    label: "Clear Selection",
    description: "Clear selected CMI tasks.",
    defaultBinding: "Escape",
  },
  {
    id: "optimisation.clearSelection",
    scope: "optimisation",
    group: "Optimisation",
    label: "Clear Selection",
    description: "Clear selected optimisation tasks.",
    defaultBinding: "Escape",
  },
  {
    id: "schedule.clearSelection",
    scope: "schedule",
    group: "Schedule",
    label: "Clear Selection",
    description: "Clear selected schedule tasks.",
    defaultBinding: "Escape",
  },
  {
    id: "presentation.previousTask",
    scope: "presentation",
    group: "Presentation",
    label: "Previous Task",
    description: "Move to the previous task in detail view.",
    defaultBinding: "ArrowLeft",
  },
  {
    id: "presentation.nextTask",
    scope: "presentation",
    group: "Presentation",
    label: "Next Task",
    description: "Move to the next task in detail view.",
    defaultBinding: "ArrowRight",
  },
  {
    id: "presentation.previousDay",
    scope: "presentation",
    group: "Presentation",
    label: "Previous Day",
    description: "Move to the previous day.",
    defaultBinding: "ArrowUp",
  },
  {
    id: "presentation.nextDay",
    scope: "presentation",
    group: "Presentation",
    label: "Next Day",
    description: "Move to the next day.",
    defaultBinding: "ArrowDown",
  },
  {
    id: "presentation.toggleView",
    scope: "presentation",
    group: "Presentation",
    label: "Toggle Calendar / Detail View",
    description: "Switch between overview and detail presentation views.",
    defaultBinding: "C",
  },
  {
    id: "presentation.toggleTaskList",
    scope: "presentation",
    group: "Presentation",
    label: "Toggle Task List",
    description: "Show or hide the task list sidebar.",
    defaultBinding: "S",
  },
  {
    id: "presentation.toggleCalendarSidebar",
    scope: "presentation",
    group: "Presentation",
    label: "Toggle Calendar Sidebar",
    description: "Show or hide the calendar sidebar.",
    defaultBinding: "R",
  },
  {
    id: "presentation.toggleFullscreen",
    scope: "presentation",
    group: "Presentation",
    label: "Toggle Fullscreen",
    description: "Enter or exit fullscreen presentation.",
    defaultBinding: "F",
  },
  {
    id: "presentation.backOrClose",
    scope: "presentation",
    group: "Presentation",
    label: "Back to Overview / Close",
    description: "Return to overview or close the presentation window.",
    defaultBinding: "Escape",
  },
  {
    id: "exportEditor.bold",
    scope: "export-editor",
    group: "Calendar Export Editor",
    label: "Bold",
    description: "Toggle bold formatting in rich text export templates.",
    defaultBinding: "Ctrl+B",
  },
  {
    id: "exportEditor.italic",
    scope: "export-editor",
    group: "Calendar Export Editor",
    label: "Italic",
    description: "Toggle italic formatting in rich text export templates.",
    defaultBinding: "Ctrl+I",
  },
  {
    id: "exportEditor.underline",
    scope: "export-editor",
    group: "Calendar Export Editor",
    label: "Underline",
    description: "Toggle underline formatting in rich text export templates.",
    defaultBinding: "Ctrl+U",
  },
  {
    id: "exportEditor.insertLink",
    scope: "export-editor",
    group: "Calendar Export Editor",
    label: "Insert Link",
    description: "Insert or edit a link in rich text export templates.",
    defaultBinding: "Ctrl+K",
  },
] as const satisfies readonly ShortcutDefinition[];

export type ShortcutId = (typeof SHORTCUT_DEFINITIONS)[number]["id"];
export type ShortcutScope = (typeof SHORTCUT_DEFINITIONS)[number]["scope"];
export type ShortcutOverrideMap = Partial<Record<ShortcutId, string>>;
export type ShortcutBindingMap = Record<ShortcutId, string>;

const MODIFIER_LABELS = {
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  meta: "Meta",
} as const;

const KEY_ALIASES: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  enter: "Enter",
  return: "Enter",
  del: "Delete",
  delete: "Delete",
  backspace: "Backspace",
  up: "ArrowUp",
  arrowup: "ArrowUp",
  down: "ArrowDown",
  arrowdown: "ArrowDown",
  left: "ArrowLeft",
  arrowleft: "ArrowLeft",
  right: "ArrowRight",
  arrowright: "ArrowRight",
  space: "Space",
  " ": "Space",
  comma: ",",
  ",": ",",
};

const definitionById = new Map(
  SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition]),
);

/** Look up a shortcut definition by its stable id. */
export function getShortcutDefinition(
  id: ShortcutId,
): ShortcutDefinition | undefined {
  return definitionById.get(id);
}

/** Normalise key aliases and single-character keys into canonical display form. */
export function normalizeShortcutKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  const alias = KEY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return trimmed;
}

/** Parse a shortcut string such as "Ctrl+Shift+Enter" into modifier flags. */
export function parseShortcutBinding(
  value: string | null | undefined,
): ShortcutBinding | null {
  if (!value) return null;
  const parts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const keyPart = parts[parts.length - 1];
  const binding: ShortcutBinding = {
    key: normalizeShortcutKey(keyPart),
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  };

  for (const part of parts.slice(0, -1)) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") binding.ctrl = true;
    if (lower === "alt" || lower === "option") binding.alt = true;
    if (lower === "shift") binding.shift = true;
    if (lower === "meta" || lower === "cmd" || lower === "command") {
      binding.meta = true;
    }
  }

  if (
    !binding.key ||
    ["Control", "Alt", "Shift", "Meta"].includes(binding.key)
  ) {
    return null;
  }
  return binding;
}

/** Format a parsed shortcut binding as a stable display string. */
export function formatShortcutBinding(binding: ShortcutBinding | null): string {
  if (!binding) return "";
  return [
    binding.ctrl ? MODIFIER_LABELS.ctrl : null,
    binding.alt ? MODIFIER_LABELS.alt : null,
    binding.shift ? MODIFIER_LABELS.shift : null,
    binding.meta ? MODIFIER_LABELS.meta : null,
    binding.key,
  ]
    .filter(Boolean)
    .join("+");
}

/** Normalise a user-entered shortcut string into the canonical persisted form. */
export function normalizeShortcutString(value: string): string {
  return formatShortcutBinding(parseShortcutBinding(value));
}

/** Convert a keyboard event into the shortcut string used by the settings UI. */
export function shortcutFromKeyboardEvent(
  event: KeyboardEvent | React.KeyboardEvent,
): string {
  const key = normalizeShortcutKey(event.key);
  if (!key || ["Control", "Alt", "Shift", "Meta"].includes(key)) return "";
  return formatShortcutBinding({
    key,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  });
}

/** Return true when a shortcut should be suppressed for text/editable targets. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    Boolean(target.isContentEditable)
  );
}

function shiftMatches(event: KeyboardEvent, binding: ShortcutBinding): boolean {
  if (binding.shift) return event.shiftKey;
  if (!event.shiftKey) return true;
  return /^[A-Z]$/.test(binding.key);
}

/** Check whether a keyboard event matches a configured shortcut binding. */
export function matchesShortcut(
  event: KeyboardEvent | React.KeyboardEvent,
  bindingValue: string | null | undefined,
): boolean {
  const binding = parseShortcutBinding(bindingValue);
  if (!binding) return false;
  const key = normalizeShortcutKey(event.key);
  return (
    key === binding.key &&
    event.ctrlKey === binding.ctrl &&
    event.altKey === binding.alt &&
    event.metaKey === binding.meta &&
    shiftMatches(event as KeyboardEvent, binding)
  );
}

/** Merge persisted overrides with default bindings for every known shortcut. */
export function resolveShortcutBindings(
  overrides: ShortcutOverrideMap = {},
): ShortcutBindingMap {
  return SHORTCUT_DEFINITIONS.reduce((acc, definition) => {
    const override = overrides[definition.id];
    acc[definition.id] =
      override === undefined
        ? definition.defaultBinding
        : normalizeShortcutString(override);
    return acc;
  }, {} as ShortcutBindingMap);
}

/** Persist only bindings that differ from the built-in defaults. */
export function buildShortcutOverrides(
  bindings: Partial<Record<ShortcutId, string>>,
): ShortcutOverrideMap {
  const overrides: ShortcutOverrideMap = {};
  for (const definition of SHORTCUT_DEFINITIONS) {
    const normalized = normalizeShortcutString(bindings[definition.id] || "");
    if (normalized !== definition.defaultBinding) {
      overrides[definition.id] = normalized;
    }
  }
  return overrides;
}

/** Detect conflicting bindings within the same shortcut scope. */
export function detectShortcutConflicts(
  bindings: Partial<Record<ShortcutId, string>>,
): Map<ShortcutId, ShortcutDefinition[]> {
  const conflicts = new Map<ShortcutId, ShortcutDefinition[]>();
  const scopedBindings = new Map<string, ShortcutDefinition[]>();

  for (const definition of SHORTCUT_DEFINITIONS) {
    const binding = normalizeShortcutString(bindings[definition.id] || "");
    if (!binding) continue;
    const key = `${definition.scope}::${binding}`;
    const existing = scopedBindings.get(key) || [];
    existing.push(definition);
    scopedBindings.set(key, existing);
  }

  for (const definitions of scopedBindings.values()) {
    if (definitions.length < 2) continue;
    for (const definition of definitions) {
      conflicts.set(
        definition.id as ShortcutId,
        definitions.filter((other) => other.id !== definition.id),
      );
    }
  }

  return conflicts;
}
