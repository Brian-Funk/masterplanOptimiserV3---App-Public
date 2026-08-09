"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Send, ArrowLeft, ArrowRight, RotateCcw, LockKeyhole } from "lucide-react";
import { Spinner, Tooltip } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import {
  locationsApi,
  Location,
  personsApi,
  Person,
  taskTypesApi,
  TaskType,
  taskTemplatesApi,
  TaskTemplate,
  tasksApi,
  groupsApi,
  masterplanLayoutApi,
  eventStatusApi,
  googleCalendarApi,
  mpBackendApi,
  appSettingsApi,
  type PublishTarget,
} from "@/lib/api";
import Calendar, { CalendarTask } from "@/components/Calendar";
import PersonReplacementMenu from "@/components/PersonReplacementMenu";
import { MasterplanTaskDetailModal } from "./masterplan/MasterplanTaskDetailModal";
import type { BackendTask, MasterplanLayout } from "@/types/masterplan";
import { formatDateShort, formatDateWithWeekday } from "@/lib/dateFormat";
import { useShortcuts } from "@/contexts/ShortcutContext";
import { isEditableTarget } from "@/lib/shortcuts";
import {
  confidenceClasses,
  getEventStatusConfidence,
  getPublishTargetConfidence,
} from "@/lib/confidence";
import {
  getScheduleDayBoundaryFromRange,
  isTaskInWorkingDay,
} from "@/lib/workingDayBoundary";
import {
  mergeRuntimeGroupFieldDisplay,
  resolveRuntimeGroupAssignmentsForFields,
} from "@/lib/groupMembers";

export function ScheduleTab({ selectedEvent }: { selectedEvent: any }) {
  const { addToast } = useToast();
  const { matchesShortcut } = useShortcuts();
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [backendTasks, setBackendTasks] = useState<BackendTask[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [layouts, setLayouts] = useState<MasterplanLayout[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(
    selectedEvent?.start_date || new Date().toISOString().split("T")[0],
  );
  const [editingTask, setEditingTask] = useState<CalendarTask | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [replacementMenu, setReplacementMenu] = useState<{
    x: number;
    y: number;
    taskId: number;
    personId: number;
    personName: string;
  } | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishTarget, setPublishTarget] = useState<PublishTarget>("none");
  const [eventStatus, setEventStatus] = useState<string>(
    selectedEvent?.status || "draft",
  );

  // Keep eventStatus in sync when selectedEvent prop changes (e.g. after optimisation)
  useEffect(() => {
    if (selectedEvent?.status) {
      setEventStatus(selectedEvent.status);
    }
  }, [selectedEvent?.status]);

  // Load publish target setting
  useEffect(() => {
    appSettingsApi
      .getPublishTarget()
      .then((pt) => setPublishTarget(pt.target))
      .catch(() => {});
  }, []);

  // Date helpers
  const getDayInfo = useCallback(() => {
    if (!selectedEvent?.start_date) return null;
    const startDate = new Date(selectedEvent.start_date + "T00:00:00");
    const currentDate = new Date(selectedDate + "T00:00:00");
    const dayNumber =
      Math.floor(
        (currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      ) + 1;
    const formattedDate = formatDateWithWeekday(selectedDate);
    const dayAliases = selectedEvent?.meta_data?.day_aliases || {};
    const alias = dayAliases[selectedDate] || null;
    return { dayNumber, formattedDate, alias };
  }, [selectedDate, selectedEvent]);

  const dayInfo = getDayInfo();

  const handleDateChange = (direction: "prev" | "next") => {
    const current = new Date(selectedDate + "T00:00:00");
    const newDate = new Date(current);
    newDate.setDate(newDate.getDate() + (direction === "prev" ? -1 : 1));
    // Format in local time (toISOString converts to UTC which causes timezone bugs)
    const newDateStr = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, "0")}-${String(newDate.getDate()).padStart(2, "0")}`;
    // Clamp to event bounds
    if (selectedEvent?.start_date && newDateStr < selectedEvent.start_date)
      return;
    if (selectedEvent?.end_date && newDateStr > selectedEvent.end_date) return;
    setSelectedDate(newDateStr);
  };

  // Fetch data from backend
  const fetchData = useCallback(async () => {
    if (!selectedEvent) return;
    setLoading(true);
    try {
      const [
        tasksData,
        typesData,
        personsData,
        locsData,
        templatesData,
        layoutsData,
        groupsData,
      ] = await Promise.all([
        tasksApi.getAll(selectedEvent.id),
        taskTypesApi.getAll(),
        personsApi.getAll(selectedEvent.id),
        locationsApi.getAll(selectedEvent.id),
        taskTemplatesApi.getAll(),
        masterplanLayoutApi.getAll(selectedEvent.id),
        groupsApi.getAll(selectedEvent.id),
      ]);

      setBackendTasks(tasksData);
      setTaskTypes(typesData);
      setPersons(personsData);
      setLocations(locsData);
      setTemplates(templatesData);
      setLayouts(layoutsData);
      const runtimeBoundary = getScheduleDayBoundaryFromRange(
        selectedEvent?.meta_data?.schedule_day_range,
      );

      // Convert backend tasks to CalendarTask format
      const minutesToTime = (minutes: number): string => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
      };

      const calendarTasks: CalendarTask[] = tasksData.map(
        (task: BackendTask) => {
          const template = templatesData.find(
            (t: any) => t.id === task.task_template_id,
          );
          const taskType = typesData.find(
            (t: TaskType) => t.id === task.task_type_id,
          );
          const layout = layoutsData.find(
            (l: MasterplanLayout) => l.task_id === task.id,
          );

          const schedule = task.final || task.optimised || {};
          const taskDate = task.additional?.date || selectedDate;

          // Person assignments
          const assignedPersonIds = schedule.assigned_persons || [];
          const rawFieldAssignments = schedule.field_assignments || null;
          const runtimeGroupDisplay = resolveRuntimeGroupAssignmentsForFields({
            fields: template?.fields || [],
            fieldValues: task.constraints?.field_values || {},
            groups: groupsData,
            persons: personsData,
            taskDate,
            selectedWorkingDate: selectedDate,
            workingDayBoundaryOffsetHour: runtimeBoundary.offsetHour,
            taskStart: schedule.start_time,
            taskEnd: schedule.end_time,
          });
          const {
            fieldAssignments,
            fieldAssignmentExclusions,
          } = mergeRuntimeGroupFieldDisplay(rawFieldAssignments, runtimeGroupDisplay);

          let formattedPersons = "";
          if (
            fieldAssignments &&
            Object.keys(fieldAssignments).length > 0 &&
            template?.fields
          ) {
            const fieldParts: string[] = [];
            for (const [fieldId, personIds] of Object.entries(
              fieldAssignments,
            )) {
              const fieldDef = template.fields.find(
                (f: any) => f.id === fieldId,
              );
              const fieldLabel =
                fieldDef?.name ||
                fieldId.replace(/^field_/, "").replace(/_/g, " ");
              const names = (personIds as number[])
                .map((pid: number) =>
                  personsData.find((p: any) => p.id === pid),
                )
                .filter(Boolean)
                .map((p: any) => `${p.first_name} ${p.last_name}`);
              if (names.length > 0) {
                fieldParts.push(`${fieldLabel}: ${names.join(", ")}`);
              }
            }
            formattedPersons = fieldParts.join(" | ");
          } else {
            formattedPersons = assignedPersonIds
              .map((pid: number) => personsData.find((p: any) => p.id === pid))
              .filter(Boolean)
              .map((p: any) => `${p.first_name} ${p.last_name}`)
              .join(", ");
          }

          // Location name
          const locationData = schedule.location
            ? locsData.find((l: any) => l.id === schedule.location)
            : null;
          let locationName = locationData?.name || "";

          // Transfer location display
          if (template?.fields) {
            const locationFields = template.fields.filter(
              (f: any) => f.type === "location",
            );
            const fieldValues = task.constraints?.field_values || {};
            if (locationFields.length >= 2) {
              const startLocFieldValue = fieldValues[locationFields[0].id];
              const endLocFieldValue = fieldValues[locationFields[1].id];
              const startLocId =
                typeof startLocFieldValue === "number"
                  ? startLocFieldValue
                  : startLocFieldValue?.value;
              const endLocId =
                typeof endLocFieldValue === "number"
                  ? endLocFieldValue
                  : endLocFieldValue?.value;
              const startLoc = locsData.find((l: any) => l.id === startLocId);
              const endLoc = locsData.find((l: any) => l.id === endLocId);
              if (startLoc && endLoc) {
                locationName = `${startLoc.name} → ${endLoc.name}`;
              }
            }
          }

          return {
            id: task.id,
            name: task.title,
            task_type_id: task.task_type_id,
            task_type_name: taskType?.name || "",
            task_type_color:
              layout?.custom_color || taskType?.color || "#3b82f6",
            location_id: schedule.location,
            location_name: locationName,
            resource_info: formattedPersons,
            date: taskDate,
            start_end_time:
              schedule.start_time !== undefined &&
              schedule.end_time !== undefined
                ? {
                    start: minutesToTime(schedule.start_time),
                    end: minutesToTime(schedule.end_time),
                  }
                : undefined,
            fields: task.constraints?.field_values || {},
            field_definitions: template?.fields || [],
            startTime: schedule.start_time || "",
            endTime: schedule.end_time || "",
            location: schedule.location?.toString() || "",
            color: layout?.custom_color || taskType?.color || "#3b82f6",
            taskTypeId: task.task_type_id,
            taskType: taskType?.name || "",
            templateId: task.task_template_id,
            optimised: task.optimised || {},
            final: task.final || {},
            assigned_persons: schedule.assigned_persons || [],
            field_assignments: fieldAssignments || undefined,
            field_assignment_exclusions: fieldAssignmentExclusions,
            // Masterplan layout overrides
            _layout: layout || null,
            _backendTaskId: task.id,
            _visual_x_offset: layout?.visual_x_offset ?? 0,
            _visual_width: layout?.visual_width ?? null,
          } as CalendarTask & {
            _layout: MasterplanLayout | null;
            _backendTaskId: number;
          };
        },
      );

      setTasks(calendarTasks);
    } catch (error) {
      console.error("Error fetching masterplan data:", error);
    } finally {
      setLoading(false);
    }
  }, [selectedEvent, selectedDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Update event status and clamp selectedDate when selectedEvent changes
  useEffect(() => {
    setEventStatus(selectedEvent?.status || "draft");
    if (selectedEvent?.start_date && selectedEvent?.end_date) {
      setSelectedDate((prev) => {
        if (prev < selectedEvent.start_date) return selectedEvent.start_date;
        if (prev > selectedEvent.end_date) return selectedEvent.end_date;
        return prev;
      });
    }
  }, [selectedEvent]);

  // Escape key clears selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (matchesShortcut(e, "schedule.clearSelection")) setSelectedTaskIds([]);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [matchesShortcut]);

  const scheduleDayBoundary = getScheduleDayBoundaryFromRange(
    selectedEvent?.meta_data?.schedule_day_range,
  );

  // Filter tasks for the selected working day
  const tasksForSelectedDay = tasks.filter((task) =>
    isTaskInWorkingDay(task, selectedDate, scheduleDayBoundary),
  );
  const hasData = tasksForSelectedDay.length > 0;
  const hasAnyTasks = tasks.length > 0;

  // Person swap handler (the ONLY schedule modification allowed)
  const handlePersonRightClick = (
    taskId: number,
    personId: number,
    x: number,
    y: number,
  ) => {
    const person = persons.find((p) => p.id === personId);
    const personName = person
      ? `${person.first_name} ${person.last_name}`
      : `Person ${personId}`;
    setReplacementMenu({ x, y, taskId, personId, personName });
  };

  const handlePersonReplace = async (
    taskId: number,
    oldPersonId: number,
    newPersonId: number,
  ) => {
    try {
      await tasksApi.swapPerson(taskId, selectedEvent.id, {
        old_person_id: oldPersonId,
        new_person_id: newPersonId,
      });
      setReplacementMenu(null);
      fetchData(); // Refresh after swap
    } catch (error) {
      console.error("Failed to swap person:", error);
      alert(
        `Failed to swap person: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  // Layout change handler (cosmetic edits)
  const handleLayoutChange = async (
    taskId: number,
    changes: {
      visual_height?: number;
      visual_x_offset?: number;
      visual_width?: number;
      custom_color?: string;
    },
  ) => {
    try {
      await masterplanLayoutApi.upsert(taskId, selectedEvent?.id, changes);
      // Update local state
      setLayouts((prev) => {
        const existing = prev.find((l) => l.task_id === taskId);
        if (existing) {
          return prev.map((l) =>
            l.task_id === taskId ? { ...l, ...changes } : l,
          );
        }
        return [
          ...prev,
          {
            id: 0,
            event_id: selectedEvent?.id || 0,
            task_id: taskId,
            ...changes,
          } as MasterplanLayout,
        ];
      });
      // Update task card color if color changed
      if (changes.custom_color) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  task_type_color: changes.custom_color!,
                  color: changes.custom_color!,
                }
              : t,
          ),
        );
      }
      // Update task layout fields if x_offset or width changed
      if (
        changes.visual_x_offset !== undefined ||
        changes.visual_width !== undefined
      ) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  ...(changes.visual_x_offset !== undefined && {
                    _visual_x_offset: changes.visual_x_offset,
                  }),
                  ...(changes.visual_width !== undefined && {
                    _visual_width: changes.visual_width,
                  }),
                }
              : t,
          ),
        );
      }
    } catch (error) {
      console.error("Failed to update layout:", error);
    }
  };

  // Reset all cosmetic changes (layouts) for the event
  const handleResetLayouts = async () => {
    if (!selectedEvent) return;
    if (
      !confirm(
        "This will reset all cosmetic changes (positions, sizes, colours) back to defaults. Continue?",
      )
    )
      return;
    try {
      await masterplanLayoutApi.deleteAllForEvent(selectedEvent.id);
      setLayouts([]);
      fetchData(); // Full refresh to rebuild tasks without layout overrides
    } catch (error) {
      console.error("Failed to reset layouts:", error);
      alert("Failed to reset layouts.");
    }
  };

  const publishTargetLabel =
    publishTarget === "google"
      ? "Google Calendar"
      : publishTarget === "mp-backend"
        ? "MP-Backend Server"
        : publishTarget === "none"
          ? "None"
          : "Google Calendar & MP-Backend Server";
  const eventConfidence = getEventStatusConfidence(eventStatus);
  const publishConfidence = getPublishTargetConfidence(publishTarget);

  // Publish handler
  const handlePublish = async () => {
    if (!selectedEvent) return;

    if (publishTarget === "none") {
      addToast(
        "No publish target configured. Go to Settings \u2192 Publish Target to set one up.",
        "error",
      );
      return;
    }

    if (
      !confirm(
        `Publish to ${publishTargetLabel}?\nThis will make the schedule available. Are you sure?`,
      )
    )
      return;

    setIsPublishing(true);
    try {
      // Use the publish target from state (loaded on mount)
      const target = publishTarget;
      const errors: string[] = [];
      let gcEventsCreated = 0;

      // Publish to Google Calendar (if target includes it)
      if (target === "google" || target === "both") {
        try {
          const gcResult = await googleCalendarApi.publish(selectedEvent.id);
          gcEventsCreated = gcResult.events_created || 0;
        } catch (gcError: any) {
          const msg =
            gcError instanceof Error ? gcError.message : String(gcError);
          if (msg.includes("404") || msg.includes("No Google Calendar")) {
            errors.push(
              "Google Calendar is not linked. Connect a calendar in Settings first.",
            );
          } else {
            errors.push(`Google Calendar: ${msg}`);
          }
        }
      }

      // Publish to MP-Backend server (if target includes it)
      if (target === "mp-backend" || target === "both") {
        try {
          const mpResult = await mpBackendApi.publish(selectedEvent.id);
        } catch (mpError: any) {
          const msg =
            mpError instanceof Error ? mpError.message : String(mpError);
          if (msg.includes("not configured")) {
            errors.push(
              "MP-Backend server is not configured. Set it up in Settings first.",
            );
          } else {
            errors.push(`MP-Backend: ${msg}`);
          }
        }
      }

      if (errors.length > 0) {
        addToast(`Publish failed:\n${errors.join("\n")}`, "error");
      } else {
        await eventStatusApi.update(selectedEvent.id, "published");
        setEventStatus("published");
        const detail =
          gcEventsCreated > 0
            ? ` (${gcEventsCreated} Google Calendar event(s) created)`
            : "";
        addToast(`Published to ${publishTargetLabel}!${detail}`, "success");
      }
    } catch (error) {
      console.error("Failed to publish:", error);
      addToast(
        `Failed to publish: ${error instanceof Error ? error.message : "Unknown error"}`,
        "error",
      );
    } finally {
      setIsPublishing(false);
    }
  };

  // Task detail view (double-click)
  const handleTaskEdit = (task: CalendarTask) => {
    setEditingTask(task);
  };

  if (!selectedEvent) {
    return (
      <div className="p-6 text-center text-foreground-muted">
        Please select an event to view the masterplan.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-foreground">Masterplan</h3>
          <span className="inline-flex items-center gap-1 rounded-full border border-bordercl px-2 py-0.5 text-xs font-medium text-foreground-muted">
            <LockKeyhole className="h-3 w-3" /> Authenticated
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${confidenceClasses(
              eventConfidence.level,
              "badge",
            )}`}
            title={eventConfidence.description}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${confidenceClasses(
                eventConfidence.level,
                "dot",
              )}`}
            />
            {eventConfidence.label}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${confidenceClasses(
              publishConfidence.level,
              "badge",
            )}`}
            title={publishConfidence.description}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${confidenceClasses(
                publishConfidence.level,
                "dot",
              )}`}
            />
            {publishConfidence.label}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Publish button - available when optimised, finalised, or already published (re-publish) */}
          {(eventStatus === "finalised" ||
            eventStatus === "optimised" ||
            eventStatus === "published") && (
            <Tooltip content={`Publish to ${publishTargetLabel}`} side="bottom">
              <button
                onClick={handlePublish}
                disabled={isPublishing || !hasAnyTasks}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-1 ${confidenceClasses(
                  publishConfidence.level,
                  "button",
                )}`}
              >
                <Send className="w-3.5 h-3.5" />
                {isPublishing ? "Publishing..." : "Publish"}
              </button>
            </Tooltip>
          )}

          {/* Reset cosmetic changes */}
          {layouts.length > 0 && (
            <Tooltip
              content="Reset all cosmetic changes (positions, sizes, colours)"
              side="bottom"
            >
              <button
                onClick={handleResetLayouts}
                className="px-2 py-1 text-xs font-medium text-red-600 bg-red-50 dark:bg-red-950/30 rounded hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Reset Layout
              </button>
            </Tooltip>
          )}

          {/* Refresh */}
          <Tooltip content="Refresh" side="bottom">
            <button
              onClick={() => fetchData()}
              className="px-2 py-1 text-xs font-medium text-foreground-secondary bg-surface-inset rounded hover:bg-surface-inset dark:bg-surface-hover transition-colors"
            >
              ↻
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Date navigation */}
      {dayInfo && (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => handleDateChange("prev")}
            disabled={selectedDate <= selectedEvent?.start_date}
            className="px-2 py-1 text-xs font-medium text-foreground-secondary bg-surface-inset rounded hover:bg-surface-inset dark:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            ←
          </button>
          <span className="px-2 py-1 text-xs font-medium text-foreground bg-surface-alt rounded border border-bordercl">
            {dayInfo.alias
              ? `${dayInfo.alias} (Day ${dayInfo.dayNumber}) - ${dayInfo.formattedDate}`
              : dayInfo.formattedDate}
          </span>
          <button
            onClick={() => handleDateChange("next")}
            disabled={selectedDate >= selectedEvent?.end_date}
            className="px-2 py-1 text-xs font-medium text-foreground-secondary bg-surface-inset rounded hover:bg-surface-inset dark:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            →
          </button>
        </div>
      )}

      {/* No data message */}
      {!hasAnyTasks && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-6 text-center">
          <p className="text-amber-800 dark:text-amber-300 font-medium">
            No schedule has been finalised yet.
          </p>
          <p className="text-amber-600 text-sm mt-2">
            Optimise and finalise the schedule in the Optimisation tab first.
          </p>
        </div>
      )}

      {/* Bulk selection info-box - visible when tasks are selected */}
      {selectedTaskIds.length > 0 && (
        <div className="mb-3 rounded-md border border-bordercl bg-surface px-3 py-2 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-foreground">
                {selectedTaskIds.length} selected{" "}
                {selectedTaskIds.length === 1 ? "task" : "tasks"}
              </h3>
              <p className="mt-0.5 text-xs text-foreground-muted">
                Press{" "}
                <kbd className="rounded border border-bordercl bg-surface-inset px-1.5 py-0.5 font-mono text-[11px] text-foreground-secondary">
                  Esc
                </kbd>{" "}
                to clear
              </p>
            </div>
            <button
              onClick={() => setSelectedTaskIds([])}
              className="inline-flex items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Calendar (masterplan mode - no time edits) */}
      {hasData && (
        <Calendar
          tasks={tasksForSelectedDay}
          viewType="daily"
          selectedDate={selectedDate}
          scheduleDayRange={selectedEvent?.meta_data?.schedule_day_range}
          scheduleDayBoundary={scheduleDayBoundary}
          onTaskEdit={handleTaskEdit}
          onTaskClick={handleTaskEdit}
          onTaskShiftClick={(task) => {
            setSelectedTaskIds((prev) =>
              prev.includes(task.id)
                ? prev.filter((id) => id !== task.id)
                : [...prev, task.id],
            );
          }}
          onTaskSelect={(taskId, isSelected) => {
            if (isSelected) {
              setSelectedTaskIds((prev) => [...prev, taskId]);
            } else {
              setSelectedTaskIds((prev) => prev.filter((id) => id !== taskId));
            }
          }}
          selectedTaskIds={selectedTaskIds}
          locations={locations}
          persons={persons}
          onPersonRightClick={handlePersonRightClick}
          onPrevDay={() => handleDateChange("prev")}
          onNextDay={() => handleDateChange("next")}
          canNavigatePrev={selectedDate > selectedEvent?.start_date}
          canNavigateNext={selectedDate < selectedEvent?.end_date}
          masterplanMode={true}
          onLayoutChange={handleLayoutChange}
        />
      )}

      {/* No tasks for this specific day */}
      {hasAnyTasks && !hasData && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-6 text-center">
          <p className="text-blue-800 font-medium">
            No tasks scheduled for {formatDateShort(selectedDate)}
          </p>
          <p className="text-blue-600 text-sm mt-2">
            Use the date navigation to browse other days.
          </p>
        </div>
      )}

      {/* Task Detail Modal (double-click) */}
      {editingTask && (
        <MasterplanTaskDetailModal
          task={editingTask}
          isOpen={!!editingTask}
          onClose={() => setEditingTask(null)}
          persons={persons}
          locations={locations}
          templates={templates}
          taskTypes={taskTypes}
          selectedEvent={selectedEvent}
          onPersonSwap={async (taskId, oldPersonId, newPersonId) => {
            await handlePersonReplace(taskId, oldPersonId, newPersonId);
            setEditingTask(null);
          }}
        />
      )}

      {/* Person Replacement Context Menu */}
      {replacementMenu && (
        <PersonReplacementMenu
          x={replacementMenu.x}
          y={replacementMenu.y}
          taskId={replacementMenu.taskId}
          currentPersonId={replacementMenu.personId}
          currentPersonName={replacementMenu.personName}
          allPersons={persons}
          allTasks={tasks.map((t) => {
            const parseHHMM = (hhmm?: string): number => {
              if (!hhmm) return 0;
              const [h, m] = hhmm.split(":").map(Number);
              return (h || 0) * 60 + (m || 0);
            };
            return {
              id: t.id,
              name: t.name,
              date: t.date || selectedDate,
              startTime: parseHHMM(t.start_end_time?.start),
              endTime: parseHHMM(t.start_end_time?.end),
              assigned_persons: t.assigned_persons || [],
            };
          })}
          onReplace={handlePersonReplace}
          onClose={() => setReplacementMenu(null)}
        />
      )}
    </div>
  );
}
