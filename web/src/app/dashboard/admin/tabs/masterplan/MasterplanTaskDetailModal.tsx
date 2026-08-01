"use client";

import React, { useState } from "react";
import { X, Clock, MapPin, FileText } from "lucide-react";
import { Tooltip } from "@/components/ui";
import { Person, TaskType, TaskTemplate, Location } from "@/lib/api";
import type { CalendarTask } from "@/components/Calendar";
import { formatDateLong } from "@/lib/dateFormat";

interface MasterplanTaskDetailModalProps {
  task: CalendarTask & {
    _layout?: any;
    _backendTaskId?: number;
    templateId?: number;
    optimised?: Record<string, any>;
    final?: Record<string, any>;
    taskType?: string;
  };
  isOpen: boolean;
  onClose: () => void;
  persons: Person[];
  locations: Location[];
  templates: TaskTemplate[];
  taskTypes: TaskType[];
  selectedEvent: any;
  onPersonSwap: (
    taskId: number,
    oldPersonId: number,
    newPersonId: number,
  ) => Promise<void>;
}

export function MasterplanTaskDetailModal({
  task,
  isOpen,
  onClose,
  persons,
  locations,
  templates,
  taskTypes,
  selectedEvent,
  onPersonSwap,
}: MasterplanTaskDetailModalProps) {
  const [swapFieldId, setSwapFieldId] = useState<string | null>(null);
  const [swapPersonId, setSwapPersonId] = useState<number | null>(null);
  const [newPersonId, setNewPersonId] = useState<number | null>(null);

  const taskTemplate = templates.find((t) => t.id === (task as any).templateId);
  const taskType = taskTypes.find((t) => t.id === task.task_type_id);
  const schedule = (task as any).final || (task as any).optimised || {};

  // Person swap within the modal
  const handleSwapConfirm = async () => {
    if (swapPersonId === null || newPersonId === null) return;
    await onPersonSwap(task.id, swapPersonId, newPersonId);
    setSwapFieldId(null);
    setSwapPersonId(null);
    setNewPersonId(null);
  };

  // Time display
  const minutesToTime = (minutes: number): string => {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  };

  const startTime =
    schedule.start_time !== undefined
      ? minutesToTime(schedule.start_time)
      : null;
  const endTime =
    schedule.end_time !== undefined ? minutesToTime(schedule.end_time) : null;

  // Location
  const locationName = task.location_name || "";

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-surface flex items-center justify-between px-6 py-4 border-b border-bordercl">
          <div className="flex items-center gap-3">
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: task.task_type_color }}
            />
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                {task.name}
              </h2>
              <p className="text-sm text-foreground-muted">
                {taskType?.name || task.task_type_name}
                {taskTemplate ? `  ${taskTemplate.name}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-foreground-faint hover:text-foreground-muted transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Schedule Info (read-only) */}
        <div className="px-6 py-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wider">
            Schedule
          </h3>

          <div className="grid grid-cols-2 gap-3">
            {/* Time */}
            {startTime && endTime && (
              <div className="flex items-center gap-2 text-sm text-foreground-secondary">
                <Clock className="w-4 h-4 text-foreground-faint" />
                <span>
                  {startTime} {endTime}
                </span>
              </div>
            )}

            {/* Date */}
            {task.date && (
              <div className="flex items-center gap-2 text-sm text-foreground-secondary">
                <FileText className="w-4 h-4 text-foreground-faint" />
                <span>{formatDateLong(task.date)}</span>
              </div>
            )}

            {/* Location */}
            {locationName && (
              <div className="flex items-center gap-2 text-sm text-foreground-secondary col-span-2">
                <MapPin className="w-4 h-4 text-foreground-faint" />
                <span>{locationName}</span>
              </div>
            )}
          </div>

          {/* Person Assignments (with swap buttons) */}
          {((task.field_assignments &&
            Object.keys(task.field_assignments).length > 0) ||
            (task.field_assignment_exclusions &&
              Object.keys(task.field_assignment_exclusions).length > 0)) ? (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-foreground-secondary">
                Assigned Persons
              </label>
              {Array.from(
                new Set([
                  ...Object.keys(task.field_assignments || {}),
                  ...Object.keys(task.field_assignment_exclusions || {}),
                ]),
              ).map((fieldId) => {
                  const personIds = task.field_assignments?.[fieldId] || [];
                  const excludedPersons =
                    task.field_assignment_exclusions?.[fieldId] || [];
                  const fieldDef = task.field_definitions?.find(
                    (f) => f.id === fieldId,
                  );
                  const fieldLabel =
                    fieldDef?.name ||
                    fieldId
                      .replace(/^field_/, "")
                      .replace(/_/g, " ")
                      .replace(/\b\w/g, (c: string) => c.toUpperCase());
                  return (
                    <div
                      key={fieldId}
                      className="border border-bordercl rounded-lg p-3"
                    >
                      <div className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">
                        {fieldLabel}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(personIds as number[]).map((pid) => {
                          const person = persons.find((p) => p.id === pid);
                          const name = person
                            ? `${person.first_name} ${person.last_name}`
                            : `Person ${pid}`;
                          return (
                            <button
                              key={pid}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-surface-inset text-foreground-secondary hover:bg-blue-50 dark:bg-blue-950/30 dark:hover:bg-blue-950/30 hover:text-blue-700 border border-bordercl hover:border-blue-200 dark:border-blue-800 transition-colors"
                              onClick={() => {
                                setSwapFieldId(fieldId);
                                setSwapPersonId(pid);
                                setNewPersonId(null);
                              }}
                            >
                              <Tooltip
                                content="Click to swap this person"
                                side="top"
                              >
                                <span className="inline-flex items-center gap-1">
                                  {name}
                                  <span className="text-foreground-faint text-[10px]">
                                    &#9998;
                                  </span>
                                </span>
                              </Tooltip>
                            </button>
                          );
                        })}
                        {excludedPersons.map((excluded) => {
                          const person = persons.find(
                            (p) => p.id === excluded.person_id,
                          );
                          const name = person
                            ? `${person.first_name} ${person.last_name}`
                            : `Person ${excluded.person_id}`;
                          const range =
                            excluded.unavailable_from && excluded.unavailable_to
                              ? ` (${excluded.unavailable_from} - ${excluded.unavailable_to})`
                              : "";
                          return (
                            <Tooltip
                              key={`excluded-${fieldId}-${excluded.person_id}-${excluded.group_id}`}
                              content={`Unavailable during this task${range}`}
                              side="top"
                            >
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-red-200 bg-red-50 text-red-700 line-through opacity-75 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                                {name}
                              </span>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : task.assigned_persons && task.assigned_persons.length > 0 ? (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-foreground-secondary">
                Assigned Persons
              </label>
              <div className="border border-bordercl rounded-lg p-3">
                <div className="flex flex-wrap gap-1.5">
                  {task.assigned_persons.map((pid) => {
                    const person = persons.find((p) => p.id === pid);
                    const name = person
                      ? `${person.first_name} ${person.last_name}`
                      : `Person ${pid}`;
                    return (
                      <button
                        key={pid}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-surface-inset text-foreground-secondary hover:bg-blue-50 dark:bg-blue-950/30 dark:hover:bg-blue-950/30 hover:text-blue-700 border border-bordercl hover:border-blue-200 dark:border-blue-800 transition-colors"
                        onClick={() => {
                          setSwapFieldId(null);
                          setSwapPersonId(pid);
                          setNewPersonId(null);
                        }}
                      >
                        <Tooltip content="Click to swap this person" side="top">
                          <span className="inline-flex items-center gap-1">
                            {name}
                            <span className="text-foreground-faint text-[10px]">
                              &#9998;
                            </span>
                          </span>
                        </Tooltip>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          {/* Person Swap UI */}
          {swapPersonId !== null && (
            <div className="mt-2 p-3 bg-surface-alt border border-bordercl rounded-lg">
              <div className="text-sm font-medium text-foreground-secondary mb-2">
                Replace{" "}
                <span className="font-semibold">
                  {persons.find((p) => p.id === swapPersonId)
                    ? `${persons.find((p) => p.id === swapPersonId)!.first_name} ${persons.find((p) => p.id === swapPersonId)!.last_name}`
                    : `Person ${swapPersonId}`}
                </span>{" "}
                with:
              </div>
              <select
                className="w-full border border-bordercl-strong rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                value={newPersonId ?? ""}
                onChange={(e) =>
                  setNewPersonId(e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">Select a person...</option>
                {persons
                  .filter((p) => p.id !== swapPersonId)
                  .sort((a, b) => a.first_name.localeCompare(b.first_name))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.first_name} {p.last_name}
                    </option>
                  ))}
              </select>
              <div className="flex justify-end gap-2 mt-3">
                <button
                  className="px-4 py-2 text-sm font-medium text-foreground-secondary hover:bg-surface-inset dark:bg-surface-hover rounded-lg transition-colors"
                  onClick={() => {
                    setSwapFieldId(null);
                    setSwapPersonId(null);
                    setNewPersonId(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
                  disabled={newPersonId === null}
                  onClick={handleSwapConfirm}
                >
                  Confirm Swap
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-surface-alt px-6 py-4 flex items-center justify-end border-t border-bordercl">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-foreground-secondary hover:bg-surface-inset dark:bg-surface-hover rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
