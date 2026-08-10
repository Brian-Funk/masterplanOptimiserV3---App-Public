"use client";

import React, { useState, useEffect } from "react";
import { Button, Spinner, Tooltip } from "@/components/ui";
import ResourceSelector, {
  ANY_LOCATION_ID,
} from "@/components/ResourceSelector";
import {
  taskTemplatesApi,
  TaskTemplate,
  taskTypesApi,
  TaskType,
  locationsApi,
  Location,
  groupsApi,
  Group,
  capabilitiesApi,
  personsApi,
  Person,
} from "@/lib/api";
import { Lock, Minus } from "lucide-react";
import { useTaskInstances } from "@/contexts/TaskInstanceContext";
import { formatDateShort } from "@/lib/dateFormat";
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

export function TaskBuilderTab({ selectedEvent }: { selectedEvent: any }) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [capabilities, setCapabilities] = useState<any[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hoveredTemplate, setHoveredTemplate] = useState<number | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<TaskTemplate | null>(
    null,
  );
  const [taskData, setTaskData] = useState<Record<string, any>>({});
  const [taskName, setTaskName] = useState<string>("");
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<
    Array<{ id: number; name: string }>
  >([]);

  const [selectedCapabilities, setSelectedCapabilities] = useState<
    Array<{ id: number; name: string; quantity?: number }>
  >([]);
  const { createInstances, clearAll } = useTaskInstances();

  useEffect(() => {
    fetchData();
  }, [selectedEvent]);

  const fetchData = async () => {
    if (!selectedEvent) return;
    setIsLoading(true);
    try {
      const [
        templatesData,
        taskTypesData,
        locationsData,
        groupsData,
        capabilitiesData,
        personsData,
      ] = await Promise.all([
        taskTemplatesApi.getAll(),
        taskTypesApi.getAll(),
        locationsApi.getAll(selectedEvent.id),
        groupsApi.getAll(selectedEvent.id),
        capabilitiesApi.getAll(selectedEvent.id),
        personsApi.getAll(selectedEvent.id),
      ]);
      setTemplates(templatesData);
      setTaskTypes(taskTypesData);
      setLocations(locationsData);
      setGroups(groupsData);
      setCapabilities(capabilitiesData);
      setPersons(personsData);
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setIsLoading(false);
    }
  };

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

  const handleTemplateClick = (template: TaskTemplate) => {
    setSelectedTemplate(template);
    setTaskName(template.name); // Initialize task name with template name
    // Initialize task data with empty values
    const initialData: Record<string, any> = {};
    template.fields?.forEach((field) => {
      if (field.type === "capabilities_list" || field.type === "persons_list") {
        initialData[field.id] = [];
      } else if (
        field.type === "time_range" ||
        field.type === "start_end_time"
      ) {
        initialData[field.id] = { start: "", end: "" };
      } else {
        initialData[field.id] = "";
      }
    });
    setTaskData(initialData);
    // Reset selected resources
    setSelectedLocations([]);
    setSelectedCapabilities([]);
  };

  const handleFieldChange = (fieldId: string, value: any) => {
    setTaskData((prev) => ({ ...prev, [fieldId]: value }));
  };

  // Helper function to get field category
  const getFieldCategory = (
    field: any,
  ): { category: string; icon?: any; tooltip?: string } => {
    // Use stored category if available
    if (field.category) {
      if (field.category === "conditions") {
        return {
          category: "conditions",
          icon: Lock,
          tooltip: "Influence optimisation but are not influenced by it",
        };
      } else {
        return {
          category: "arbitrary",
          icon: Minus,
          tooltip: "Do not influence and are not influenced by optimisation",
        };
      }
    }

    // Fallback to type-based detection for backward compatibility
    const conditionTypes = [
      "time_range",
      "duration",
      "capabilities_list",
      "start_end_time",
      "persons_list",
      "location",
      "dynamic_transfer_allocation",
      "transferee",
    ];

    if (conditionTypes.includes(field.type)) {
      return { category: "conditions" as const };
    } else {
      return { category: "arbitrary" as const };
    }
  };

  const handleDayToggle = (dayIndex: number) => {
    setSelectedDays((prev) =>
      prev.includes(dayIndex)
        ? prev.filter((d) => d !== dayIndex)
        : [...prev, dayIndex],
    );
  };

  const handleSubmitToSchedule = async () => {
    if (!selectedTemplate || selectedDays.length === 0 || !selectedEvent) {
      alert("Please select a template and at least one day.");
      return;
    }

    try {
      const eventDays = getEventDays();

      // Validate that all selected days are within event range
      const invalidDays = selectedDays.filter(
        (dayIndex) => dayIndex < 0 || dayIndex >= eventDays.length,
      );

      if (invalidDays.length > 0) {
        alert(
          "Some selected days are outside the event date range. Please select only days within the event period.",
        );
        return;
      }

      const fieldValues = { ...taskData };
      selectedTemplate.fields?.forEach((field) => {
        if (field.type === "persons_list") {
          fieldValues[field.id] = normaliseGroupMembers(
            fieldValues[field.id] || [],
          );
        }
      });

      // Create task instances for each selected day
      const taskInstances = selectedDays.map((dayIndex) => {
        const selectedDay = eventDays[dayIndex];
        const taskDate = selectedDay.toISOString().split("T")[0];

        // Additional validation: ensure date is within event range
        if (
          taskDate < selectedEvent.start_date ||
          taskDate > selectedEvent.end_date
        ) {
          throw new Error(
            `Task date ${formatDateShort(taskDate)} is outside event range (${formatDateShort(selectedEvent.start_date)} to ${formatDateShort(selectedEvent.end_date)})`,
          );
        }

        return {
          template_id: selectedTemplate.id,
          name: taskName || selectedTemplate.name, // Use custom name or fall back to template name
          task_type_id: selectedTemplate.task_type_id,
          event_id: selectedEvent.id,
          day_index: dayIndex,
          date: taskDate,
          field_values: fieldValues,
        };
      });

      await createInstances(taskInstances);

      alert(
        `Task "${taskName || selectedTemplate.name}" submitted to ${
          selectedDays.length
        } day(s)!`,
      );

      // Reset
      setSelectedTemplate(null);
      setTaskData({});
      setTaskName("");
      setSelectedDays([]);
    } catch (error) {
      console.error("Error submitting task:", error);
      alert("Failed to submit task. Please try again.");
    }
  };

  const getEventDays = () => {
    if (!selectedEvent?.start_date || !selectedEvent?.end_date) return [];
    const start = new Date(selectedEvent.start_date);
    const end = new Date(selectedEvent.end_date);
    const days = [];
    let current = new Date(start);

    while (current <= end) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    return days;
  };

  // Helper to get day label with alias
  const getDayLabel = (day: Date, dayNumber: number) => {
    const dateStr = day.toISOString().split("T")[0];
    const alias = selectedEvent?.meta_data?.day_aliases?.[dateStr] || null;

    if (alias) {
      return alias;
    }

    return `Day ${dayNumber}`;
  };

  const handleClearAllTasks = async () => {
    if (
      window.confirm(
        `Are you sure you want to clear all tasks for the current event (${selectedEvent?.name})? This action cannot be undone.`,
      )
    ) {
      await clearAll();
      alert(`All task instances have been cleared for the current event.`);
    }
  };

  if (!selectedEvent) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Please select an event to build tasks.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Spinner />
      </div>
    );
  }

  const eventDays = getEventDays();

  return (
    <div className="h-[calc(100vh-200px)] flex flex-col p-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Task Builder
          </h3>
          <p className="text-sm text-foreground-muted">
            Build and configure tasks for {selectedEvent.name}
          </p>
        </div>
        <Tooltip
          content="Clear all task instances for this event"
          side="bottom"
        >
          <button
            onClick={handleClearAllTasks}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
          >
            Clear All Tasks
          </button>
        </Tooltip>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        <div className="flex-1 flex gap-4 overflow-hidden">
          {/* Left Sidebar - Template Cards */}
          <div className="w-64 flex-shrink-0 overflow-y-auto bg-surface-alt rounded-lg p-4 space-y-2">
            <h4 className="font-medium text-sm text-foreground-secondary mb-3 uppercase tracking-wide">
              Task Templates
            </h4>
            {templates.length === 0 ? (
              <p className="text-sm text-foreground-muted italic">
                No templates available
              </p>
            ) : (
              templates
                .slice()
                .sort((a, b) => {
                  const taskTypeA = taskTypes.find(
                    (t) => t.id === a.task_type_id,
                  );
                  const taskTypeB = taskTypes.find(
                    (t) => t.id === b.task_type_id,
                  );
                  const sortOrderA = taskTypeA?.sort_order ?? 0;
                  const sortOrderB = taskTypeB?.sort_order ?? 0;
                  return sortOrderA - sortOrderB;
                })
                .map((template) => {
                  const taskType = taskTypes.find(
                    (t) => t.id === template.task_type_id,
                  );
                  const typeColor = taskType?.color || "#9CA3AF";

                  // Helper function to convert hex to RGB
                  const hexToRgb = (hex: string) => {
                    const result =
                      /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                    return result
                      ? {
                          r: parseInt(result[1], 16),
                          g: parseInt(result[2], 16),
                          b: parseInt(result[3], 16),
                        }
                      : { r: 156, g: 163, b: 175 }; // default gray
                  };

                  const rgb = hexToRgb(typeColor);
                  const backgroundColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1)`;
                  const borderColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`;
                  const hoverBorderColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)`;

                  return (
                    <div
                      key={template.id}
                      className={`relative transition-all duration-200 ease-in-out cursor-pointer ${
                        hoveredTemplate === template.id ||
                        selectedTemplate?.id === template.id
                          ? "h-auto"
                          : "h-12"
                      }`}
                      onMouseEnter={() => setHoveredTemplate(template.id)}
                      onMouseLeave={() => setHoveredTemplate(null)}
                      onClick={() => handleTemplateClick(template)}
                    >
                      <div
                        className={`rounded-lg shadow-sm border-2 p-3 transition-all ${
                          selectedTemplate?.id === template.id
                            ? "shadow-md"
                            : "hover:shadow-md"
                        }`}
                        style={{
                          backgroundColor:
                            selectedTemplate?.id === template.id
                              ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`
                              : backgroundColor,
                          borderColor:
                            selectedTemplate?.id === template.id ||
                            hoveredTemplate === template.id
                              ? hoverBorderColor
                              : borderColor,
                        }}
                      >
                        {/* Always visible - Template name and description */}
                        <div className="flex items-center gap-2">
                          <div className="font-medium text-foreground text-sm flex-shrink-0">
                            {template.name}
                          </div>
                          {template.description && (
                            <div className="text-xs text-foreground-muted italic truncate">
                              {template.description}
                            </div>
                          )}
                        </div>

                        {/* Expanded content on hover */}
                        {(hoveredTemplate === template.id ||
                          selectedTemplate?.id === template.id) && (
                          <div className="mt-2 text-xs text-foreground-muted space-y-2">
                            <div className="space-y-1">
                              <p className="font-semibold text-foreground-secondary">
                                Conditions:
                              </p>
                              {sortFields(
                                template.fields?.filter(
                                  (field) =>
                                    getFieldCategory(field).category ===
                                    "conditions",
                                ) || [],
                              ).map((field) => (
                                <div
                                  key={field.id}
                                  className="flex items-center gap-1"
                                >
                                  <span
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: typeColor }}
                                  ></span>
                                  <span>{field.name}</span>
                                  {field.required && (
                                    <span className="text-red-500">*</span>
                                  )}
                                </div>
                              ))}
                              {(template.fields?.filter(
                                (field) =>
                                  getFieldCategory(field).category ===
                                  "conditions",
                              ).length ?? 0) === 0 && (
                                <p className="text-foreground-muted italic">
                                  No conditions defined
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
            )}
          </div>

          {/* Center - Selected Template Configuration */}
          <div className="flex-1 overflow-y-auto bg-surface rounded-lg border border-bordercl p-6">
            {selectedTemplate ? (
              <div className="max-w-2xl mx-auto">
                {(() => {
                  // Get task type color for the selected template
                  const taskType = taskTypes.find(
                    (t) => t.id === selectedTemplate.task_type_id,
                  );
                  const typeColor = taskType?.color || "#9CA3AF";

                  // Helper function to convert hex to RGB
                  const hexToRgb = (hex: string) => {
                    const result =
                      /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                    return result
                      ? {
                          r: parseInt(result[1], 16),
                          g: parseInt(result[2], 16),
                          b: parseInt(result[3], 16),
                        }
                      : { r: 156, g: 163, b: 175 };
                  };

                  const rgb = hexToRgb(typeColor);
                  const conditionsBg = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1)`;
                  const conditionsBorder = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`;
                  const arbitraryBg = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.05)`;
                  const arbitraryBorder = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`;

                  return (
                    <>
                      <div className="mb-6">
                        <h2 className="text-2xl font-bold text-foreground mb-2">
                          {selectedTemplate.name}
                        </h2>
                        {selectedTemplate.description && (
                          <p className="text-foreground-muted mb-3">
                            {selectedTemplate.description}
                          </p>
                        )}

                        {/* Task Name Input */}
                        <div className="mt-4">
                          <label className="block text-sm font-medium text-foreground-secondary mb-2">
                            Participant-visible task name
                          </label>
                          <input
                            type="text"
                            value={taskName}
                            onChange={(e) => setTaskName(e.target.value)}
                            placeholder={selectedTemplate.name}
                            className="w-full px-3 py-2 border border-bordercl-strong rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          />
                          <p className="mt-1 text-xs text-foreground-muted">Visible to assigned participants and authorised organisers.</p>
                        </div>
                      </div>

                      {/* Conditions Fields Section */}
                      {(selectedTemplate.fields?.filter(
                        (field) =>
                          getFieldCategory(field).category === "conditions",
                      ).length ?? 0) > 0 && (
                        <div
                          className="mt-6 rounded-lg border-2 p-4"
                          style={{
                            backgroundColor: conditionsBg,
                            borderColor: conditionsBorder,
                          }}
                        >
                          <div className="flex items-center gap-2 pb-3 border-b border-bordercl">
                            <h3 className="text-lg font-semibold text-foreground">
                              Conditions
                            </h3>
                          </div>
                          <p className="text-sm text-foreground-muted mb-4 mt-2">
                            Constraints that influence optimisation
                          </p>

                          <div className="grid grid-cols-2 gap-4 [&>*:last-child:nth-child(odd)]:col-span-2">
                            {sortFields(
                              selectedTemplate.fields?.filter(
                                (field) =>
                                  getFieldCategory(field).category ===
                                  "conditions",
                              ) || [],
                            ).map((field) => {
                              return (
                                <div key={field.id} className="space-y-2">
                                  <label className="block">
                                    <span className="text-sm font-medium text-foreground-secondary">
                                      {field.name}
                                      {field.required && (
                                        <span className="text-red-500 ml-1">
                                          *
                                        </span>
                                      )}
                                    </span>
                                  </label>

                                  {/* Field input based on type */}
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
                                      placeholder="Duration in minutes"
                                      className="w-full min-h-[52px] p-3 text-sm border-2 border-bordercl-strong rounded-lg bg-surface-alt focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                                        className="flex-1 min-h-[52px] p-3 text-sm border-2 border-bordercl-strong rounded-lg bg-surface-alt focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                                        className="flex-1 min-h-[52px] p-3 text-sm border-2 border-bordercl-strong rounded-lg bg-surface-alt focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                                        className="flex-1 min-h-[52px] p-3 text-sm border-2 border-bordercl-strong rounded-lg bg-surface-alt focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                                        className="flex-1 min-h-[52px] p-3 text-sm border-2 border-bordercl-strong rounded-lg bg-surface-alt focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                      />
                                    </div>
                                  )}

                                  {field.type === "capabilities_list" && (
                                    <div className="space-y-2">
                                      <ResourceSelector
                                        type="capability"
                                        availableResources={capabilities.map(
                                          (c) => ({
                                            id: c.id,
                                            name: c.name,
                                            description: c.description,
                                          }),
                                        )}
                                        selectedResources={(
                                          taskData[field.id] || []
                                        ).map((cap: any) => {
                                          const capability = capabilities.find(
                                            (c) => c.id === cap.id,
                                          );
                                          return {
                                            id: cap.id,
                                            name: capability?.name || "",
                                            description:
                                              capability?.description,
                                            quantity: cap.quantity,
                                          };
                                        })}
                                        onAdd={(resource) => {
                                          const currentCaps =
                                            taskData[field.id] || [];
                                          handleFieldChange(field.id, [
                                            ...currentCaps,
                                            { id: resource.id, quantity: 1 },
                                          ]);
                                        }}
                                        onRemove={(id) => {
                                          const currentCaps =
                                            taskData[field.id] || [];
                                          handleFieldChange(
                                            field.id,
                                            currentCaps.filter(
                                              (c: any) => c.id !== id,
                                            ),
                                          );
                                        }}
                                        onChangeQuantity={(id, quantity) => {
                                          const currentCaps =
                                            taskData[field.id] || [];
                                          handleFieldChange(
                                            field.id,
                                            currentCaps.map((c: any) =>
                                              c.id === id
                                                ? { ...c, quantity }
                                                : c,
                                            ),
                                          );
                                        }}
                                        allowMultiple={true}
                                        allowQuantity={true}
                                      />
                                    </div>
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
                                          const currentIds =
                                            taskData[field.id] || [];
                                          handleFieldChange(
                                            field.id,
                                            mergeGroupMemberSelections(
                                              currentIds,
                                              [
                                                {
                                                  type: "person",
                                                  id: resource.id,
                                                },
                                              ],
                                            ),
                                          );
                                        }}
                                        onAddGroup={(group) => {
                                          const currentIds =
                                            taskData[field.id] || [];
                                          handleFieldChange(
                                            field.id,
                                            mergeGroupMemberSelections(
                                              currentIds,
                                              [{ type: "group", id: group.id }],
                                            ),
                                          );
                                        }}
                                        onRemove={(id, resourceType) => {
                                          const currentIds =
                                            taskData[field.id] || [];
                                          handleFieldChange(
                                            field.id,
                                            removeGroupMemberSelection(
                                              currentIds,
                                              resourceType || "person",
                                              id,
                                            ),
                                          );
                                        }}
                                        allowMultiple={true}
                                        supportsGroups={true}
                                      />
                                      <p className="mt-1 text-xs text-foreground-muted">
                                        Included groups are resolved when
                                        checking or optimising.
                                      </p>
                                    </>
                                  )}

                                  {field.type === "location" && (
                                    <ResourceSelector
                                      type="location"
                                      availableResources={locations.map(
                                        (loc) => ({
                                          id: loc.id,
                                          name: loc.name,
                                        }),
                                      )}
                                      selectedResources={
                                        taskData[field.id] === null
                                          ? [
                                              {
                                                id: ANY_LOCATION_ID,
                                                name: "Any Location",
                                              },
                                            ]
                                          : taskData[field.id]
                                            ? locations
                                                .filter(
                                                  (loc) =>
                                                    loc.id ===
                                                    taskData[field.id],
                                                )
                                                .map((loc) => ({
                                                  id: loc.id,
                                                  name: loc.name,
                                                }))
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
                                        handleFieldChange(field.id, "");
                                      }}
                                      allowMultiple={false}
                                      allowAnyLocation={true}
                                    />
                                  )}

                                  {field.type ===
                                    "dynamic_transfer_allocation" && (
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

                                  {field.type === "transferee" && (
                                    <div className="w-full min-h-[52px] p-3 text-sm border-2 border-bordercl-strong rounded-lg bg-surface-alt opacity-50 cursor-not-allowed">
                                      <span className="text-foreground-faint italic">
                                        Will be filled by the optimiser
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Arbitrary Fields Section */}
                      {(selectedTemplate.fields?.filter(
                        (field) =>
                          getFieldCategory(field).category === "arbitrary",
                      ).length ?? 0) > 0 && (
                        <div
                          className="rounded-lg border-2 p-4 mt-4"
                          style={{
                            backgroundColor: arbitraryBg,
                            borderColor: arbitraryBorder,
                          }}
                        >
                          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-bordercl">
                            <h4 className="font-semibold text-foreground">
                              Additional Information
                            </h4>
                          </div>

                          <div className="grid grid-cols-2 gap-4 [&>*:last-child:nth-child(odd)]:col-span-2">
                            {sortFields(
                              selectedTemplate.fields?.filter(
                                (field) =>
                                  getFieldCategory(field).category ===
                                  "arbitrary",
                              ) || [],
                            ).map((field) => {
                              return (
                                <div key={field.id} className="space-y-2">
                                  <label className="block">
                                    <span className="text-sm font-medium text-foreground-secondary">
                                      {field.name}
                                      {field.required && (
                                        <span className="text-red-500 ml-1">
                                          *
                                        </span>
                                      )}
                                    </span>
                                  </label>

                                  {/* Field input based on type */}
                                  {(field.type === "text" ||
                                    field.type === "link") && (
                                    <input
                                      type="text"
                                      value={taskData[field.id] || ""}
                                      onChange={(e) =>
                                        handleFieldChange(
                                          field.id,
                                          e.target.value,
                                        )
                                      }
                                      className="w-full min-h-[52px] p-3 text-sm border-2 border-bordercl-strong rounded-lg bg-surface-alt focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                      placeholder={
                                        field.type === "link"
                                          ? `Enter URL or link`
                                          : `Enter ${(field.name || field.label || "value").toLowerCase()}`
                                      }
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
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-foreground-faint">
                <div className="text-center">
                  <p className="text-lg font-medium text-foreground-muted">
                    No Template Selected
                  </p>
                  <p className="text-sm text-foreground-faint">
                    Click on a template card on the left to begin
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Submit Panel - Bottom */}
        <div className="bg-surface rounded-lg border border-bordercl p-4">
          <div className="flex items-center gap-6">
            {/* Day Selection - Horizontal */}
            <div className="flex-1">
              {eventDays.length === 0 ? (
                <p className="text-sm text-foreground-muted italic">
                  No event dates defined
                </p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {eventDays.map((day, index) => (
                    <label
                      key={index}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-bordercl hover:bg-surface-hover cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDays.includes(index)}
                        onChange={() => handleDayToggle(index)}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-sm text-foreground-secondary font-medium">
                        {getDayLabel(day, index + 1)}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Submit Button */}
            <div className="flex items-center gap-3">
              {selectedTemplate && selectedDays.length > 0 && (
                <span className="text-sm text-foreground-muted">
                  {selectedDays.length} day(s) selected
                </span>
              )}
              <Button
                variant="primary"
                onClick={handleSubmitToSchedule}
                disabled={!selectedTemplate || selectedDays.length === 0}
                className="flex items-center justify-center gap-2 whitespace-nowrap"
              >
                Submit to Schedule
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
