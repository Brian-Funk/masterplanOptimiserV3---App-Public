"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  RefreshCw,
  RotateCcw,
  Send,
  ChevronDown,
  Presentation,
  BarChart3,
} from "lucide-react";
import { Spinner, Tooltip } from "@/components/ui";
import {
  locationsApi,
  groupsApi,
  Location,
  personsApi,
  Person,
  taskTypesApi,
  TaskType,
  taskTemplatesApi,
  TaskTemplate,
} from "@/lib/api";
import Calendar, { CalendarTask } from "@/components/Calendar";
import { OptimisedTaskEditModal } from "./OptimisedTaskEditModal";
import { SelectedTasksPanel } from "../cmi/SelectedTasksPanel";
import { PublishPreviewModal } from "@/components/publish/PublishPreviewModal";
import {
  tasksApi,
  googleCalendarApi,
  eventStatusApi,
  mpBackendApi,
  appSettingsApi,
  publishStateApi,
  eventsApi,
  ApiRequestError,
  dataPolicyAcknowledgementGuidance,
  type MpBackendDataPolicy,
  type PublishTarget,
} from "@/lib/api";
import PersonReplacementMenu from "@/components/PersonReplacementMenu";
import { useTaskInstances } from "@/contexts/TaskInstanceContext";
import { useToast } from "@/contexts/ToastContext";
import { useEvent } from "@/contexts/EventContext";
import { formatDateShort, formatDateWithWeekday } from "@/lib/dateFormat";
import { minutesToTime, toCalendarTask } from "@/lib/calendarTaskUtils";
import { useShortcuts } from "@/contexts/ShortcutContext";
import { isEditableTarget } from "@/lib/shortcuts";
import {
  confidenceClasses,
  getPublishTargetConfidence,
} from "@/lib/confidence";
import {
  detectScheduleConflicts,
  deriveDayPublishStatuses,
  deriveEventPublishStatus,
  deriveManualChangesItem,
  getLastManualEditAt,
  getScheduleFingerprint,
  getTaskChangeSummary,
  type DayPublishStatus,
  type PublishedDayRecords,
} from "@/lib/eventStatusSummary";
import {
  derivePublishPreview,
  type PublishPreview,
  type PublishPreviewScope,
} from "@/lib/publishPreview";
import { formatStatusTimestamp } from "@/lib/statusTimestamps";
import {
  getPublishTargetsLabel,
  hasPublishDestination,
} from "@/lib/publishTargets";
import { exportSchedulePdf } from "@/lib/pdfExport";
import {
  getScheduleDayBoundaryFromRange,
  getWorkingDayForDateTime,
  isTaskInWorkingDay,
} from "@/lib/workingDayBoundary";

interface OptimisedTabProps {
  selectedEvent: any;
  conflictFocusToken?: number;
  manualChangeFocusToken?: number;
}

function toNumericId(value: unknown): number | null {
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function extractCapabilityReference(value: unknown): number | null {
  if (typeof value === "number" || typeof value === "string") {
    return toNumericId(value);
  }

  if (!value || typeof value !== "object") return null;

  const item = value as Record<string, any>;
  return (
    toNumericId(item.id) ??
    toNumericId(item.capability_id) ??
    toNumericId(item.capabilityId) ??
    toNumericId(item.capability?.id) ??
    toNumericId(item.value)
  );
}

function capabilityListIncludes(
  value: unknown,
  capabilityId: number,
  allowPrimitiveIds: boolean,
): boolean {
  if (!Array.isArray(value)) return false;

  return value.some((item) => {
    if (
      !allowPrimitiveIds &&
      (typeof item === "number" || typeof item === "string")
    ) {
      return false;
    }
    return extractCapabilityReference(item) === capabilityId;
  });
}

function taskRequiresCapability(
  task: CalendarTask,
  capabilityId: number,
): boolean {
  const rawTask = task as any;

  if (
    Array.isArray(rawTask.capability_ids) &&
    rawTask.capability_ids.some(
      (id: unknown) => toNumericId(id) === capabilityId,
    )
  ) {
    return true;
  }

  if (
    Array.isArray(rawTask.task_capabilities) &&
    rawTask.task_capabilities.some(
      (item: unknown) => extractCapabilityReference(item) === capabilityId,
    )
  ) {
    return true;
  }

  const fieldSources = [task.fields, rawTask.field_values].filter(
    (fields) => fields && typeof fields === "object",
  );
  const capabilityFields = (task.field_definitions || []).filter(
    (field) => field.type === "capabilities_list",
  );

  if (capabilityFields.length > 0) {
    return fieldSources.some((fields) =>
      capabilityFields.some((field) =>
        capabilityListIncludes(
          (fields as Record<string, unknown>)[field.id],
          capabilityId,
          true,
        ),
      ),
    );
  }

  return fieldSources.some((fields) =>
    Object.values(fields as Record<string, unknown>).some((value) =>
      capabilityListIncludes(value, capabilityId, false),
    ),
  );
}

/** Collect assigned person ids from both flat and per-field schedule assignments. */
function collectSchedulePersonIds(schedule: any): number[] {
  const ids = new Set<number>();
  const addId = (value: unknown) => {
    const numeric = toNumericId(value);
    if (numeric !== null) ids.add(numeric);
  };

  if (Array.isArray(schedule?.assigned_persons)) {
    schedule.assigned_persons.forEach(addId);
  }

  if (schedule?.field_assignments && typeof schedule.field_assignments === "object") {
    Object.values(schedule.field_assignments).forEach((value) => {
      if (Array.isArray(value)) value.forEach(addId);
    });
  }

  return Array.from(ids).sort((a, b) => a - b);
}

/** Format a schedule's concrete time range for manual-change details. */
function formatScheduleTimeRange(schedule: any): string | null {
  const toTimeLabel = (value: unknown): string | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return minutesToTime(value);
    }
    if (typeof value === "string" && value.includes(":")) {
      return value;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? minutesToTime(numeric) : null;
  };

  const start = toTimeLabel(schedule?.start_time);
  const end = toTimeLabel(schedule?.end_time);
  return start && end ? `${start}-${end}` : null;
}

/** Resolve a schedule location id to the visible location name. */
function formatScheduleLocation(
  schedule: any,
  locations: Location[],
): string | null {
  const locationId = toNumericId(schedule?.location ?? schedule?.location_id);
  if (locationId === null) return null;
  return locations.find((location) => location.id === locationId)?.name ?? null;
}

/** Resolve assigned person ids to visible names for comparison details. */
function formatSchedulePeople(schedule: any, persons: Person[]): string | null {
  const ids = collectSchedulePersonIds(schedule);
  if (ids.length === 0) return null;
  const names = ids.map((personId) => {
    const person = persons.find((candidate) => candidate.id === personId);
    return person
      ? `${person.first_name} ${person.last_name}`
      : `Person ${personId}`;
  });
  return names.join(", ");
}

/** Build a short human-readable snapshot for original and current schedules. */
function describeScheduleSnapshot(
  label: string,
  schedule: any,
  persons: Person[],
  locations: Location[],
): string | null {
  if (!schedule || typeof schedule !== "object") return null;

  const parts = [
    formatScheduleTimeRange(schedule),
    formatScheduleLocation(schedule, locations),
    formatSchedulePeople(schedule, persons),
  ].filter(Boolean);

  return parts.length > 0 ? `${label}: ${parts.join(" / ")}` : null;
}

/** Resolve the first concrete start time from a task instance schedule. */
function getInstanceStartMinutes(instance: any): number {
  const schedule = instance?.final || instance?.optimised || {};
  const value = schedule.start_time;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.includes(":")) {
    const [hours, minutes] = value.split(":").map(Number);
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return hours * 60 + minutes;
    }
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}

/** Resolve the first concrete start clock from a task instance template. */
function getTaskInstanceStartClock(
  instance: any,
  templates: TaskTemplate[],
): string | null {
  const template = templates.find((item: any) => item.id === instance.template_id);
  if (!template?.fields || !instance.field_values) return null;
  for (const field of template.fields) {
    const value = instance.field_values[field.id];
    if (field.type === "start_end_time" && value?.start) return value.start;
    if (field.type === "time_range" && value?.start) return value.start;
    if (field.type === "time" && typeof value === "string") return value;
  }
  return null;
}

/** Sort event instances in the order users expect to review them. */
function sortInstancesByScheduleOrder<T extends { date?: string; id?: number }>(
  instances: T[],
): T[] {
  return [...instances].sort((a: any, b: any) => {
    const dateCompare = String(a.date || "").localeCompare(String(b.date || ""));
    if (dateCompare !== 0) return dateCompare;
    const timeCompare = getInstanceStartMinutes(a) - getInstanceStartMinutes(b);
    if (timeCompare !== 0) return timeCompare;
    return Number(a.id || 0) - Number(b.id || 0);
  });
}

/** Return all event day ids in YYYY-MM-DD format. */
function getEventDayIds(event: any): string[] {
  if (!event?.start_date || !event?.end_date) return [];
  const start = new Date(`${event.start_date}T00:00:00`);
  const end = new Date(`${event.end_date}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const days: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    days.push(
      `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(
        2,
        "0",
      )}-${String(current.getDate()).padStart(2, "0")}`,
    );
    current.setDate(current.getDate() + 1);
  }
  return days;
}

/** Return the visible day label used in publish preview copy. */
function getEventDayLabel(event: any, dayId: string): string {
  return event?.meta_data?.day_aliases?.[dayId] || formatDateShort(dayId);
}

/** Build a concise success toast after an all-days publish attempt. */
function buildAllDaysPublishToast(
  publishedDays: number,
  totalDays: number,
  notReadyDays: number,
): string {
  if (publishedDays === totalDays && notReadyDays === 0) {
    return `All ${totalDays} ${totalDays === 1 ? "day" : "days"} published successfully.`;
  }
  const notReadyText =
    notReadyDays > 0
      ? ` ${notReadyDays} ${notReadyDays === 1 ? "day was" : "days were"} not ready.`
      : "";
  return `Published ${publishedDays} of ${totalDays} days.${notReadyText}`;
}

/** Build a concise success toast after a selected-day publish. */
function buildSelectedDayPublishToast(
  dayLabel: string,
  eventStatus: ReturnType<typeof deriveEventPublishStatus>,
): string {
  if (eventStatus.state === "fully_published") {
    return `${dayLabel} published successfully. Event is fully published.`;
  }
  if (eventStatus.publishedDays > 0) {
    return `${dayLabel} published successfully. Event is partially published: ${eventStatus.publishedDays} of ${eventStatus.totalDays} days are up to date.`;
  }
  return `${dayLabel} published successfully.`;
}

/** Describe the selected day's publish state for the Optimised tab subtitle. */
function describeSelectedDayPublishStatus(
  status: DayPublishStatus | undefined,
): string | null {
  if (!status) return null;
  const publishedAt = formatStatusTimestamp(status.lastPublishedAt);

  if (status.publishFailed) {
    return "day publish failed";
  }
  if (!status.isPublishable) {
    if (!status.isOptimisedOrFinalised) return "not ready to publish";
    if (status.conflictCount > 0) return "publish blocked by conflicts";
    return "not ready to publish";
  }
  if (status.hasChangesSincePublish) {
    return publishedAt
      ? `changes pending since publish ${publishedAt}`
      : "changes pending since publish";
  }
  if (status.isPublished) {
    return publishedAt ? `published ${publishedAt}` : "day published";
  }
  return "day not published";
}

export function OptimisedTab({
  selectedEvent,
  conflictFocusToken = 0,
  manualChangeFocusToken = 0,
}: OptimisedTabProps) {
  const { addToast } = useToast();
  const { refreshEvents } = useEvent();
  const { matchesShortcut, getShortcutBinding } = useShortcuts();
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split("T")[0],
  );
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [editingTask, setEditingTask] = useState<CalendarTask | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [metricHighlightedTaskIds, setMetricHighlightedTaskIds] = useState<
    number[]
  >([]);
  const [focusHighlightedTaskIds, setFocusHighlightedTaskIds] = useState<
    number[]
  >([]);
  const [pendingScrollTaskId, setPendingScrollTaskId] = useState<number | null>(
    null,
  );
  const [replacementMenu, setReplacementMenu] = useState<{
    x: number;
    y: number;
    taskId: number;
    personId: number;
    personName: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const metricsWindowRef = useRef<Window | null>(null);
  const presentWindowRef = useRef<Window | null>(null);
  const presentWindowEventIdRef = useRef<number | null>(null);
  const publishSelectedDayRef = useRef<() => void>(() => {});
  const publishAllDaysRef = useRef<() => void>(() => {});
  const {
    instances: contextInstances,
    updateInstance,
    deleteInstance,
    deleteInstances,
    createInstances,
  } = useTaskInstances();

  // Keep a ref to always have the latest instances (avoids stale closures)
  const instancesRef = useRef(contextInstances);
  instancesRef.current = contextInstances;

  // Close the metrics/presentation windows when leaving the OptimisedTab
  useEffect(() => {
    return () => {
      try {
        if (metricsWindowRef.current && !metricsWindowRef.current.closed) {
          metricsWindowRef.current.close();
        }
      } catch {}
      metricsWindowRef.current = null;
      try {
        if (presentWindowRef.current && !presentWindowRef.current.closed) {
          presentWindowRef.current.close();
        }
      } catch {}
      presentWindowRef.current = null;
      presentWindowEventIdRef.current = null;
    };
  }, []);

  // Update selected date when event changes
  useEffect(() => {
    if (selectedEvent?.start_date) {
      setSelectedDate(selectedEvent.start_date);
    }
  }, [selectedEvent]);

  // Explicit refresh counter — avoids the old instanceVersion approach which
  // recomputed a huge string on every context update, triggering fetchData
  // (and a full page re-render) whenever arrow-key moves updated an instance.
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const postPresentationDateChange = useCallback(
    (date: string) => {
      if (!selectedEvent?.id) return;
      try {
        const channel = new BroadcastChannel("presentation-sync");
        channel.postMessage({
          action: "date-change",
          source: "optimised",
          eventId: selectedEvent.id,
          date,
        });
        channel.close();
      } catch {
        // BroadcastChannel not supported
      }
    },
    [selectedEvent?.id],
  );

  const openPresentationWindow = useCallback(() => {
    if (!selectedEvent?.id) return;

    const url = `/present?event=${selectedEvent.id}&date=${encodeURIComponent(
      selectedDate,
    )}`;

    const existingWindow = presentWindowRef.current;
    const existingWindowOpen = existingWindow && !existingWindow.closed;
    const shouldNavigate =
      !existingWindowOpen ||
      presentWindowEventIdRef.current !== selectedEvent.id;

    if (existingWindowOpen && !shouldNavigate) {
      existingWindow.focus();
    } else {
      const presentWindow = window.open(
        url,
        "presentWindow",
        "width=1200,height=800,left=100,top=100,resizable=yes,scrollbars=yes",
      );

      if (!presentWindow) {
        alert("Please allow popups to open the presentation window.");
        return;
      }

      presentWindowRef.current = presentWindow;
      presentWindowEventIdRef.current = selectedEvent.id;
    }

    postPresentationDateChange(selectedDate);
    window.setTimeout(() => postPresentationDateChange(selectedDate), 250);
    window.setTimeout(() => postPresentationDateChange(selectedDate), 1000);
  }, [postPresentationDateChange, selectedDate, selectedEvent?.id]);

  const openMetricsWindow = useCallback(() => {
    const currentWindow = window;
    const existingWindow = metricsWindowRef.current;

    if (existingWindow && !existingWindow.closed) {
      existingWindow.focus();
    } else {
      const metricsWindow = window.open(
        "/metrics",
        "metricsWindow",
        "width=1200,height=800,left=100,top=100,resizable=yes,scrollbars=yes",
      );

      if (!metricsWindow) {
        console.error("Popup blocked. Please allow popups for this site.");
        alert("Please allow popups to open the metrics window.");
        return;
      }

      metricsWindowRef.current = metricsWindow;
    }

    setTimeout(() => {
      currentWindow.focus();
    }, 100);
  }, []);

  useEffect(() => {
    if (selectedEvent) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvent, selectedDate, refreshTrigger]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      if (matchesShortcut(e, "optimised.openMetrics")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openMetricsWindow();
        return;
      }

      if (matchesShortcut(e, "optimised.openPresentation")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openPresentationWindow();
        return;
      }

      if (matchesShortcut(e, "optimised.publishDay")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        publishSelectedDayRef.current();
        return;
      }

      if (matchesShortcut(e, "optimised.publishAllDays")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        publishAllDaysRef.current();
        return;
      }

      if (selectedTaskIds.length === 0) return;

      if (matchesShortcut(e, "optimised.resetSelected")) {
        e.preventDefault();
        handleResetSelectedToOptimised();
        return;
      }

      if (matchesShortcut(e, "optimised.moveEarlierLarge")) {
        e.preventDefault();
        handleMoveSelectedTasks(-15);
        return;
      }

      if (matchesShortcut(e, "optimised.moveLaterLarge")) {
        e.preventDefault();
        handleMoveSelectedTasks(15);
        return;
      }

      if (matchesShortcut(e, "optimised.moveEarlier")) {
        e.preventDefault();
        handleMoveSelectedTasks(-5);
        return;
      }

      if (matchesShortcut(e, "optimised.moveLater")) {
        e.preventDefault();
        handleMoveSelectedTasks(5);
        return;
      }

      if (matchesShortcut(e, "optimised.clearSelection")) {
        e.preventDefault();
        setSelectedTaskIds([]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    matchesShortcut,
    openMetricsWindow,
    openPresentationWindow,
    selectedTaskIds,
    tasks,
  ]);

  // Context auto-updates handle refreshing when instances change

  // Listen for cross-window hover highlights from MetricsBoard
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("metrics-highlight");
      channel.onmessage = (event) => {
        const msg = event.data;
        if (msg.action === "hover") {
          // Find all tasks that include this person or capability
          const hoverId = toNumericId(msg.id);
          if (hoverId === null) {
            setMetricHighlightedTaskIds([]);
            return;
          }

          const matching = tasks
            .filter((t) => {
              if (msg.type === "person" && t.assigned_persons) {
                return t.assigned_persons.includes(hoverId);
              }
              if (msg.type === "capability") {
                return taskRequiresCapability(t, hoverId);
              }
              return false;
            })
            .map((t) => t.id);
          setMetricHighlightedTaskIds(matching);
        } else if (msg.action === "clear") {
          setMetricHighlightedTaskIds([]);
        }
      };
    } catch (e) {
      // BroadcastChannel not supported
    }
    return () => {
      setMetricHighlightedTaskIds([]);
      channel?.close();
    };
  }, [tasks]);

  useEffect(() => {
    setMetricHighlightedTaskIds([]);
  }, [selectedEvent?.id, selectedDate]);

  // Broadcast selected date to MetricsBoard so day-mode metrics can filter
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("metrics-highlight");
      channel.postMessage({ action: "day-change", date: selectedDate });
    } catch {
      // BroadcastChannel not supported
    }
    return () => {
      channel?.close();
    };
  }, [selectedDate]);

  // Broadcast selected date to Presentation window
  useEffect(() => {
    postPresentationDateChange(selectedDate);
  }, [postPresentationDateChange, selectedDate]);

  // Update editingTask when tasks change (to keep modal in sync with calendar)
  useEffect(() => {
    if (editingTask) {
      const refreshedTask = tasks.find((t) => t.id === editingTask.id);
      if (refreshedTask) {
        setEditingTask(refreshedTask);
      }
    }
  }, [tasks]);

  const fetchData = async (showLoading = true) => {
    if (!selectedEvent) return;
    if (showLoading) setLoading(true);

    try {
      // Fetch task types
      const typesData = await taskTypesApi.getAll();
      setTaskTypes(typesData);

      // Fetch persons
      const personsData = await personsApi.getAll(selectedEvent.id);
      setPersons(personsData);

      // Fetch locations
      const locsData = await locationsApi.getAll(selectedEvent.id);
      setLocations(locsData);

      const groupsData = await groupsApi.getAll(selectedEvent.id);
      const runtimeBoundary = getScheduleDayBoundaryFromRange(
        selectedEvent?.meta_data?.schedule_day_range,
      );

      // Fetch templates
      const templatesData = await taskTemplatesApi.getAll();
      setTemplates(templatesData);

      // Fetch task instances from ref (always latest, avoids stale closure)
      const allInstances = instancesRef.current;

      // Convert to calendar tasks using shared utility
      const calendarTasks = allInstances
        .filter((instance: any) => {
          if (instance.event_id !== selectedEvent.id) return false;
          return instance.optimised || instance.final;
        })
        .map((instance: any) =>
          toCalendarTask(
            instance,
            templatesData,
            typesData,
            personsData,
            locsData,
            groupsData,
            runtimeBoundary.offsetHour,
          ),
        );

      setTasks(calendarTasks);
    } catch (error) {
      console.error("Error fetching optimised data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleTaskClick = (task: CalendarTask) => {
    setEditingTask(task);
  };

  // Handle right-click on a person name in a calendar card
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

  // Handle person replacement from the context menu
  const handlePersonReplace = async (
    taskId: number,
    oldPersonId: number,
    newPersonId: number,
  ) => {
    const instance = contextInstances.find((i: any) => i.id === taskId);
    if (!instance) return;

    const schedule =
      (instance as any).final || (instance as any).optimised || {};
    const currentPersons: number[] = schedule.assigned_persons || [];
    const newPersons = currentPersons
      .filter((id: number) => id !== oldPersonId)
      .concat(newPersonId);

    // Update field_assignments too if present
    let updatedFieldAssignments = schedule.field_assignments;
    if (updatedFieldAssignments) {
      updatedFieldAssignments = { ...updatedFieldAssignments };
      for (const [fieldId, pids] of Object.entries(updatedFieldAssignments)) {
        const arr = pids as number[];
        if (arr.includes(oldPersonId)) {
          updatedFieldAssignments[fieldId] = arr
            .filter((id: number) => id !== oldPersonId)
            .concat(newPersonId);
        }
      }
    }

    const updatedFinal = {
      ...schedule,
      assigned_persons: newPersons,
      ...(updatedFieldAssignments
        ? { field_assignments: updatedFieldAssignments }
        : {}),
    };

    await updateInstance(taskId, { final: updatedFinal });
    // Refresh calendar view after person swap
    setRefreshTrigger((r) => r + 1);
  };

  const handleTaskSave = async (updatedTask: any) => {
    const instance = contextInstances.find((i: any) => i.id === updatedTask.id);
    if (!instance) return;

    // Write admin's manual adjustments to task.final field
    // This preserves optimizer's output in task.optimised (read-only)
    // Admin can later "Reset to optimised" by clearing task.final
    const currentSchedule =
      (instance as any).final || (instance as any).optimised || {};

    // Convert HH:MM times from the edit modal back to minutes
    const timeStringToMinutes = (timeStr: string): number => {
      const [h, m] = timeStr.split(":").map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    const startTime =
      updatedTask.start_end_time?.start !== undefined
        ? timeStringToMinutes(updatedTask.start_end_time.start)
        : updatedTask.startTime;
    const endTime =
      updatedTask.start_end_time?.end !== undefined
        ? timeStringToMinutes(updatedTask.start_end_time.end)
        : updatedTask.endTime;

    // Use field_assignments from the modal if provided, otherwise fall back to current
    let updatedFieldAssignments =
      updatedTask.field_assignments || currentSchedule.field_assignments;
    if (updatedFieldAssignments && updatedTask.assigned_persons) {
      const newPersonSet = new Set(updatedTask.assigned_persons as number[]);
      updatedFieldAssignments = { ...updatedFieldAssignments };
      for (const [fieldId, pids] of Object.entries(updatedFieldAssignments)) {
        // Remove persons no longer in the list
        updatedFieldAssignments[fieldId] = (pids as number[]).filter((id) =>
          newPersonSet.has(id),
        );
      }
    }

    const updatedFinal = {
      start_time: startTime,
      end_time: endTime,
      location: updatedTask.location ? parseInt(updatedTask.location) : null,
      assigned_persons: updatedTask.assigned_persons || [],
      ...(updatedFieldAssignments
        ? { field_assignments: updatedFieldAssignments }
        : {}),
    };

    await updateInstance(updatedTask.id, {
      final: updatedFinal,
      ...(updatedTask.field_values
        ? { field_values: updatedTask.field_values }
        : {}),
    });

    // Refresh calendar view after save
    setRefreshTrigger((r) => r + 1);
  };

  const handleTaskDelete = async (taskId: string) => {
    try {
      const taskIdNum =
        typeof taskId === "string" ? parseInt(taskId, 10) : taskId;

      await deleteInstance(taskIdNum);

      // Close modal
      setEditingTask(null);

      // Update local state
      setTasks((prevTasks) => prevTasks.filter((t) => t.id !== taskIdNum));
      setSelectedTaskIds((prev) => prev.filter((id) => id !== taskIdNum));
    } catch (error) {
      console.error("Error deleting task:", error);
    }
  };

  const handleResetSelectedToOptimised = async () => {
    if (selectedTaskIds.length === 0) return;

    try {
      const toUpdate = contextInstances.filter(
        (inst: any) =>
          selectedTaskIds.includes(inst.id) && (inst as any).optimised,
      );

      await Promise.all(
        toUpdate.map((inst: any) =>
          updateInstance(inst.id, { final: { ...inst.optimised } }),
        ),
      );

      setSelectedTaskIds([]);
      // Refresh calendar view after reset
      setRefreshTrigger((r) => r + 1);
    } catch (error) {
      console.error("Error resetting selected tasks:", error);
    }
  };

  const handleMoveSelectedTasks = async (minutes: number) => {
    if (selectedTaskIds.length === 0) return;

    try {
      const taskInstances = [...contextInstances];
      const taskById = new Map(tasks.map((task) => [task.id, task]));

      const updatedInstances = taskInstances.map((instance: any) => {
        if (!selectedTaskIds.includes(instance.id)) return instance;

        // Get current times from final (or optimised as fallback)
        const currentData = instance.final || instance.optimised;
        if (currentData?.start_time == null || currentData?.end_time == null) {
          return instance;
        }

        // Parse time - can be either a number (minutes) or string (HH:MM)
        const parseTime = (timeValue: any): number => {
          // If it's already a number, return it directly
          if (typeof timeValue === "number") {
            return timeValue;
          }

          // If it's a string in HH:MM format
          const timeString = String(timeValue);
          if (timeString.includes(":")) {
            const [hours, mins] = timeString.split(":").map(Number);
            if (!isNaN(hours) && !isNaN(mins)) {
              return hours * 60 + mins;
            }
          }

          // Try parsing as a plain number string
          const asNumber = Number(timeValue);
          if (!isNaN(asNumber)) {
            return asNumber;
          }

          console.error("Could not parse time:", timeValue);
          return 0;
        };

        const currentTask = taskById.get(instance.id);
        const startSource =
          currentTask?.start_end_time?.start ?? currentData.start_time;
        const endSource = currentTask?.start_end_time?.end ?? currentData.end_time;
        const startMinutes = parseTime(startSource);
        const endMinutes = parseTime(endSource);

        const newStartMinutes = Math.max(
          0,
          Math.min(1439, startMinutes + minutes),
        );
        const duration = endMinutes - startMinutes;
        const newEndMinutes = Math.max(
          0,
          Math.min(1440, newStartMinutes + duration),
        );

        // Update final with new times (keep as numbers like original format)
        return {
          ...instance,
          final: {
            ...currentData,
            start_time: newStartMinutes,
            end_time: newEndMinutes,
          },
        };
      });

      const updatedById = new Map(
        updatedInstances
          .filter((inst: any) => selectedTaskIds.includes(inst.id) && inst.final)
          .map((inst: any) => [inst.id, inst]),
      );

      // Update local state immediately so keyboard movement stays smooth.
      setTasks((prevTasks) => {
        return prevTasks.map((task) => {
          if (!selectedTaskIds.includes(task.id)) return task;

          const updatedInstance = updatedById.get(task.id) as any;
          if (!updatedInstance?.final) return task;

          const newStartTime = updatedInstance.final.start_time;
          const newEndTime = updatedInstance.final.end_time;

          // Create a completely new task object to ensure re-render
          const newTask = {
            ...task,
            startTime: newStartTime,
            endTime: newEndTime,
            final: {
              ...(task.final || {}),
              start_time: newStartTime,
              end_time: newEndTime,
            },
            start_end_time: {
              start: minutesToTime(newStartTime),
              end: minutesToTime(newEndTime),
            },
          };

          return newTask;
        });
      });

      await Promise.all(
        Array.from(updatedById.values()).map((inst: any) =>
          updateInstance(inst.id, { final: inst.final }),
        ),
      );
    } catch (error) {
      console.error("Error moving selected tasks:", error);
    }
  };

  const handleResetAllToOptimised = async () => {
    const tasksForDay = tasks.filter((t) => t.date === selectedDate);
    if (tasksForDay.length === 0) return;
    if (
      !confirm(
        `Reset all ${tasksForDay.length} task(s) for ${formatDateShort(selectedDate)} to optimised state?`,
      )
    )
      return;

    const taskIds = tasksForDay.map((t) => t.id);

    // Reset all tasks for this day: Copy optimised → final to restore optimizer's output
    // This overwrites any user manual adjustments with the original optimization
    const toUpdate = contextInstances.filter(
      (inst: any) => taskIds.includes(inst.id) && (inst as any).optimised,
    );

    await Promise.all(
      toUpdate.map((inst: any) =>
        updateInstance(inst.id, { final: { ...inst.optimised } }),
      ),
    );

    // Refresh calendar view after reset all
    setRefreshTrigger((r) => r + 1);
  };

  const [isPublishing, setIsPublishing] = useState(false);
  const [showPublishDropdown, setShowPublishDropdown] = useState(false);
  const [publishTarget, setPublishTarget] = useState<PublishTarget>([]);
  const [publishPreview, setPublishPreview] = useState<PublishPreview | null>(
    null,
  );
  const [publishDataPolicy, setPublishDataPolicy] =
    useState<MpBackendDataPolicy | null>(null);
  const [publishPolicyLoading, setPublishPolicyLoading] = useState(false);
  const [publishPolicyError, setPublishPolicyError] = useState<string | null>(
    null,
  );
  const [acknowledgingPublishPolicy, setAcknowledgingPublishPolicy] =
    useState(false);
  const [publishedDayRecords, setPublishedDayRecords] =
    useState<PublishedDayRecords>({});

  const loadPublishDataPolicy = useCallback(
    async (eventId: number): Promise<MpBackendDataPolicy | null> => {
      setPublishPolicyLoading(true);
      setPublishPolicyError(null);
      try {
        const policy = await mpBackendApi.getDataPolicy(eventId);
        setPublishDataPolicy(policy);
        return policy;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "The current Server permitted-data policy is unavailable.";
        setPublishDataPolicy(null);
        setPublishPolicyError(message);
        return null;
      } finally {
        setPublishPolicyLoading(false);
      }
    },
    [],
  );

  const handlePublishPolicyAcknowledgement = useCallback(async () => {
    if (!selectedEvent?.id || !publishDataPolicy) return;
    setAcknowledgingPublishPolicy(true);
    setPublishPolicyError(null);
    try {
      await mpBackendApi.acknowledgeDataPolicy(
        selectedEvent.id,
        publishDataPolicy.policy_version,
        publishDataPolicy.policy_sha256,
      );
      const currentPolicy = await loadPublishDataPolicy(selectedEvent.id);
      if (!currentPolicy?.acknowledged) {
        setPublishPolicyError(
          "The Server policy changed before acknowledgement completed. Review the current exact policy.",
        );
        return;
      }
      addToast("Exact Server permitted-data policy acknowledged.", "success");
    } catch (error) {
      setPublishPolicyError(
        error instanceof Error ? error.message : "Policy acknowledgement failed.",
      );
    } finally {
      setAcknowledgingPublishPolicy(false);
    }
  }, [addToast, loadPublishDataPolicy, publishDataPolicy, selectedEvent?.id]);

  useEffect(() => {
    setPublishDataPolicy(null);
    setPublishPolicyError(null);
    setPublishPolicyLoading(false);
  }, [selectedEvent?.id]);

  // Load publish target setting
  useEffect(() => {
    appSettingsApi
      .getPublishTarget()
      .then((pt) => setPublishTarget(pt.targets))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!selectedEvent?.id) {
      setPublishedDayRecords({});
      return;
    }

    publishStateApi
      .get(selectedEvent.id)
      .then((state) => {
        if (!cancelled) {
          setPublishedDayRecords(state.day_records || {});
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPublishedDayRecords({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEvent?.id]);

  useEffect(() => {
    setPublishPreview(null);
  }, [selectedEvent?.id]);

  const persistPublishedDayRecords = useCallback(
    async (
      records: PublishedDayRecords,
      options: {
        publishedAt?: string | null;
        fingerprint?: string | null;
        scope?: "all" | "partial" | "none";
        target?: PublishTarget | null;
        resultSummary?: string | null;
      } = {},
    ) => {
      if (!selectedEvent?.id) return null;
      setPublishedDayRecords(records);
      return publishStateApi.save(selectedEvent.id, {
        day_records: records,
        published_at: options.publishedAt ?? null,
        publish_failed_at: null,
        published_schedule_fingerprint: options.fingerprint ?? null,
        published_schedule_scope: options.scope ?? "none",
        last_publish_targets: options.target ?? [],
        last_publish_result_summary: options.resultSummary ?? null,
      });
    },
    [selectedEvent?.id],
  );

  const recordPublishFailure = useCallback(
    async (days: DayPublishStatus[] = [], failureMessage = "Publish failed.") => {
      if (!selectedEvent?.id) return;
      const publishFailedAt = new Date().toISOString();
      const fallbackRecords: PublishedDayRecords = { ...publishedDayRecords };
      days.forEach((day) => {
        fallbackRecords[day.dayId] = {
          ...(fallbackRecords[day.dayId] ?? {}),
          failedAt: publishFailedAt,
          failureMessage,
        };
      });
      setPublishedDayRecords(fallbackRecords);

      let dayRecords = fallbackRecords;
      try {
        const state = await publishStateApi.recordFailure(selectedEvent.id, {
          day_ids: days.map((day) => day.dayId),
          failed_at: publishFailedAt,
          failure_message: failureMessage,
          last_publish_targets: publishTarget,
          last_publish_result_summary: failureMessage,
        });
        dayRecords = state.day_records || fallbackRecords;
        setPublishedDayRecords(dayRecords);
      } catch (error) {
        console.error("Failed to persist publish failure state:", error);
      }

      window.dispatchEvent(
        new CustomEvent("publish-status-updated", {
          detail: {
            eventId: selectedEvent.id,
            publishFailedAt,
            dayRecords,
          },
        }),
      );
    },
    [publishTarget, publishedDayRecords, selectedEvent?.id],
  );

  const buildPublishPreview = (
    scope: PublishPreviewScope,
  ): PublishPreview | null => {
    if (!selectedEvent) return null;
    const eventDayIds = getEventDayIds(selectedEvent);
    const eventDayIdSet = new Set(eventDayIds);
    const previewBoundary = getScheduleDayBoundaryFromRange(
      selectedEvent.meta_data?.schedule_day_range,
    );
    const eventInstances = contextInstances
      .filter((inst: any) => inst.event_id === selectedEvent.id)
      .map((instance: any) => ({
        ...instance,
        date:
          getWorkingDayForDateTime(
            instance.date,
            getTaskInstanceStartClock(instance, templates),
            previewBoundary,
          ) ?? instance.date,
      }))
      .filter((instance: any) => eventDayIdSet.has(instance.date));
    const dayStatuses = deriveDayPublishStatuses({
      taskInstances: eventInstances as any,
      people: persons,
      publishedDayRecords,
    });

    return derivePublishPreview({
      publishTarget,
      scope,
      selectedDayId: selectedDate,
      dayStatuses,
      taskInstances: eventInstances as any,
      allDayIds: eventDayIds,
      getDayLabel: (dayId) => getEventDayLabel(selectedEvent, dayId),
    });
  };

  const openPublishPreview = (allDays: boolean) => {
    if (!selectedEvent || isPublishing) return;
    setShowPublishDropdown(false);
    const preview = buildPublishPreview(allDays ? "all_days" : "selected_day");
    if (preview) {
      setPublishPreview(preview);
      if (hasPublishDestination(publishTarget, "mp-backend")) {
        void loadPublishDataPolicy(selectedEvent.id);
      } else {
        setPublishDataPolicy(null);
        setPublishPolicyError(null);
      }
    }
  };

  const executePublishPreview = async () => {
    if (!selectedEvent || !publishPreview) return;
    if (isPublishing || !publishPreview.canPublish) return;

    if (hasPublishDestination(publishTarget, "mp-backend")) {
      const currentPolicy = await loadPublishDataPolicy(selectedEvent.id);
      if (!currentPolicy?.acknowledged) {
        addToast(
          currentPolicy
            ? "Review and acknowledge the current exact Server permitted-data policy before publishing."
            : "The current Server permitted-data policy could not be verified.",
          "error",
        );
        return;
      }
    }

    const eventInstances = contextInstances.filter(
      (inst: any) => inst.event_id === selectedEvent.id,
    );
    const eventDayIdSet = new Set(getEventDayIds(selectedEvent));
    const publishStatusInstances = eventInstances
      .map((instance: any) => ({
        ...instance,
        date:
          getWorkingDayForDateTime(
            instance.date,
            getTaskInstanceStartClock(instance, templates),
            getScheduleDayBoundaryFromRange(
              selectedEvent.meta_data?.schedule_day_range,
            ),
          ) ?? instance.date,
      }))
      .filter((instance: any) => eventDayIdSet.has(instance.date));
    const dayStatuses = deriveDayPublishStatuses({
      taskInstances: publishStatusInstances as any,
      people: persons,
      publishedDayRecords,
    });
    const publishDayIds = new Set(
      publishPreview.publishDays.map((day) => day.dayId),
    );
    const targetDays = dayStatuses.filter(
      (day) => publishDayIds.has(day.dayId) && day.isPublishable,
    );
    const targetDates = targetDays.map((day) => day.dayId);

    if (targetDays.length === 0) {
      addToast("No days were published because no days are ready.", "error");
      return;
    }

    let pdfFileName = "";
    let googlePublished = false;
    let mpBackendPublished = false;
    setIsPublishing(true);
    try {
      const target = publishTarget;

      // Render the local PDF first. A missing folder or renderer failure must not
      // allow Calendar or MP-Backend side effects to begin.
      if (hasPublishDestination(target, "pdf")) {
        const pdfSettings = await eventsApi.getPdfExportSettings(selectedEvent.id);
        const pdfResult = await exportSchedulePdf({
          title: pdfSettings.title,
          eventId: selectedEvent.id,
          eventName: selectedEvent.name,
          eventLocation: selectedEvent.location || "",
          eventStartDate: selectedEvent.start_date,
          eventEndDate: selectedEvent.end_date,
          scheduleDayRange: selectedEvent.meta_data?.schedule_day_range ?? null,
          scheduleDayBoundary: getScheduleDayBoundaryFromRange(
            selectedEvent.meta_data?.schedule_day_range,
          ),
          days: targetDays.map((day) => ({
            date: day.dayId,
            dayLabel: getEventDayLabel(selectedEvent, day.dayId),
            tasks: tasks.filter((task) =>
              isTaskInWorkingDay(task, day.dayId, scheduleDayBoundary),
            ),
          })),
        });
        pdfFileName = pdfResult.fileName;
      }

      // First finalize so backend tasks table is up to date
      const scheduledEventInstances = eventInstances.filter(
        (inst: any) => inst.optimised || inst.final,
      );
      if (scheduledEventInstances.length > 0) {
        await tasksApi.finalize({
          event_id: selectedEvent.id,
          task_instances: scheduledEventInstances.map((inst: any) => ({
            id: inst.id != null ? Math.floor(inst.id) : undefined,
            name: inst.name || "Untitled",
            task_type_id:
              inst.task_type_id != null
                ? Math.floor(inst.task_type_id)
                : undefined,
            event_id: inst.event_id,
            date: inst.date,
            day_index: inst.day_index,
            template_id: inst.template_id,
            is_floating: inst.is_floating || false,
            is_transfer: inst.is_transfer || false,
            field_values: inst.field_values,
            optimised: inst.optimised,
            final: inst.final || inst.optimised,
            constraints: inst.constraints,
            additional: inst.additional,
          })),
        });
      }

      const errors: string[] = [];
      let gcEventsCreated = 0;

      // Publish to Google Calendar (if target includes it)
      if (hasPublishDestination(target, "google")) {
        try {
          const gcResult = await googleCalendarApi.publish(
            selectedEvent.id,
            targetDates,
          );
          gcEventsCreated = gcResult.events_created || 0;
          googlePublished = true;
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
      if (hasPublishDestination(target, "mp-backend")) {
        try {
          const mpBackendDates =
            publishPreview.scope === "all_days" &&
            publishPreview.skippedDays === 0 &&
            targetDays.length === publishPreview.totalDays
              ? undefined
              : targetDates;
          await mpBackendApi.publish(selectedEvent.id, mpBackendDates);
          mpBackendPublished = true;
        } catch (mpError: any) {
          if (
            mpError instanceof ApiRequestError &&
            (mpError.status === 428 ||
              mpError.code === "desktop_data_policy_acknowledgement_required")
          ) {
            const currentPolicy = await loadPublishDataPolicy(selectedEvent.id);
            const acknowledgementMessage =
              dataPolicyAcknowledgementGuidance(Boolean(currentPolicy));
            if (currentPolicy) {
              // Keep the acknowledgement control visible. A 428 can mean that
              // the policy changed between preview and publication; it is not
              // a generic policy-loading failure.
              setPublishPolicyError(null);
            }
            addToast(acknowledgementMessage, "error");
            return;
          }
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
        const completed = [
          pdfFileName ? `PDF ${pdfFileName}` : "",
          googlePublished ? "Google Calendar" : "",
          mpBackendPublished ? "MP-Backend" : "",
        ].filter(Boolean);
        const failureSummary = completed.length
          ? `Publish partially completed. ${completed.join(", ")} succeeded. Failed: ${errors.join(", ")}`
          : `Publish failed: ${errors.join(", ")}`;
        await recordPublishFailure(targetDays, failureSummary);
        addToast(failureSummary, "error");
      } else {
        const publishedAt = new Date().toISOString();
        const nextRecords: PublishedDayRecords = { ...publishedDayRecords };
        targetDays.forEach((day) => {
          nextRecords[day.dayId] = {
            ...(nextRecords[day.dayId] ?? {}),
            fingerprint: day.fingerprint,
            publishedAt,
            failedAt: null,
            failureMessage: null,
          };
        });
        const updatedDayStatuses = deriveDayPublishStatuses({
          taskInstances: publishStatusInstances as any,
          people: persons,
          publishedDayRecords: nextRecords,
        });
        const updatedEventPublishStatus =
          deriveEventPublishStatus(updatedDayStatuses);
        const fullEventPublished =
          publishPreview.scope === "all_days" &&
          updatedEventPublishStatus.state === "fully_published";
        const publishedFingerprint = fullEventPublished
          ? getScheduleFingerprint(eventInstances)
          : null;
        const publishScope = fullEventPublished
          ? "all"
          : targetDays.length > 0
            ? "partial"
            : "none";
        const publishSummary = publishPreview.scope === "all_days"
          ? buildAllDaysPublishToast(
              targetDays.length,
              publishPreview.totalDays,
              publishPreview.skippedDays,
            )
          : buildSelectedDayPublishToast(
              publishPreview.publishDays[0]?.dayLabel ?? selectedDate,
              updatedEventPublishStatus,
            );

        await persistPublishedDayRecords(nextRecords, {
          publishedAt,
          fingerprint: publishedFingerprint,
          scope: publishScope,
          target,
          resultSummary: publishSummary,
        });
        window.dispatchEvent(
          new CustomEvent("published-schedule-updated", {
            detail: {
              eventId: selectedEvent.id,
              fingerprint: publishedFingerprint,
              scope: publishScope === "none" ? null : publishScope,
              publishedAt,
              dayRecords: nextRecords,
            },
          }),
        );
        if (fullEventPublished) {
          await eventStatusApi.update(selectedEvent.id, "published");
          await refreshEvents();
        }
        const parts: string[] = [];
        if (hasPublishDestination(target, "google") && gcEventsCreated > 0) {
          parts.push(`${gcEventsCreated} event(s) in Google Calendar`);
        }
        if (hasPublishDestination(target, "mp-backend")) {
          parts.push("MP-Backend server");
        }
        if (pdfFileName) parts.push(`PDF ${pdfFileName}`);
        addToast(
          `${publishSummary}${parts.length > 0 ? " " + parts.join(", ") : ""}`,
          "success",
        );
        setPublishPreview(null);
      }
    } catch (error) {
      console.error("Failed to publish:", error);
      const completed = [
        pdfFileName ? `PDF ${pdfFileName}` : "",
        googlePublished ? "Google Calendar" : "",
        mpBackendPublished ? "MP-Backend" : "",
      ].filter(Boolean);
      const failure = error instanceof Error ? error.message : "Unknown error";
      const failureSummary = completed.length
        ? `Publish partially completed. ${completed.join(", ")} succeeded. Failed: ${failure}`
        : `Failed to publish: ${failure}`;
      await recordPublishFailure(
        targetDays,
        failureSummary,
      );
      addToast(failureSummary, "error");
    } finally {
      setIsPublishing(false);
    }
  };

  useEffect(() => {
    publishSelectedDayRef.current = () => openPublishPreview(false);
    publishAllDaysRef.current = () => openPublishPreview(true);
  }, [openPublishPreview]);

  const handleDeleteSelectedTasks = async () => {
    if (selectedTaskIds.length === 0) return;
    if (!confirm(`Delete ${selectedTaskIds.length} selected task(s)?`)) return;

    await deleteInstances(selectedTaskIds);

    // Update local state
    setTasks((prevTasks) =>
      prevTasks.filter((t) => !selectedTaskIds.includes(t.id)),
    );
    setSelectedTaskIds([]);
  };

  const handleDuplicateSelectedTasks = async () => {
    if (selectedTaskIds.length === 0) return;

    const tasksToDuplicate = contextInstances.filter((instance: any) =>
      selectedTaskIds.includes(instance.id),
    );

    const newItems = tasksToDuplicate.map((task: any) => ({
      ...task,
      id: undefined,
      name: `${task.name} (Copy)`,
    }));

    await createInstances(newItems);

    setSelectedTaskIds([]);
  };

  const handleDateChange = (direction: "prev" | "next") => {
    if (!selectedEvent) return;

    const [year, month, day] = selectedDate.split("-").map(Number);
    const currentDate = new Date(year, month - 1, day);

    if (direction === "prev") {
      currentDate.setDate(currentDate.getDate() - 1);
    } else {
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const newDateStr = `${currentDate.getFullYear()}-${String(
      currentDate.getMonth() + 1,
    ).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;

    // Check if within event range
    if (
      newDateStr >= selectedEvent.start_date &&
      newDateStr <= selectedEvent.end_date
    ) {
      setSelectedDate(newDateStr);
    }
  };

  const getDayInfo = (date: string) => {
    if (!selectedEvent) return null;

    const start = new Date(selectedEvent.start_date + "T00:00:00");
    const current = new Date(date + "T00:00:00");
    const dayNumber =
      Math.floor(
        (current.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
      ) + 1;

    const alias = selectedEvent.meta_data?.day_aliases?.[date] || null;

    const formattedDate = formatDateWithWeekday(date);

    return { dayNumber, alias, formattedDate };
  };

  const handleTaskShiftClick = (taskId: number) => {
    setSelectedTaskIds((prev) => {
      if (prev.includes(taskId)) {
        return prev.filter((id) => id !== taskId);
      } else {
        return [...prev, taskId];
      }
    });
  };

  const dayInfo = getDayInfo(selectedDate);
  const scheduleDayBoundary = useMemo(
    () => getScheduleDayBoundaryFromRange(selectedEvent?.meta_data?.schedule_day_range),
    [
      selectedEvent?.meta_data?.schedule_day_range?.startHour,
      selectedEvent?.meta_data?.schedule_day_range?.endHour,
    ],
  );
  const getInstanceStartClock = useCallback(
    (instance: any): string | null => getTaskInstanceStartClock(instance, templates),
    [templates],
  );
  const tasksForSelectedDay = useMemo(
    () =>
      tasks.filter((task) =>
        isTaskInWorkingDay(task, selectedDate, scheduleDayBoundary),
      ),
    [scheduleDayBoundary, selectedDate, tasks],
  );
  const hasOptimisedData = tasksForSelectedDay.length > 0;
  const selectedDayInstances = useMemo(
    () =>
      contextInstances.filter(
        (instance: any) =>
          instance.event_id === selectedEvent?.id &&
          getWorkingDayForDateTime(
            instance.date,
            getInstanceStartClock(instance),
            scheduleDayBoundary,
          ) === selectedDate,
      ),
    [
      contextInstances,
      getInstanceStartClock,
      scheduleDayBoundary,
      selectedDate,
      selectedEvent?.id,
    ],
  );
  const selectedDayConflicts = useMemo(
    () => detectScheduleConflicts(selectedDayInstances as any, persons),
    [persons, selectedDayInstances],
  );
  const eventPublishInstances = useMemo(
    () =>
      contextInstances.filter(
        (instance: any) => instance.event_id === selectedEvent?.id,
      ),
    [contextInstances, selectedEvent?.id],
  );
  const eventPublishInstancesByWorkingDay = useMemo(
    () =>
      eventPublishInstances.map((instance: any) => ({
        ...instance,
        date:
          getWorkingDayForDateTime(
            instance.date,
            getInstanceStartClock(instance),
            scheduleDayBoundary,
          ) ?? instance.date,
      })),
    [eventPublishInstances, getInstanceStartClock, scheduleDayBoundary],
  );
  const dayPublishStatuses = useMemo(
    () =>
      deriveDayPublishStatuses({
        taskInstances: eventPublishInstancesByWorkingDay as any,
        people: persons,
        publishedDayRecords,
      }),
    [eventPublishInstancesByWorkingDay, persons, publishedDayRecords],
  );
  const selectedDayPublishStatus = useMemo(
    () => dayPublishStatuses.find((day) => day.dayId === selectedDate),
    [dayPublishStatuses, selectedDate],
  );
  const selectedDayPublishContext = describeSelectedDayPublishStatus(
    selectedDayPublishStatus,
  );
  const canPublishSelectedDay = Boolean(selectedDayPublishStatus?.isPublishable);
  const hasAnyPublishableDay = dayPublishStatuses.some(
    (day) => day.isPublishable,
  );
  const conflictsByTaskId = useMemo(() => {
    const map = new Map<
      number,
      { count: number; messages: string[]; details: string[] }
    >();
    selectedDayConflicts.forEach((conflict) => {
      conflict.taskIds.forEach((taskId) => {
        const existing =
          map.get(taskId) ?? { count: 0, messages: [], details: [] };
        map.set(taskId, {
          count: existing.count + 1,
          messages: [...existing.messages, conflict.message],
          details: conflict.details
            ? [...existing.details, conflict.details]
            : existing.details,
        });
      });
    });
    return map;
  }, [selectedDayConflicts]);
  const instanceById = useMemo(
    () =>
      new Map(
        selectedDayInstances.map((instance: any) => [instance.id, instance]),
      ),
    [selectedDayInstances],
  );
  const decoratedTasksForSelectedDay = useMemo(
    () =>
      tasksForSelectedDay.map((task) => {
        const instance = instanceById.get(task.id) as any;
        const changeSummary = instance
          ? getTaskChangeSummary(instance.optimised, instance.final)
          : getTaskChangeSummary(task.optimised, task.final);
        const manualDetails = instance
          ? [
              describeScheduleSnapshot(
                "Originally",
                instance.optimised,
                persons,
                locations,
              ),
              describeScheduleSnapshot("Now", instance.final, persons, locations),
            ].filter((detail): detail is string => Boolean(detail))
          : [];
        const conflicts = conflictsByTaskId.get(task.id);

        return {
          ...task,
          manualChange:
            changeSummary.length > 0
              ? {
                  summaries: changeSummary,
                  details: manualDetails,
                }
              : undefined,
          conflicts,
        };
      }),
    [
      conflictsByTaskId,
      instanceById,
      locations,
      persons,
      tasksForSelectedDay,
    ],
  );
  const selectedDayManualChanges =
    deriveManualChangesItem(selectedDayInstances);
  const selectedDayLastManualEditText = formatStatusTimestamp(
    getLastManualEditAt(selectedDayInstances as any),
  );
  const manualEditMatch = selectedDayManualChanges.status.match(
    /^(\d+)\s+edits?$/,
  );
  const manualEditContext = manualEditMatch
    ? selectedDayLastManualEditText
      ? `edited ${selectedDayLastManualEditText}`
      : `${manualEditMatch[1]} manual ${
          Number(manualEditMatch[1]) === 1 ? "edit" : "edits"
        } on this day`
    : `${selectedDayManualChanges.status} on this day`;
  const contextParts = [
    "Final schedule",
    ...(selectedDayManualChanges.status === "None" ? [] : [manualEditContext]),
    ...(selectedDayConflicts.length > 0
      ? [
          `${selectedDayConflicts.length} ${
            selectedDayConflicts.length === 1 ? "conflict" : "conflicts"
          } on this day`,
        ]
      : []),
    ...(selectedDayPublishContext ? [selectedDayPublishContext] : []),
  ];

  useEffect(() => {
    if (!pendingScrollTaskId) return;
    if (
      !decoratedTasksForSelectedDay.some((task) => task.id === pendingScrollTaskId)
    ) {
      return;
    }

    const scrollTimer = window.setTimeout(() => {
      const element = document.querySelector(
        `[data-task-id="${pendingScrollTaskId}"]`,
      );
      element?.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
    }, 120);

    const clearTimer = window.setTimeout(() => {
      setPendingScrollTaskId((current) =>
        current === pendingScrollTaskId ? null : current,
      );
    }, 1200);

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [decoratedTasksForSelectedDay, pendingScrollTaskId]);

  useEffect(() => {
    if (!manualChangeFocusToken || !selectedEvent?.id) return;

    const eventInstances = contextInstances.filter(
      (instance: any) => instance.event_id === selectedEvent.id,
    );
    const firstChangedTask = sortInstancesByScheduleOrder(eventInstances).find(
      (instance: any) =>
        getTaskChangeSummary(instance.optimised, instance.final).length > 0,
    );

    if (!firstChangedTask) return;
    setSelectedDate(firstChangedTask.date);
    setFocusHighlightedTaskIds([firstChangedTask.id]);
    setPendingScrollTaskId(firstChangedTask.id);
  }, [contextInstances, manualChangeFocusToken, selectedEvent?.id]);

  useEffect(() => {
    if (!conflictFocusToken || !selectedEvent?.id) return;

    const eventInstances = contextInstances.filter(
      (instance: any) => instance.event_id === selectedEvent.id,
    );
    const conflicts = detectScheduleConflicts(eventInstances as any, persons);
    const firstConflict = conflicts[0];
    if (!firstConflict) return;

    const taskIds = Array.from(new Set(firstConflict.taskIds));
    const firstConflictTask = sortInstancesByScheduleOrder(eventInstances).find(
      (instance: any) =>
        taskIds.includes(instance.id) && typeof instance.date === "string",
    );

    if (firstConflictTask?.date) {
      setSelectedDate(firstConflictTask.date);
    }
    setFocusHighlightedTaskIds(taskIds);
    if (taskIds[0] != null) {
      setPendingScrollTaskId(taskIds[0]);
    }
  }, [conflictFocusToken, contextInstances, persons, selectedEvent?.id]);

  const publishDayShortcut =
    getShortcutBinding("optimised.publishDay") || "Unassigned";
  const publishAllDaysShortcut =
    getShortcutBinding("optimised.publishAllDays") || "Unassigned";
  const presentShortcut =
    getShortcutBinding("optimised.openPresentation") || "Unassigned";
  const metricsShortcut =
    getShortcutBinding("optimised.openMetrics") || "Unassigned";
  const publishConfidence = getPublishTargetConfidence(publishTarget);
  const highlightedTaskIds = useMemo(
    () =>
      Array.from(
        new Set([...metricHighlightedTaskIds, ...focusHighlightedTaskIds]),
      ),
    [focusHighlightedTaskIds, metricHighlightedTaskIds],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-foreground">
              Optimised Schedule
            </h3>
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-medium ${confidenceClasses(
                hasOptimisedData ? "ready" : "unknown",
                "text",
              )}`}
              title={
                hasOptimisedData
                  ? "Optimised data exists for the selected day."
                  : "No optimised data exists for the selected day."
              }
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${confidenceClasses(
                  hasOptimisedData ? "ready" : "unknown",
                  "dot",
                )}`}
              />
              {hasOptimisedData ? "Day ready" : "No day data"}
            </span>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-foreground-muted">
            {contextParts.map((part, index) => (
              <React.Fragment key={`${part}-${index}`}>
                {index > 0 && (
                  <span className="text-foreground-faint">/</span>
                )}
                <span>{part}</span>
              </React.Fragment>
            ))}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Publish button with dropdown */}
          <div className="relative">
            <div className="flex">
              <Tooltip
                content={`Publish ${formatDateShort(selectedDate)} to ${getPublishTargetsLabel(publishTarget)} (${publishDayShortcut})`}
                side="bottom"
              >
                <button
                  onClick={() => openPublishPreview(false)}
                  disabled={!canPublishSelectedDay || isPublishing}
                  className={`rounded-l-md px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-1 ${confidenceClasses(
                    publishConfidence.level,
                    "button",
                  )}`}
                >
                  <Send className="w-3.5 h-3.5" />
                  {isPublishing ? "Publishing..." : "Publish"}
                </button>
              </Tooltip>
              <Tooltip content="More publish options" side="bottom">
                <button
                  onClick={() => setShowPublishDropdown(!showPublishDropdown)}
                  disabled={!hasAnyPublishableDay || isPublishing}
                  className={`rounded-r-md border-l border-white/30 px-1.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${confidenceClasses(
                    publishConfidence.level,
                    "button",
                  )}`}
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            </div>
            {showPublishDropdown && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowPublishDropdown(false)}
                />
                <div className="absolute right-0 mt-1 z-20 bg-surface border border-bordercl rounded-lg shadow-lg py-1 min-w-[180px]">
                  <button
                    onClick={() => openPublishPreview(false)}
                    disabled={!canPublishSelectedDay || isPublishing}
                    className="w-full text-left px-3 py-2 text-sm text-foreground-secondary hover:bg-surface-hover transition-colors"
                  >
                    <span className="inline-flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${confidenceClasses(
                          publishConfidence.level,
                          "dot",
                        )}`}
                      />
                      {`Publish ${formatDateShort(selectedDate)} (${publishDayShortcut})`}
                    </span>
                  </button>
                  <button
                    onClick={() => openPublishPreview(true)}
                    disabled={!hasAnyPublishableDay || isPublishing}
                    className="w-full text-left px-3 py-2 text-sm text-foreground-secondary hover:bg-surface-hover transition-colors"
                  >
                    <span className="inline-flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${confidenceClasses(
                          publishConfidence.level,
                          "dot",
                        )}`}
                      />
                      Publish all days ({publishAllDaysShortcut})
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>

          <Tooltip content="Reset all tasks to optimised state" side="bottom">
            <button
              onClick={handleResetAllToOptimised}
              disabled={!hasOptimisedData}
              className="px-3 py-1 text-xs font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset All
            </button>
          </Tooltip>

          <Tooltip content={`Present schedule (${presentShortcut})`} side="bottom">
            <button
              onClick={openPresentationWindow}
              disabled={!hasOptimisedData}
              className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Presentation className="w-3.5 h-3.5" />
              Present
            </button>
          </Tooltip>

          <Tooltip content={`Open metrics board (${metricsShortcut})`} side="bottom">
            <button
              onClick={openMetricsWindow}
              disabled={!hasOptimisedData}
              className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Metrics
            </button>
          </Tooltip>

          <Tooltip content="Refresh tasks" side="bottom">
            <button
              onClick={() => fetchData()}
              className="px-2 py-1 text-xs font-medium text-foreground-secondary bg-surface-inset rounded-md hover:bg-surface-inset dark:bg-surface-hover transition-colors flex items-center"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </Tooltip>

          {/* Date navigation */}
          {dayInfo && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleDateChange("prev")}
                disabled={selectedDate <= selectedEvent?.start_date}
                className="px-2 py-1 text-xs font-medium text-foreground-secondary bg-surface-inset rounded-md hover:bg-surface-inset dark:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                className="px-2 py-1 text-xs font-medium text-foreground-secondary bg-surface-inset rounded-md hover:bg-surface-inset dark:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Selection Panel */}
      <SelectedTasksPanel
        selectedCount={selectedTaskIds.length}
        onClear={() => setSelectedTaskIds([])}
        onDuplicate={() => {}}
        onDelete={() => {}}
        customActions={
          <Tooltip
            content="Reset selected tasks to optimised state (R)"
            side="top"
          >
            <button
              onClick={handleResetSelectedToOptimised}
              disabled={selectedTaskIds.length === 0}
              className="inline-flex items-center justify-center rounded-md border border-transparent px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed dark:hover:bg-red-950/30"
            >
              Reset to Optimised
            </button>
          </Tooltip>
        }
        customHints={
          <p className="mt-0.5 text-xs text-foreground-muted">
            Press{" "}
            <kbd className="rounded border border-bordercl bg-surface-inset px-1.5 py-0.5 font-mono text-[11px] text-foreground-secondary">
              R
            </kbd>{" "}
            to reset •{" "}
            <kbd className="rounded border border-bordercl bg-surface-inset px-1.5 py-0.5 font-mono text-[11px] text-foreground-secondary">
              ↑↓
            </kbd>{" "}
            to move 5min •{" "}
            <kbd className="rounded border border-bordercl bg-surface-inset px-1.5 py-0.5 font-mono text-[11px] text-foreground-secondary">
              Shift+↑↓
            </kbd>{" "}
            to move 15min •{" "}
            <kbd className="rounded border border-bordercl bg-surface-inset px-1.5 py-0.5 font-mono text-[11px] text-foreground-secondary">
              Esc
            </kbd>{" "}
            to clear
          </p>
        }
      />

      {/* No data message */}
      {!hasOptimisedData && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-6 text-center">
          <p className="text-blue-800 font-medium">
            No optimised data for {formatDateShort(selectedDate)}
          </p>
          <p className="text-blue-600 text-sm mt-2">
            Run optimisation for this day to see results here.
          </p>
        </div>
      )}

      {/* Calendar */}
      {hasOptimisedData && (
        <Calendar
          tasks={decoratedTasksForSelectedDay}
          viewType="daily"
          selectedDate={selectedDate}
          onTaskEdit={handleTaskClick}
          onTaskClick={handleTaskClick}
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
          highlightedTaskIds={highlightedTaskIds}
          scheduleDayRange={selectedEvent?.meta_data?.schedule_day_range}
          scheduleDayBoundary={scheduleDayBoundary}
          locations={locations}
          persons={persons}
          onPersonRightClick={handlePersonRightClick}
          onPrevDay={() => handleDateChange("prev")}
          onNextDay={() => handleDateChange("next")}
          canNavigatePrev={selectedDate > selectedEvent?.start_date}
          canNavigateNext={selectedDate < selectedEvent?.end_date}
        />
      )}

      <PublishPreviewModal
        open={!!publishPreview}
        preview={publishPreview}
        publishing={isPublishing}
        policyRequired={hasPublishDestination(publishTarget, "mp-backend")}
        dataPolicy={publishDataPolicy}
        policyLoading={publishPolicyLoading}
        policyError={publishPolicyError}
        acknowledgingPolicy={acknowledgingPublishPolicy}
        onCancel={() => {
          if (!isPublishing) {
            setPublishPreview(null);
            setPublishDataPolicy(null);
            setPublishPolicyError(null);
          }
        }}
        onConfirm={executePublishPreview}
        onAcknowledgePolicy={handlePublishPolicyAcknowledgement}
        onRetryPolicy={() => {
          if (selectedEvent?.id) void loadPublishDataPolicy(selectedEvent.id);
        }}
      />

      {/* Edit Modal */}
      {editingTask && (
        <OptimisedTaskEditModal
          task={editingTask}
          isOpen={!!editingTask}
          onClose={() => setEditingTask(null)}
          onSave={handleTaskSave}
          onDelete={handleTaskDelete}
          onResetToOptimised={async (taskId) => {
            // Reset single task
            const instance = contextInstances.find((i: any) => i.id === taskId);
            if (instance && (instance as any).optimised) {
              await updateInstance(taskId, {
                final: { ...(instance as any).optimised },
              });
              setRefreshTrigger((r) => r + 1);
            }
            setEditingTask(null);
          }}
          taskType={taskTypes.find((t) => t.id === editingTask.task_type_id)}
          persons={persons}
          locations={locations}
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
            const parseTime = (s?: string) => {
              if (!s) return 0;
              const [h, m] = s.split(":").map(Number);
              return (h || 0) * 60 + (m || 0);
            };
            return {
              id: t.id,
              name: t.name,
              date: t.date || "",
              startTime: parseTime(t.start_end_time?.start),
              endTime: parseTime(t.start_end_time?.end),
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
