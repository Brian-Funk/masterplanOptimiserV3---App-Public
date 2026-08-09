"use client";

import React, { useState, useEffect } from "react";
import { X, Trash2 } from "lucide-react";
import ResourceSelector, { ANY_LOCATION_ID } from "./ResourceSelector";
import {
  mergeGroupMemberSelections,
  normaliseGroupMembers,
  removeGroupMemberSelection,
} from "@/lib/groupMembers";

// Sort fields by priority: Time -> Location -> Capabilities -> Persons -> Additional info
function sortFields(fields: any[]): any[] {
  return [...fields].sort((a, b) => {
    const getFieldPriority = (field: any): number => {
      // 1. Time-related fields (time, time_range, duration, start_end_time)
      if (["time_range", "start_end_time", "duration"].includes(field.type)) {
        return 1;
      }
      // 2. Location
      if (field.type === "location") {
        return 2;
      }
      // 3. Capabilities
      if (field.type === "capabilities_list") {
        return 3;
      }
      // 4. Persons List
      if (field.type === "persons_list") {
        return 4;
      }
      // 5. Additional info (everything else)
      return 5;
    };

    return getFieldPriority(a) - getFieldPriority(b);
  });
}

type TaskEditModalProps = {
  task: any;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedTask: any) => void;
  onDelete?: (taskId: string) => void;
  taskType: any;
  capabilities: any[];
  persons: any[];
  groups: any[];
  locations: any[];
};

const TaskEditModal: React.FC<TaskEditModalProps> = ({
  task,
  isOpen,
  onClose,
  onSave,
  onDelete,
  taskType,
  capabilities,
  persons,
  groups,
  locations,
}) => {
  const [taskData, setTaskData] = useState<{ [key: string]: any }>({});
  const [taskName, setTaskName] = useState<string>("");

  useEffect(() => {
    if (task) {
      setTaskData({ ...task.fields });
      setTaskName(task.name || "");
    }
  }, [task]);

  if (!isOpen || !task) return null;

  const handleFieldChange = (fieldId: string, value: any) => {
    setTaskData((prev) => ({
      ...prev,
      [fieldId]: value,
    }));
  };

  const handleSave = () => {
    const nextTaskData = { ...taskData };
    task.field_definitions.forEach((field: any) => {
      if (field.type === "persons_list") {
        nextTaskData[field.id] = normaliseGroupMembers(nextTaskData[field.id]);
      }
    });

    onSave({
      ...task,
      name: taskName,
      fields: nextTaskData,
    });
    onClose();
  };

  const conditionFields = task.field_definitions.filter((f: any) =>
    [
      "time_range",
      "duration",
      "capabilities_list",
      "start_end_time",
      "persons_list",
      "location",
      "dynamic_transfer_allocation",
    ].includes(f.type),
  );

  const arbitraryFields = task.field_definitions.filter((f: any) =>
    ["text", "number", "link"].includes(f.type),
  );

  // Detect transfer tasks: templates with 2+ location fields
  const isTransferTask =
    task.field_definitions.filter((f: any) => f.type === "location").length >=
    2;

  const getPersonDisplay = (personId: number) => {
    const person = persons.find((p) => p.id === personId);
    return person ? `${person.first_name} ${person.last_name}` : "Unknown";
  };

  const getGroupDisplay = (groupId: number) => {
    return groups.find((group) => group.id === groupId)?.name || "Unknown Group";
  };

  const getSelectedPersonFieldResources = (value: any) =>
    normaliseGroupMembers(value).map((member) => ({
      id: member.id,
      name:
        member.type === "group"
          ? getGroupDisplay(member.id)
          : getPersonDisplay(member.id),
      type: member.type,
    }));

  // Helper to get task type color with opacity
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return { r: 156, g: 163, b: 175 };
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    };
  };

  const hexToRgba = (hex: string, alpha: number) => {
    const rgb = hexToRgb(hex);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-bordercl">
          <div className="flex-1 mr-4">
            <input
              type="text"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              className="text-xl font-bold text-foreground w-full border-2 border-bordercl-strong rounded px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Task name"
            />
            <p className="text-sm text-foreground-muted mt-2">
              {taskType?.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="self-start text-foreground-faint hover:text-foreground-muted transition-colors shrink-0"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Conditions Section */}
          {conditionFields.length > 0 && (
            <div
              className="rounded-lg border-2 p-4"
              style={{
                backgroundColor: hexToRgba(taskType?.color || "#9CA3AF", 0.1),
                borderColor: hexToRgba(taskType?.color || "#9CA3AF", 0.3),
              }}
            >
              <h3 className="font-semibold text-foreground mb-4">Conditions</h3>
              <div className="grid grid-cols-2 gap-4 [&>*:last-child:nth-child(odd)]:col-span-2">
                {sortFields(conditionFields).map((field: any) => (
                  <div key={field.id}>
                    <label className="block text-sm font-medium text-foreground-secondary mb-2">
                      {field.label || field.name}
                    </label>

                    {field.type === "duration" && (
                      <input
                        type="number"
                        value={taskData[field.id] || ""}
                        onChange={(e) =>
                          handleFieldChange(
                            field.id,
                            parseInt(e.target.value) || 0,
                          )
                        }
                        placeholder="e.g., 60"
                        className="w-full min-h-[52px] p-3 text-sm border-2 border-bordercl-strong rounded-lg bg-surface focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    )}

                    {field.type === "time_range" && (
                      <div className="flex gap-2 items-center">
                        <input
                          type="time"
                          value={taskData[field.id]?.start || ""}
                          onChange={(e) =>
                            handleFieldChange(field.id, {
                              ...taskData[field.id],
                              start: e.target.value,
                            })
                          }
                          className="flex-1 min-h-[52px] p-3 text-sm border-2 border-bordercl-strong rounded-lg bg-surface focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <span className="text-xs text-foreground-muted">
                          to
                        </span>
                        <input
                          type="time"
                          value={taskData[field.id]?.end || ""}
                          onChange={(e) =>
                            handleFieldChange(field.id, {
                              ...taskData[field.id],
                              end: e.target.value,
                            })
                          }
                          className="flex-1 min-h-[52px] p-3 text-sm border-2 border-bordercl-strong rounded-lg bg-surface focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    )}

                    {field.type === "start_end_time" && (
                      <div className="flex gap-2 items-center">
                        <input
                          type="time"
                          value={taskData[field.id]?.start || ""}
                          onChange={(e) =>
                            handleFieldChange(field.id, {
                              ...taskData[field.id],
                              start: e.target.value,
                            })
                          }
                          className="flex-1 min-h-[52px] p-3 text-sm border-2 border-bordercl-strong rounded-lg bg-surface focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <span className="text-xs text-foreground-muted">
                          to
                        </span>
                        <input
                          type="time"
                          value={taskData[field.id]?.end || ""}
                          onChange={(e) =>
                            handleFieldChange(field.id, {
                              ...taskData[field.id],
                              end: e.target.value,
                            })
                          }
                          className="flex-1 min-h-[52px] p-3 text-sm border-2 border-bordercl-strong rounded-lg bg-surface focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    )}

                    {field.type === "capabilities_list" && (
                      <ResourceSelector
                        type="capability"
                        availableResources={capabilities.map((c) => ({
                          id: c.id,
                          name: c.name,
                          description: c.description,
                        }))}
                        selectedResources={(taskData[field.id] || [])
                          .map((item: any) => {
                            const capId =
                              typeof item === "object" ? item.id : item;
                            const quantity =
                              typeof item === "object"
                                ? item.amount || item.quantity || 1
                                : 1;
                            const cap = capabilities.find(
                              (c) => c.id === capId,
                            );
                            return cap
                              ? {
                                  id: cap.id,
                                  name: cap.name,
                                  description: cap.description,
                                  quantity,
                                }
                              : null;
                          })
                          .filter(Boolean)}
                        onAdd={(resource) => {
                          const current = taskData[field.id] || [];
                          handleFieldChange(field.id, [
                            ...current,
                            { id: resource.id, quantity: 1 },
                          ]);
                        }}
                        onRemove={(resourceId) => {
                          const current = taskData[field.id] || [];
                          handleFieldChange(
                            field.id,
                            current.filter((item: any) => {
                              const id =
                                typeof item === "object" ? item.id : item;
                              return id !== resourceId;
                            }),
                          );
                        }}
                        onChangeQuantity={(id, quantity) => {
                          const current = taskData[field.id] || [];
                          handleFieldChange(
                            field.id,
                            current.map((item: any) => {
                              const itemId =
                                typeof item === "object" ? item.id : item;
                              return itemId === id ? { id, quantity } : item;
                            }),
                          );
                        }}
                        allowMultiple={true}
                        allowQuantity={true}
                        customColor={taskType?.color}
                        isCondition={true}
                      />
                    )}

                    {field.type === "persons_list" && (
                      <>
                        <ResourceSelector
                          type="person"
                          availableResources={persons.map((p) => ({
                            id: p.id,
                            name: `${p.first_name} ${p.last_name}`,
                          }))}
                          availableGroups={groups.map((g) => ({
                            id: g.id,
                            name: g.name,
                          }))}
                          selectedResources={getSelectedPersonFieldResources(
                            taskData[field.id] || [],
                          )}
                          onAdd={(resource) => {
                            const current = taskData[field.id] || [];
                            handleFieldChange(
                              field.id,
                              mergeGroupMemberSelections(current, [
                                { type: "person", id: resource.id },
                              ]),
                            );
                          }}
                          onAddGroup={(group) => {
                            const current = taskData[field.id] || [];
                            handleFieldChange(
                              field.id,
                              mergeGroupMemberSelections(current, [
                                { type: "group", id: group.id },
                              ]),
                            );
                          }}
                          onRemove={(resourceId, resourceType) => {
                            const current = taskData[field.id] || [];
                            handleFieldChange(
                              field.id,
                              removeGroupMemberSelection(
                                current,
                                resourceType || "person",
                                resourceId,
                              ),
                            );
                          }}
                          allowMultiple={true}
                          customColor={taskType?.color}
                          isCondition={true}
                          supportsGroups={true}
                        />
                        <p className="mt-1 text-xs text-foreground-muted">
                          Included groups are resolved when checking or
                          optimising.
                        </p>
                      </>
                    )}

                    {field.type === "location" && (
                      <ResourceSelector
                        type="location"
                        availableResources={locations.map((l) => ({
                          id: l.id,
                          name: l.name,
                        }))}
                        selectedResources={
                          taskData[field.id] === null
                            ? [
                                {
                                  id: ANY_LOCATION_ID,
                                  name: "Any Location",
                                },
                              ]
                            : taskData[field.id]
                              ? [
                                  {
                                    id: taskData[field.id],
                                    name:
                                      locations.find(
                                        (l) => l.id === taskData[field.id],
                                      )?.name || "",
                                  },
                                ]
                              : []
                        }
                        onAdd={(resource) => {
                          handleFieldChange(
                            field.id,
                            resource.id === ANY_LOCATION_ID
                              ? null
                              : resource.id,
                          );
                        }}
                        onRemove={() => {
                          handleFieldChange(field.id, undefined);
                        }}
                        allowMultiple={false}
                        customColor={taskType?.color}
                        isCondition={true}
                        allowAnyLocation={!isTransferTask}
                      />
                    )}

                    {field.type === "dynamic_transfer_allocation" && (
                      <input
                        type="number"
                        value={taskData[field.id] ?? ""}
                        onChange={(e) =>
                          handleFieldChange(
                            field.id,
                            e.target.value === ""
                              ? ""
                              : parseInt(e.target.value),
                          )
                        }
                        placeholder="Number of additional slots for dynamic allocation"
                        min="0"
                        className="w-full min-h-[52px] p-3 text-sm border-2 border-bordercl-strong rounded-lg bg-surface-alt focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Arbitrary Section */}
          {arbitraryFields.length > 0 && (
            <div
              className="rounded-lg border-2 p-4"
              style={{
                backgroundColor: hexToRgba(taskType?.color || "#9CA3AF", 0.03),
                borderColor: hexToRgba(taskType?.color || "#9CA3AF", 0.15),
              }}
            >
              <h3 className="font-semibold text-foreground mb-2">Classified operational fields</h3>
              <div className="grid grid-cols-2 gap-4 [&>*:last-child:nth-child(odd)]:col-span-2">
                {sortFields(arbitraryFields).map((field: any) => (
                  <div key={field.id} className="space-y-2">
                    <label className="block">
                      <span className="text-sm font-medium text-foreground-secondary">
                        {field.name}
                      </span>
                    </label>

                    {(field.type === "text" || field.type === "link") && (
                      <input
                        type="text"
                        value={taskData[field.id] || ""}
                        onChange={(e) =>
                          handleFieldChange(field.id, e.target.value)
                        }
                        placeholder={
                          field.type === "link"
                            ? `Enter URL or link`
                            : `Enter ${(field.name || field.label || "value").toLowerCase()}`
                        }
                        className="w-full min-h-[52px] p-3 text-sm border-2 border-bordercl-strong rounded-lg bg-surface-alt focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    )}

                    {field.type === "number" && (
                      <input
                        type="number"
                        value={taskData[field.id] || ""}
                        onChange={(e) =>
                          handleFieldChange(
                            field.id,
                            parseInt(e.target.value) || 0,
                          )
                        }
                        className="w-full min-h-[52px] p-3 text-sm border-2 border-bordercl-strong rounded-lg bg-surface-alt focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-bordercl">
          <div>
            {onDelete && (
              <button
                onClick={() => {
                  if (confirm("Are you sure you want to delete this task?")) {
                    onDelete(task.id);
                    onClose();
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete Task
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-foreground-secondary bg-surface border border-bordercl-strong rounded-lg hover:bg-surface-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaskEditModal;
