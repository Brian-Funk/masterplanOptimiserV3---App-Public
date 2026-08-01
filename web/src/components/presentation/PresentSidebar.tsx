"use client";

import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Info, X } from "lucide-react";
import type { CalendarTask } from "@/components/Calendar";
import { useShortcuts } from "@/contexts/ShortcutContext";
import { getShortcutDefinition, type ShortcutId } from "@/lib/shortcuts";

interface DayGroup {
  date: string;
  label: string;
  tasks: CalendarTask[];
}

interface PresentSidebarProps {
  dayGroups: DayGroup[];
  currentTaskId: number | null;
  collapsed: boolean;
  onToggle: () => void;
  onSelectTask: (taskId: number) => void;
}

const presentationShortcutRows: Array<{
  ids: ShortcutId[];
  description: string;
}> = [
  {
    ids: ["presentation.previousTask", "presentation.nextTask"],
    description: "Previous / next task",
  },
  {
    ids: ["presentation.previousDay", "presentation.nextDay"],
    description: "Previous / next day",
  },
  {
    ids: ["presentation.toggleView"],
    description:
      getShortcutDefinition("presentation.toggleView")?.label ||
      "Toggle calendar / detail view",
  },
  {
    ids: ["presentation.toggleTaskList"],
    description:
      getShortcutDefinition("presentation.toggleTaskList")?.label ||
      "Toggle task list",
  },
  {
    ids: ["presentation.toggleCalendarSidebar"],
    description:
      getShortcutDefinition("presentation.toggleCalendarSidebar")?.label ||
      "Toggle calendar sidebar",
  },
  {
    ids: ["presentation.toggleFullscreen"],
    description:
      getShortcutDefinition("presentation.toggleFullscreen")?.label ||
      "Toggle fullscreen",
  },
  {
    ids: ["presentation.backOrClose"],
    description:
      getShortcutDefinition("presentation.backOrClose")?.label ||
      "Back to overview / close",
  },
];

/** Render the compact task list used for presentation navigation. */
export default function PresentSidebar({
  dayGroups,
  currentTaskId,
  collapsed,
  onToggle,
  onSelectTask,
}: PresentSidebarProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const { getShortcutBinding } = useShortcuts();
  const taskListShortcut =
    getShortcutBinding("presentation.toggleTaskList") || "Unassigned";

  useEffect(() => {
    if (currentTaskId == null || collapsed) return;
    const container = listRef.current;
    if (!container) return;
    const el = container.querySelector(
      `[data-sidebar-task-id="${currentTaskId}"]`,
    );
    if (el && typeof (el as HTMLElement).scrollIntoView === "function") {
      (el as HTMLElement).scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [currentTaskId, collapsed]);

  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        className="absolute left-0 top-1/2 z-30 -translate-y-1/2 rounded-r-lg border border-bordercl-subtle bg-surface px-1.5 py-4 shadow-sm transition-colors hover:bg-surface-hover"
        title={`Show task list (${taskListShortcut})`}
        aria-label="Show task list"
      >
        <ChevronRight className="h-4 w-4 text-foreground-muted" />
      </button>
    );
  }

  return (
    <>
      <div
        className="z-20 flex h-full w-72 flex-col border-r border-bordercl-subtle bg-surface-alt/70"
        data-testid="presentation-task-sidebar"
      >
        <div className="flex items-center justify-between border-b border-bordercl-subtle px-2 py-2">
          <button
            onClick={onToggle}
            className="rounded p-1 transition-colors hover:bg-surface-hover"
            title={`Hide task list (${taskListShortcut})`}
            aria-label="Hide task list"
          >
            <ChevronLeft className="h-4 w-4 text-foreground-muted" />
          </button>
          <button
            onClick={() => setShowShortcuts(true)}
            className="rounded p-1 transition-colors hover:bg-surface-hover"
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
          >
            <Info className="h-3.5 w-3.5 text-foreground-faint" />
          </button>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto">
          {dayGroups.map((group) => (
            <div key={group.date}>
              <div className="sticky top-0 border-b border-bordercl-subtle bg-surface-alt/95 px-4 py-3">
                <span className="text-[11px] font-medium uppercase tracking-wider text-foreground-muted">
                  {group.label}
                </span>
              </div>

              {group.tasks.map((task) => {
                const isActive = task.id === currentTaskId;
                return (
                  <button
                    key={task.id}
                    data-sidebar-task-id={task.id}
                    onClick={() => onSelectTask(task.id)}
                    className={`relative w-full border-b border-bordercl-subtle px-4 py-3 text-left transition-colors ${
                      isActive ? "bg-primary-500/10" : "hover:bg-surface-hover"
                    }`}
                  >
                    {isActive && (
                      <span
                        className="absolute bottom-2 left-0 top-2 w-0.5 rounded-r-full"
                        style={{
                          backgroundColor: task.task_type_color || "#3b82f6",
                        }}
                      />
                    )}
                    {task.start_end_time && (
                      <div className="mb-1 font-mono text-[11px] text-foreground-faint">
                        {task.start_end_time.start} - {task.start_end_time.end}
                      </div>
                    )}
                    <div
                      className={`truncate text-sm ${
                        isActive
                          ? "font-semibold text-foreground"
                          : "text-foreground-secondary"
                      }`}
                    >
                      {task.name}
                    </div>
                    {task.location_name && (
                      <div className="mt-1 truncate text-xs text-foreground-muted">
                        {task.location_name}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {showShortcuts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="w-80 rounded-xl border border-bordercl bg-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                Keyboard shortcuts
              </h3>
              <button
                onClick={() => setShowShortcuts(false)}
                className="rounded p-0.5 transition-colors hover:bg-surface-hover"
                aria-label="Close keyboard shortcuts"
              >
                <X className="h-4 w-4 text-foreground-muted" />
              </button>
            </div>
            <div className="space-y-2">
              {presentationShortcutRows.map((row) => {
                const keys = row.ids
                  .map((id) => getShortcutBinding(id) || "Unassigned")
                  .join(" / ");
                return (
                  <div
                    key={row.ids.join(",")}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-sm text-foreground-secondary">
                      {row.description}
                    </span>
                    <kbd className="rounded border border-bordercl-subtle bg-surface-alt px-1.5 py-0.5 font-mono text-xs text-foreground-muted">
                      {keys}
                    </kbd>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
