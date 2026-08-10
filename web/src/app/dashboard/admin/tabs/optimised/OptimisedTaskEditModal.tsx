"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  AlertTriangle,
  ExternalLink,
  PencilLine,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { Tooltip } from "@/components/ui";
import { Location, Person, TaskType } from "@/lib/api";
import { CalendarTask } from "@/components/Calendar";
import ResourceSelector from "@/components/ResourceSelector";
import { formatDateLong } from "@/lib/dateFormat";

interface OptimisedTaskEditModalProps {
  task: CalendarTask;
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: any) => void;
  onDelete: (taskId: string) => void;
  onResetToOptimised: (taskId: number) => void;
  taskType?: TaskType;
  persons: Person[];
  locations: Location[];
}

export function OptimisedTaskEditModal({
  task,
  isOpen,
  onClose,
  onSave,
  onDelete,
  onResetToOptimised,
  taskType,
  persons,
  locations,
}: OptimisedTaskEditModalProps) {
  const [editedTask, setEditedTask] = useState(task);
  const [selectedPersonIds, setSelectedPersonIds] = useState<number[]>(
    task.assigned_persons || [],
  );
  const [fieldAssignments, setFieldAssignments] = useState<
    Record<string, number[]>
  >(task.field_assignments ? { ...task.field_assignments } : {});
  const [editedFieldValues, setEditedFieldValues] = useState<
    Record<string, any>
  >(task.fields ? { ...task.fields } : {});

  // Convert minutes to HH:MM format
  const minutesToTimeString = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  };

  // Convert HH:MM to minutes
  const timeStringToMinutes = (timeString: string): number => {
    const [hours, mins] = timeString.split(":").map(Number);
    return hours * 60 + mins;
  };

  useEffect(() => {
    setEditedTask(task);
    setSelectedPersonIds(task.assigned_persons || []);
    setFieldAssignments(
      task.field_assignments ? { ...task.field_assignments } : {},
    );
    setEditedFieldValues(task.fields ? { ...task.fields } : {});
  }, [task]);

  // BroadcastChannel for sending preview-delta to MetricsBoard
  const previewChannelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    try {
      previewChannelRef.current = new BroadcastChannel("metrics-highlight");
    } catch {}
    return () => {
      previewChannelRef.current?.close();
    };
  }, []);

  // Clear preview when modal closes or unmounts
  useEffect(() => {
    return () => {
      try {
        const ch = new BroadcastChannel("metrics-highlight");
        ch.postMessage({ action: "clear-preview" });
        ch.close();
      } catch {}
    };
  }, []);

  const handleResourceHover = useCallback(
    (personId: number, operation: "add" | "remove") => {
      previewChannelRef.current?.postMessage({
        action: "preview-delta",
        taskId: task.id,
        removePersonIds: operation === "remove" ? [personId] : [],
        addPersonIds: operation === "add" ? [personId] : [],
      });
    },
    [task.id],
  );

  const handleResourceHoverEnd = useCallback(() => {
    previewChannelRef.current?.postMessage({ action: "clear-preview" });
  }, []);

  const handleSave = async () => {
    await onSave({
      ...editedTask,
      assigned_persons: selectedPersonIds,
      field_assignments:
        Object.keys(fieldAssignments).length > 0 ? fieldAssignments : undefined,
      field_values: editedFieldValues,
    });
    onClose();
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this task?")) {
      onDelete(task.id.toString());
    }
  };

  const handleResetToOptimised = () => {
    onResetToOptimised(task.id);
  };

  if (!isOpen) return null;

  const manualSummaries = task.manualChange?.summaries ?? [];
  const manualDetails = task.manualChange?.details ?? [];
  const conflictMessages = task.conflicts?.messages ?? [];
  const conflictDetails = task.conflicts?.details ?? [];
  const conflictCount = task.conflicts?.count ?? conflictMessages.length;
  const hasManualChange =
    manualSummaries.length > 0 || manualDetails.length > 0;
  const hasConflict = conflictCount > 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-surface border-b border-bordercl px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-foreground">Edit Task</h2>
          <button
            onClick={onClose}
            className="text-foreground-faint hover:text-foreground-muted transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-6">
          {(hasManualChange || hasConflict) && (
            <div className="space-y-2">
              {hasManualChange && (
                <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-foreground-secondary">
                  <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-300">
                    <PencilLine className="h-4 w-4" />
                    Manually changed after optimisation
                  </div>
                  <div className="mt-1 text-xs text-foreground-muted">
                    {manualSummaries.length > 0
                      ? manualSummaries.join(", ")
                      : "This task differs from the optimiser result."}
                  </div>
                  {manualDetails.length > 0 && (
                    <div className="mt-1 space-y-0.5 text-xs text-foreground-muted">
                      {manualDetails.slice(0, 3).map((detail, index) => (
                        <div key={`manual-detail-${index}-${detail}`}>
                          {detail}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {hasConflict && (
                <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-foreground-secondary">
                  <div className="flex items-center gap-2 font-medium text-red-700 dark:text-red-300">
                    <AlertTriangle className="h-4 w-4" />
                    {conflictCount === 1
                      ? "1 conflict affects this task"
                      : `${conflictCount} conflicts affect this task`}
                  </div>
                  <div className="mt-1 space-y-0.5 text-xs text-foreground-muted">
                    {(conflictMessages.length > 0
                      ? conflictMessages
                      : ["Review this task before publishing."]
                    )
                      .slice(0, 3)
                      .map((message, index) => (
                        <div key={`conflict-message-${index}-${message}`}>
                          {message}
                        </div>
                      ))}
                    {conflictDetails.slice(0, 2).map((detail, index) => (
                      <div key={`conflict-detail-${index}-${detail}`}>
                        {detail}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Task Name (Read-only) */}
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-2">
              Task Name
            </label>
            <div className="px-3 py-2 bg-surface-alt border border-bordercl rounded-lg text-foreground-muted">
              {task.name}
            </div>
          </div>

          {/* Task Type (Read-only) */}
          {taskType && (
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-2">
                Task Type
              </label>
              <div
                className="px-3 py-2 rounded-lg text-white font-medium"
                style={{ backgroundColor: taskType.color }}
              >
                {taskType.name}
              </div>
            </div>
          )}

          {/* Date (Read-only) */}
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-2">
              Date
            </label>
            <div className="px-3 py-2 bg-surface-alt border border-bordercl rounded-lg text-foreground-muted">
              {task.date ? formatDateLong(task.date) : "—"}
            </div>
          </div>

          {/* Time Range - Editable */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-2">
                Start Time *
              </label>
              <input
                type="time"
                value={editedTask.start_end_time?.start || ""}
                onChange={(e) =>
                  setEditedTask({
                    ...editedTask,
                    start_end_time: {
                      start: e.target.value,
                      end: editedTask.start_end_time?.end || "",
                    },
                  })
                }
                className="w-full px-3 py-2 border border-bordercl-strong rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-2">
                End Time *
              </label>
              <input
                type="time"
                value={editedTask.start_end_time?.end || ""}
                onChange={(e) =>
                  setEditedTask({
                    ...editedTask,
                    start_end_time: {
                      start: editedTask.start_end_time?.start || "",
                      end: e.target.value,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-bordercl-strong rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Location - Read-only */}
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-2">
              Location
            </label>
            <div className="px-3 py-2 bg-surface-alt border border-bordercl rounded-lg text-foreground-muted">
              {task.location_name || "No location"}
            </div>
          </div>

          {/* Assigned Persons - per-field breakdown or flat list */}
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-2">
              Assigned Persons
            </label>
            {task.field_assignments &&
            Object.keys(task.field_assignments).length > 0 ? (
              // Per-field breakdown
              <div className="space-y-4">
                {Object.entries(fieldAssignments).map(
                  ([fieldId, personIds]) => {
                    const fieldDef = (task.field_definitions || []).find(
                      (f: any) => f.id === fieldId,
                    );
                    const fieldLabel =
                      fieldDef?.name ||
                      fieldId
                        .replace(/^field_/, "")
                        .replace(/_/g, " ")
                        .replace(/\b\w/g, (c: string) => c.toUpperCase());
                    const fieldPersonIds = personIds as number[];
                    return (
                      <div
                        key={fieldId}
                        className="border border-bordercl rounded-lg p-3"
                      >
                        <div className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2">
                          {fieldLabel}
                        </div>
                        <ResourceSelector
                          type="person"
                          availableResources={persons.map((p) => ({
                            id: p.id,
                            name: `${p.first_name} ${p.last_name}`,
                          }))}
                          availableGroups={[]}
                          selectedResources={fieldPersonIds
                            .map((personId) => {
                              const person = persons.find(
                                (p) => p.id === personId,
                              );
                              return person
                                ? {
                                    id: person.id,
                                    name: `${person.first_name} ${person.last_name}`,
                                  }
                                : null;
                            })
                            .filter(
                              (r): r is { id: number; name: string } =>
                                r !== null,
                            )}
                          onAdd={(resource) => {
                            setFieldAssignments((prev) => ({
                              ...prev,
                              [fieldId]: [
                                ...(prev[fieldId] || []),
                                resource.id,
                              ],
                            }));
                            setSelectedPersonIds((prev) => [
                              ...prev,
                              resource.id,
                            ]);
                          }}
                          onAddGroup={() => {}}
                          onRemove={(resourceId) => {
                            setFieldAssignments((prev) => ({
                              ...prev,
                              [fieldId]: (prev[fieldId] || []).filter(
                                (id) => id !== resourceId,
                              ),
                            }));
                            setSelectedPersonIds((prev) =>
                              prev.filter((id) => id !== resourceId),
                            );
                          }}
                          allowMultiple={true}
                          onItemHover={handleResourceHover}
                          onItemHoverEnd={handleResourceHoverEnd}
                        />
                      </div>
                    );
                  },
                )}
              </div>
            ) : (
              // Flat list (no field_assignments data)
              <ResourceSelector
                type="person"
                availableResources={persons.map((p) => ({
                  id: p.id,
                  name: `${p.first_name} ${p.last_name}`,
                }))}
                availableGroups={[]}
                selectedResources={selectedPersonIds
                  .map((personId) => {
                    const person = persons.find((p) => p.id === personId);
                    return person
                      ? {
                          id: person.id,
                          name: `${person.first_name} ${person.last_name}`,
                        }
                      : null;
                  })
                  .filter((r): r is { id: number; name: string } => r !== null)}
                onAdd={(resource) => {
                  setSelectedPersonIds((prev) => [...prev, resource.id]);
                }}
                onAddGroup={() => {}}
                onRemove={(resourceId) => {
                  setSelectedPersonIds((prev) =>
                    prev.filter((id) => id !== resourceId),
                  );
                }}
                allowMultiple={true}
                onItemHover={handleResourceHover}
                onItemHoverEnd={handleResourceHoverEnd}
              />
            )}
          </div>

          {/* Additional Fields (text, link, number) */}
          {(() => {
            const editableFields = (task.field_definitions || []).filter(
              (f: any) =>
                f.type === "text" || f.type === "link" || f.type === "number",
            );
            if (editableFields.length === 0) return null;
            return (
              <div className="space-y-4">
                <label className="block text-sm font-medium text-foreground-secondary">
                  Classified operational fields
                </label>
                {editableFields.map((field: any) => (
                  <div key={field.id}>
                    <label className="block text-xs font-medium text-foreground-muted mb-1">
                      {field.name || field.label || field.id}
                    </label>
                    {field.type === "number" ? (
                      <input
                        type="number"
                        value={editedFieldValues[field.id] ?? ""}
                        onChange={(e) =>
                          setEditedFieldValues((prev) => ({
                            ...prev,
                            [field.id]:
                              e.target.value === ""
                                ? ""
                                : parseInt(e.target.value) || 0,
                          }))
                        }
                        className="w-full px-3 py-2 border border-bordercl-strong rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-surface-alt text-foreground"
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editedFieldValues[field.id] || ""}
                          onChange={(e) =>
                            setEditedFieldValues((prev) => ({
                              ...prev,
                              [field.id]: e.target.value,
                            }))
                          }
                          placeholder={
                            field.type === "link"
                              ? "Enter URL or link"
                              : `Enter ${(field.name || field.label || "value").toLowerCase()}`
                          }
                          className="flex-1 px-3 py-2 border border-bordercl-strong rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-surface-alt text-foreground"
                        />
                        {field.type === "link" &&
                          editedFieldValues[field.id] && (
                            <Tooltip content="Open link" side="top">
                              <a
                                href={editedFieldValues[field.id]}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 text-blue-500 hover:text-blue-700 transition-colors"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            </Tooltip>
                          )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Attachments removed */}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-surface-alt px-6 py-4 flex items-center justify-between border-t border-bordercl">
          <div className="flex items-center gap-2">
            <button
              onClick={handleDelete}
              className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 dark:bg-red-950/30 rounded-lg transition-colors flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
            <button
              onClick={handleResetToOptimised}
              className="px-4 py-2 text-sm font-medium text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30 dark:bg-orange-950/30 rounded-lg transition-colors flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Reset to Optimised
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-foreground-secondary hover:bg-surface-inset dark:bg-surface-hover rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
