"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { Spinner } from "@/components/ui";
import {
  locationsApi,
  groupsApi,
  generalScheduleApi,
  Location,
  Group,
  taskTemplatesApi,
  TaskTemplate,
  taskTypesApi,
  TaskType,
  capabilitiesApi,
  Capability,
  personsApi,
  Person,
  type TaskInstance,
  type AudienceTeam,
  type SessionElement,
  type SessionElementType,
} from "@/lib/api";
import Calendar, { CalendarBackgroundBlock, CalendarTask } from "@/components/Calendar";
import TaskEditModal from "@/components/TaskEditModal";
import { CMIHeader } from "./cmi/CMIHeader";
import { SelectedTasksPanel } from "./cmi/SelectedTasksPanel";
import { ExportSelectedTasksModal } from "./cmi/ExportSelectedTasksModal";
import {
  getSessionElementLocation,
  getSessionElementResponsible,
  getSessionElementTeamNames,
  getSessionElementColour,
  getSessionElementType,
} from "@/lib/generalSchedule";
import { formatDateWithWeekday } from "@/lib/dateFormat";
import { TemplateSelectorModal } from "./cmi/TemplateSelectorModal";
import { performFlowCheck } from "./cmi/flowCheckUtils";
import { getFlowCheckMode } from "@/app/dashboard/settings/components/SolverSettingsSection";
import { optimizationApi } from "@/lib/optimizationApi";
import { useOptimization } from "@/contexts/OptimizationContext";
import { useTaskInstances } from "@/contexts/TaskInstanceContext";
import { useToast } from "@/contexts/ToastContext";
import { useShortcuts } from "@/contexts/ShortcutContext";
import { isEditableTarget } from "@/lib/shortcuts";
import {
  normaliseGroupMembers,
  resolveGroupMemberList,
  resolveRuntimeGroupAssignmentsForFields,
} from "@/lib/groupMembers";
import {
  addDays,
  getActualDateForWorkingSlot,
  getScheduleDayBoundaryFromRange,
  getWorkingDayForDateTime,
  lineariseTaskTimesForWorkingDay,
  minutesToClockTime,
  toWorkingDayMinutes,
} from "@/lib/workingDayBoundary";
import { buildTaskExportPayloads } from "@/lib/taskExport";

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

interface CMITabProps {
  selectedEvent: any;
  onOpenGeneralSchedule?: (date: string) => void;
}

/** Render the CMI schedule editor and its task placement interactions. */
export function CMITab({ selectedEvent, onOpenGeneralSchedule }: CMITabProps) {
  const { optimizationState, startOptimization } = useOptimization();
  const { addToast } = useToast();
  const { matchesShortcut } = useShortcuts();
  const {
    instances: contextInstances,
    createInstance,
    createInstances,
    updateInstance,
    deleteInstance,
    deleteInstances,
  } = useTaskInstances();

  // Keep a ref to always have the latest instances (avoids stale closures)
  const instancesRef = useRef(contextInstances);
  instancesRef.current = contextInstances;

  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split("T")[0],
  );
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [audienceTeams, setAudienceTeams] = useState<AudienceTeam[]>([]);
  const [sessionElements, setSessionElements] = useState<SessionElement[]>([]);
  const [sessionElementTypes, setSessionElementTypes] = useState<SessionElementType[]>([]);
  const [showGeneralSchedule, setShowGeneralSchedule] = useState(true);
  const [editingTask, setEditingTask] = useState<CalendarTask | null>(null);
  const [selectedTasksForLock, setSelectedTasksForLock] = useState<number[]>(
    [],
  );
  const [showExportModal, setShowExportModal] = useState(false);
  const [isExportingTasks, setIsExportingTasks] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const getPersonName = useCallback(
    (personId: number) => {
      const person = persons.find((candidate) => candidate.id === personId);
      return person
        ? `${person.first_name} ${person.last_name}`.trim()
        : "Unknown";
    },
    [persons],
  );

  const describePersonFieldValue = useCallback(
    (value: unknown) => {
      const members = normaliseGroupMembers(Array.isArray(value) ? value : []);
      const resolved = resolveGroupMemberList(members, groups);
      return resolved.personIds.map(getPersonName).filter(Boolean).join(", ");
    },
    [getPersonName, groups],
  );

  // Flow check state
  const [flowCheckStatus, setFlowCheckStatus] = useState<
    "checking" | "valid" | "invalid" | null
  >(null);
  const [flowCheckErrors, setFlowCheckErrors] = useState<string[]>([]);
  const [flowCheckDiagnostics, setFlowCheckDiagnostics] = useState<
    import("@/types/optimization").FeasibilityDiagnostics | null
  >(null);
  const [infeasibleTaskIds, setInfeasibleTaskIds] = useState<Set<number>>(
    new Set(),
  );
  const [infeasibleTaskErrors, setInfeasibleTaskErrors] = useState<
    Map<number, string[]>
  >(new Map());

  // Cancel-and-replace: abort in-flight flow checks when new ones start
  const flowCheckAbortRef = useRef<AbortController | null>(null);
  const flowCheckGenerationRef = useRef(0);

  // Compute unique infeasible task names for the header tooltip
  const infeasibleTasks = useMemo(() => {
    const seen = new Set<number>();
    const result: Array<{ id: number; name: string }> = [];
    for (const taskId of infeasibleTaskIds) {
      if (seen.has(taskId)) continue;
      seen.add(taskId);
      const instance = contextInstances.find(
        (t: any) => Math.floor(t.id) === taskId,
      );
      result.push({ id: taskId, name: instance?.name || `Task ${taskId}` });
    }
    return result;
  }, [infeasibleTaskIds, contextInstances]);

  // Scroll to a task on the calendar when clicked from header
  const handleInfeasibleTaskClick = useCallback((taskId: number) => {
    const el = document.querySelector(`[data-task-id="${taskId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  // New task creation state
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [newTaskSlotInfo, setNewTaskSlotInfo] = useState<{
    date: string;
    time?: string;
    location?: string;
  } | null>(null);
  const [selectedTemplateForNew, setSelectedTemplateForNew] =
    useState<TaskTemplate | null>(null);
  const scheduleDayBoundary = useMemo(
    () => getScheduleDayBoundaryFromRange(selectedEvent?.meta_data?.schedule_day_range),
    [
      selectedEvent?.meta_data?.schedule_day_range?.startHour,
      selectedEvent?.meta_data?.schedule_day_range?.endHour,
    ],
  );

  const getInstanceStartClock = useCallback(
    (instance: any): string | null => {
      const template = templates.find((t: any) => t.id === instance.template_id);
      if (!template?.fields || !instance.field_values) return null;

      for (const field of template.fields) {
        const value = instance.field_values[field.id];
        if (field.type === "start_end_time" && value?.start) return value.start;
        if (field.type === "time_range" && value?.start) return value.start;
        if (field.type === "time" && typeof value === "string") return value;
      }
      return null;
    },
    [templates],
  );

  const isInstanceInSelectedWorkingDay = useCallback(
    (instance: any) =>
      getWorkingDayForDateTime(
        instance.date,
        getInstanceStartClock(instance),
        scheduleDayBoundary,
      ) === selectedDate,
    [getInstanceStartClock, scheduleDayBoundary, selectedDate],
  );

  const selectedTaskInstances = useMemo(
    () =>
      selectedTasksForLock
        .map((taskId) =>
          contextInstances.find((instance: any) => instance.id === taskId),
        )
        .filter((instance): instance is TaskInstance => Boolean(instance)),
    [contextInstances, selectedTasksForLock],
  );

  const generalScheduleBlocks = useMemo<CalendarBackgroundBlock[]>(
    () =>
      sessionElements.map((element) => ({
        id: `session-${element.id}`,
        title: element.title,
        date: element.date,
        start_time: element.start_time,
        end_time: element.end_time,
        colour: getSessionElementColour(getSessionElementType(element, sessionElementTypes)?.colour),
        location: getSessionElementLocation(element, locations),
        audience: getSessionElementTeamNames(element, audienceTeams).join(", "),
        responsible: getSessionElementResponsible(element, persons),
        visibility: element.visibility,
      })),
    [audienceTeams, locations, persons, sessionElements, sessionElementTypes],
  );

  const getDayLabel = useCallback(
    (date: string) =>
      selectedEvent?.meta_data?.day_aliases?.[date] ||
      formatDateWithWeekday(date),
    [selectedEvent?.meta_data?.day_aliases],
  );

  // Helper to get day information for a given date
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

  // Update selected date when event changes
  useEffect(() => {
    if (selectedEvent?.start_date) {
      setSelectedDate(selectedEvent.start_date);
    }
  }, [selectedEvent]);

  // Only re-fetch reference data when event changes or manual refresh
  useEffect(() => {
    if (selectedEvent) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvent, refreshTrigger]);

  // Update editingTask when tasks change (to keep modal in sync with calendar)
  useEffect(() => {
    if (editingTask) {
      const refreshedTask = tasks.find((t) => t.id === editingTask.id);
      if (refreshedTask) {
        setEditingTask(refreshedTask);
      }
    }
  }, [tasks]);

  // Keyboard shortcuts for deleting and duplicating selected tasks
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      // No tasks selected - no action needed
      if (selectedTasksForLock.length === 0) return;

      if (matchesShortcut(e, "cmi.deleteSelected")) {
        e.preventDefault();
        handleDeleteSelectedTasks();
        return;
      }

      if (matchesShortcut(e, "cmi.duplicateSelected")) {
        e.preventDefault();
        handleDuplicateSelectedTasks();
        return;
      }

      if (matchesShortcut(e, "cmi.moveEarlierLarge")) {
        e.preventDefault();
        handleMoveSelectedTasks(-15);
        return;
      }

      if (matchesShortcut(e, "cmi.moveLaterLarge")) {
        e.preventDefault();
        handleMoveSelectedTasks(15);
        return;
      }

      if (matchesShortcut(e, "cmi.moveEarlier")) {
        e.preventDefault();
        handleMoveSelectedTasks(-5);
        return;
      }

      if (matchesShortcut(e, "cmi.moveLater")) {
        e.preventDefault();
        handleMoveSelectedTasks(5);
        return;
      }

      if (matchesShortcut(e, "cmi.clearSelection")) {
        e.preventDefault();
        setSelectedTasksForLock([]);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [matchesShortcut, selectedTasksForLock, tasks, taskTypes]);

  const fetchData = async () => {
    if (!selectedEvent) return;
    setLoading(true);
    try {
      // Fetch task types
      const typesData = await taskTypesApi.getAll();
      setTaskTypes(typesData);

      // Fetch capabilities
      const capsData = await capabilitiesApi.getAll(selectedEvent.id);
      setCapabilities(capsData);

      // Fetch persons
      const personsData = await personsApi.getAll(selectedEvent.id);
      setPersons(personsData);

      // Fetch groups
      const groupsData = await groupsApi.getAll(selectedEvent.id);
      setGroups(groupsData);

      // Fetch locations
      const locsData = await locationsApi.getAll(selectedEvent.id);
      setLocations(locsData);

      // Fetch General Schedule context
      const [audienceTeamRows, sessionElementRows, sessionElementTypeRows] = await Promise.all([
        generalScheduleApi.getTeams(selectedEvent.id),
        generalScheduleApi.getElements(selectedEvent.id),
        generalScheduleApi.getSessionElementTypes(selectedEvent.id),
      ]);
      setAudienceTeams(audienceTeamRows);
      setSessionElements(sessionElementRows);
      setSessionElementTypes(sessionElementTypeRows);

      // Fetch task templates
      const templatesData = await taskTemplatesApi.getAll();
      setTemplates(templatesData);

      // Reference data loaded; tasks are derived in a separate effect below.
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Derive CalendarTasks from context instances + reference data.
  // This effect runs whenever instances change (create/delete/update) WITHOUT
  // triggering a full API re-fetch, giving a smooth editing experience.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!selectedEvent || templates.length === 0 || taskTypes.length === 0)
      return;

    const allInstances = contextInstances;

    // Filter instances for this event AND within the event's date range
    const taskInstances = allInstances.filter((instance: any) => {
      if (instance.event_id !== selectedEvent.id) return false;
      if (instance.date) {
        const latestActualDate =
          scheduleDayBoundary.offsetHour > 0
            ? addDays(selectedEvent.end_date, 1)
            : selectedEvent.end_date;
        return (
          instance.date >= selectedEvent.start_date &&
          instance.date <= latestActualDate
        );
      }
      return true;
    });

    // Convert task instances to calendar tasks
    const calendarTasks: CalendarTask[] = taskInstances.map((instance: any) => {
      const template = templates.find(
        (t: any) => t.id === instance.template_id,
      );
      const taskType = taskTypes.find(
        (t: TaskType) => t.id === instance.task_type_id,
      );

      // Helper function to find field value by type
      const findFieldValueByType = (fieldType: string) => {
        if (!template?.fields || !instance.field_values) return undefined;
        const field = template.fields.find((f: any) => f.type === fieldType);
        if (!field) return undefined;
        return instance.field_values[field.id];
      };

      // Extract location from field values
      const locationFieldValue = findFieldValueByType("location");
      const locationId =
        locationFieldValue === null
          ? null
          : typeof locationFieldValue === "number"
            ? locationFieldValue
            : locationFieldValue?.value;
      const location = locations.find((l: Location) => l.id === locationId);

      // For transfer tasks with multiple location fields, show start --> end
      let locationName = location?.name;
      if (template?.fields) {
        const locationFields = template.fields.filter(
          (f: any) => f.type === "location",
        );
        if (locationFields.length >= 2 && instance.field_values) {
          const startLocFieldValue =
            instance.field_values[locationFields[0].id];
          const endLocFieldValue = instance.field_values[locationFields[1].id];
          const startLocId =
            typeof startLocFieldValue === "number"
              ? startLocFieldValue
              : startLocFieldValue?.value;
          const endLocId =
            typeof endLocFieldValue === "number"
              ? endLocFieldValue
              : endLocFieldValue?.value;
          const startLoc = locations.find((l: Location) => l.id === startLocId);
          const endLoc = locations.find((l: Location) => l.id === endLocId);
          if (startLoc && endLoc) {
            locationName = `${startLoc.name} → ${endLoc.name}`;
          }
        }
      }

      // Extract time-related fields
      const timeValue = findFieldValueByType("time");
      const timeRangeValue = findFieldValueByType("time_range");
      const startEndTimeValue = findFieldValueByType("start_end_time");
      const durationValue = findFieldValueByType("duration");

      // Transform field values to include actual object data (not just IDs)
      const transformedFields: { [key: string]: any } = {};

      // Collect capabilities and persons for resource_info string, grouped by field
      const fieldResourceParts: string[] = [];
      const runtimeGroupDisplay = resolveRuntimeGroupAssignmentsForFields({
        fields: template?.fields || [],
        fieldValues: instance.field_values || {},
        groups,
        persons,
        taskDate: instance.date,
        workingDayBoundaryOffsetHour: scheduleDayBoundary.offsetHour,
        taskStart: startEndTimeValue?.start,
        taskEnd: startEndTimeValue?.end,
      });
      const hasRuntimeGroupExclusions =
        Object.keys(runtimeGroupDisplay.fieldAssignmentExclusions).length > 0;

      if (template?.fields && instance.field_values) {
        template.fields.forEach((field: any) => {
          const rawValue = instance.field_values[field.id];
          if (rawValue === undefined) return;

          switch (field.type) {
            case "capabilities_list":
              if (Array.isArray(rawValue)) {
                const caps = rawValue
                  .map((item: any) => {
                    const capId = typeof item === "object" ? item.id : item;
                    const quantity =
                      typeof item === "object" ? item.quantity : 1;
                    const capability = capabilities.find(
                      (c: any) => c.id === capId,
                    );
                    return capability
                      ? { ...capability, amount: quantity }
                      : null;
                  })
                  .filter(Boolean);
                transformedFields[field.id] = caps;
                const capStr = caps
                  .map((c: any) => `${c.name} (${c.amount})`)
                  .join(", ");
                if (capStr) {
                  fieldResourceParts.push(`${field.name}: ${capStr}`);
                }
              }
              break;

            case "persons_list":
              if (Array.isArray(rawValue)) {
                transformedFields[field.id] = normaliseGroupMembers(rawValue);
                const persStr = describePersonFieldValue(rawValue);
                if (persStr) {
                  fieldResourceParts.push(`${field.name}: ${persStr}`);
                }
              }
              break;

            default:
              transformedFields[field.id] = rawValue;
              break;
          }
        });
      }

      const resourceInfo = fieldResourceParts.join(" | ");

      return {
        id: instance.id,
        name: instance.name,
        task_type_id: instance.task_type_id,
        task_type_name: taskType?.name || "",
        task_type_color: taskType?.color || "#9CA3AF",
        location_id: locationId,
        location_name:
          locationName ?? (locationId === null ? "Any Location" : undefined),
        resource_info: resourceInfo,
        date: instance.date,
        fields: transformedFields,
        field_definitions: template?.fields || [],
        field_assignments: hasRuntimeGroupExclusions
          ? runtimeGroupDisplay.fieldAssignments
          : undefined,
        field_assignment_exclusions: hasRuntimeGroupExclusions
          ? runtimeGroupDisplay.fieldAssignmentExclusions
          : undefined,
        time: timeValue,
        time_range: timeRangeValue,
        start_end_time: startEndTimeValue,
        duration: durationValue,
      };
    });

    setTasks(calendarTasks);
  }, [
    contextInstances,
    selectedEvent,
    templates,
    taskTypes,
    capabilities,
    persons,
    groups,
    locations,
    describePersonFieldValue,
    scheduleDayBoundary.offsetHour,
  ]);

  const handleTaskEdit = (task: CalendarTask) => {
    setEditingTask(task);
  };

  const handleTaskSave = async (updatedTask: CalendarTask) => {
    try {
      // Convert field values from display format back to storage format
      const storageFieldValues: { [key: string]: any } = {};

      updatedTask.field_definitions.forEach((fieldDef: any) => {
        const value = updatedTask.fields[fieldDef.id];

        // Allow null through (null = "Any Location" for location fields)
        if (value === undefined) return;

        switch (fieldDef.type) {
          case "capabilities_list":
            // Convert from [{ id, name, amount }] to [{ id, quantity }]
            if (Array.isArray(value)) {
              storageFieldValues[fieldDef.id] = value.map((item: any) => ({
                id: typeof item === "object" ? item.id : item,
                quantity:
                  typeof item === "object"
                    ? item.amount || item.quantity || 1
                    : 1,
              }));
            }
            break;

          case "persons_list":
            if (Array.isArray(value)) {
              storageFieldValues[fieldDef.id] = normaliseGroupMembers(value);
            }
            break;

          default:
            // Keep other types as is (text, number, time, location, etc.)
            storageFieldValues[fieldDef.id] = value;
            break;
        }
      });
      const firstClockStart =
        updatedTask.field_definitions
          .map((fieldDef: any) => storageFieldValues[fieldDef.id])
          .find((value: any) => value?.start)?.start || null;
      const nextDate = firstClockStart
        ? getActualDateForWorkingSlot(
            selectedDate,
            firstClockStart,
            scheduleDayBoundary,
          )
        : updatedTask.date;

      // Update via API (context updates instances, which triggers task re-derivation)
      await updateInstance(updatedTask.id, {
        name: updatedTask.name,
        field_values: storageFieldValues,
        date: nextDate,
      });
    } catch (error) {
      console.error("Error updating task:", error);
    }
  };

  const handleTaskDelete = async (taskId: string) => {
    try {
      // Convert taskId to number for comparison
      const taskIdNum =
        typeof taskId === "string" ? parseInt(taskId, 10) : taskId;

      // Delete via API
      await deleteInstance(taskIdNum);

      // Close modal first
      setEditingTask(null);

      // Update local tasks state - this triggers a smooth re-render
      setTasks((prevTasks) => prevTasks.filter((t) => t.id !== taskIdNum));

      // Also remove from selected tasks if it was selected
      setSelectedTasksForLock((prev) => prev.filter((id) => id !== taskIdNum));
    } catch (error) {
      console.error("Error deleting task:", error);
    }
  };

  const handleDeleteSelectedTasks = async () => {
    try {
      if (selectedTasksForLock.length === 0) return;

      // Delete via API
      await deleteInstances(selectedTasksForLock);

      // Update local tasks state
      setTasks((prevTasks) =>
        prevTasks.filter((t) => !selectedTasksForLock.includes(t.id)),
      );

      // Clear selection
      setSelectedTasksForLock([]);
    } catch (error) {
      console.error("Error deleting selected tasks:", error);
    }
  };

  const handleSlotDoubleClick = (slotInfo: {
    date: string;
    time?: string;
    location?: string;
  }) => {
    setNewTaskSlotInfo(slotInfo);
    setShowTemplateSelector(true);
  };

  const handleTemplateSelect = async (template: TaskTemplate) => {
    if (!newTaskSlotInfo || !selectedEvent) return;

    const taskType = taskTypes.find((t) => t.id === template.task_type_id);

    // Pre-fill field values based on slot info
    const prefilledFields: any = {};

    template.fields?.forEach((field) => {
      switch (field.type) {
        case "time_range":
        case "start_end_time":
          if (newTaskSlotInfo.time) {
            // For daily view, prefill the time
            const [hours] = newTaskSlotInfo.time.split(":");
            const startHour = parseInt(hours);
            const endHour = startHour + 1;
            prefilledFields[field.id] = {
              start: `${startHour.toString().padStart(2, "0")}:00`,
              end: `${endHour.toString().padStart(2, "0")}:00`,
            };
          }
          break;
        case "location":
          if (newTaskSlotInfo.location) {
            const location = locations.find(
              (l) => l.name === newTaskSlotInfo.location,
            );
            if (location) {
              prefilledFields[field.id] = location.id;
            }
          }
          break;
      }
    });

    // Create new task instance via API (server assigns ID)
    try {
      const created = await createInstance({
        event_id: selectedEvent.id,
        template_id: template.id,
        name: template.name,
        task_type_id: template.task_type_id,
        date: newTaskSlotInfo.date,
        day_index: 0,
        is_floating: template.is_floating || false,
        is_transfer: template.is_transfer || false,
        field_values: prefilledFields,
      });

      setShowTemplateSelector(false);
      setSelectedTemplateForNew(null);
      setNewTaskSlotInfo(null);

      // Context updated instances; the derivation effect will rebuild CalendarTasks.
      // Open the newly created task for editing once tasks update.
      const createdId = created.id;
      // Use a microtask so the derivation effect runs first
      requestAnimationFrame(() => {
        setTasks((prev) => {
          const newTask = prev.find((t) => t.id === createdId);
          if (newTask) {
            setEditingTask(newTask);
          }
          return prev;
        });
      });
    } catch (error) {
      console.error("Error creating task:", error);
    }
  };

  const handleMoveSelectedTasks = (minutes: number) => {
    if (selectedTasksForLock.length === 0) return;

    try {
      const taskInstances = [...contextInstances];

      const updatedInstances = taskInstances.map((instance: any) => {
        if (!selectedTasksForLock.includes(instance.id)) return instance;

        // Find template and task type for proper time field handling
        const template = templates.find(
          (t: any) => t.id === instance.template_id,
        );
        if (!template?.fields || !instance.field_values) return instance;

        // Find the time-related field
        const timeField = template.fields.find(
          (f: any) =>
            f.type === "start_end_time" ||
            f.type === "time_range" ||
            f.type === "time",
        );
        if (!timeField) return instance;

        const timeValue = instance.field_values[timeField.id];
        if (!timeValue) return instance;

        // Parse time - can be either a number (minutes) or string (HH:MM)
        const parseTime = (timeValue: any): number => {
          if (typeof timeValue === "number") return timeValue;

          const timeString = String(timeValue);
          if (timeString.includes(":")) {
            const [hours, mins] = timeString.split(":").map(Number);
            if (!isNaN(hours) && !isNaN(mins)) {
              return hours * 60 + mins;
            }
          }

          const asNumber = Number(timeValue);
          if (!isNaN(asNumber)) return asNumber;

          console.error("Could not parse time:", timeValue);
          return 0;
        };

        // Helper to convert minutes to HH:MM
        const minutesToTime = (minutes: number): string => {
          const hours = Math.floor(minutes / 60);
          const mins = minutes % 60;
          return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
        };

        // Handle different time field types
        if (timeField.type === "start_end_time") {
          const startMinutes = parseTime(timeValue.start);
          const endMinutes = parseTime(timeValue.end);

          const newStartMinutes = Math.max(
            0,
            Math.min(1439, startMinutes + minutes),
          );
          const duration = endMinutes - startMinutes;
          const newEndMinutes = Math.max(
            0,
            Math.min(1440, newStartMinutes + duration),
          );

          return {
            ...instance,
            field_values: {
              ...instance.field_values,
              [timeField.id]: {
                start: minutesToTime(newStartMinutes),
                end: minutesToTime(newEndMinutes),
              },
            },
          };
        } else if (timeField.type === "time_range") {
          const startMinutes = parseTime(timeValue.start);
          const endMinutes = parseTime(timeValue.end);

          const newStartMinutes = Math.max(
            0,
            Math.min(1439, startMinutes + minutes),
          );
          const duration = endMinutes - startMinutes;
          const newEndMinutes = Math.max(
            0,
            Math.min(1440, newStartMinutes + duration),
          );

          return {
            ...instance,
            field_values: {
              ...instance.field_values,
              [timeField.id]: {
                start: minutesToTime(newStartMinutes),
                end: minutesToTime(newEndMinutes),
              },
            },
          };
        } else if (timeField.type === "time") {
          const timeMinutes = parseTime(timeValue);
          const newTimeMinutes = Math.max(
            0,
            Math.min(1439, timeMinutes + minutes),
          );

          return {
            ...instance,
            field_values: {
              ...instance.field_values,
              [timeField.id]: minutesToTime(newTimeMinutes),
            },
          };
        }

        return instance;
      });

      // Fire-and-forget API updates for changed instances
      const changedMoveInstances = updatedInstances.filter((inst: any) =>
        selectedTasksForLock.includes(inst.id),
      );
      Promise.all(
        changedMoveInstances.map((inst: any) =>
          updateInstance(inst.id, { field_values: inst.field_values }),
        ),
      ).catch(console.error);

      // Update local state immediately without triggering full refresh
      setTasks((prevTasks) => {
        return prevTasks.map((task) => {
          if (!selectedTasksForLock.includes(task.id)) return task;

          const updatedInstance = updatedInstances.find(
            (inst: any) => inst.id === task.id,
          );
          if (!updatedInstance) return task;

          // Find template to get time field
          const template = templates.find(
            (t: any) => t.id === updatedInstance.template_id,
          );
          if (!template?.fields) return task;

          const timeField = template.fields.find(
            (f: any) =>
              f.type === "start_end_time" ||
              f.type === "time_range" ||
              f.type === "time",
          );
          if (!timeField) return task;

          const newTimeValue = updatedInstance.field_values[timeField.id];
          if (!newTimeValue) return task;

          // Update the task's transformed field to reflect new time
          const updatedFields = { ...task.fields };
          if (
            timeField.type === "start_end_time" ||
            timeField.type === "time_range"
          ) {
            updatedFields[timeField.id] = {
              ...updatedFields[timeField.id],
              start: newTimeValue.start,
              end: newTimeValue.end,
            };
          } else if (timeField.type === "time") {
            updatedFields[timeField.id] = newTimeValue;
          }

          // Create new task object to ensure re-render
          return {
            ...task,
            fields: updatedFields,
            start_end_time:
              timeField.type === "start_end_time" ||
              timeField.type === "time_range"
                ? { start: newTimeValue.start, end: newTimeValue.end }
                : task.start_end_time,
          };
        });
      });
    } catch (error) {
      console.error("Error moving selected tasks:", error);
    }
  };

  const handleDuplicateSelectedTasks = async () => {
    try {
      // Get task instances from context
      const taskInstances = [...contextInstances];

      const newTasks: CalendarTask[] = [];
      const newInstances: any[] = [];

      // Duplicate each selected task
      selectedTasksForLock.forEach((taskId) => {
        const originalInstance = taskInstances.find(
          (instance: any) => instance.id === taskId,
        );

        if (!originalInstance) {
          console.error(`Task instance ${taskId} not found`);
          return;
        }

        // Create a duplicate with a new integer ID, keeping all other properties including date and time
        const duplicatedTask = {
          ...originalInstance,
          id: Math.floor(Date.now() * 1000 + Math.random() * 1000000), // Unique integer ID
          field_values: { ...originalInstance.field_values },
        };

        newInstances.push(duplicatedTask);

        // Find template and task type for proper transformation
        const template = templates.find(
          (t: any) => t.id === duplicatedTask.template_id,
        );
        const taskType = taskTypes.find(
          (t) => t.id === duplicatedTask.task_type_id,
        );

        // Helper function to find field value by type
        const findFieldValueByType = (fieldType: string) => {
          if (!template?.fields || !duplicatedTask.field_values)
            return undefined;

          const field = template.fields.find((f: any) => f.type === fieldType);
          if (!field) return undefined;

          return duplicatedTask.field_values[field.id];
        };

        // Extract location from field values
        const locationFieldValue = findFieldValueByType("location");
        const locationId =
          locationFieldValue === null
            ? null // Preserve null = "Any Location"
            : typeof locationFieldValue === "number"
              ? locationFieldValue
              : locationFieldValue?.value;
        const location = locations.find((l) => l.id === locationId);

        // Extract time-related fields
        const timeValue = findFieldValueByType("time");
        const timeRangeValue = findFieldValueByType("time_range");
        const startEndTimeValue = findFieldValueByType("start_end_time");
        const durationValue = findFieldValueByType("duration");

        // Transform field values to include actual object data (not just IDs)
        const transformedFields: { [key: string]: any } = {};

        if (template?.fields && duplicatedTask.field_values) {
          template.fields.forEach((field: any) => {
            const rawValue = duplicatedTask.field_values[field.id];
            // Allow null through (null = "Any Location" for location fields)
            if (rawValue === undefined) return;

            switch (field.type) {
              case "capabilities_list":
                if (Array.isArray(rawValue)) {
                  transformedFields[field.id] = rawValue
                    .map((item: any) => {
                      const capId = typeof item === "object" ? item.id : item;
                      const quantity =
                        typeof item === "object" ? item.quantity : 1;
                      const capability = capabilities.find(
                        (c: any) => c.id === capId,
                      );
                      return capability
                        ? { ...capability, amount: quantity }
                        : null;
                    })
                    .filter(Boolean);
                }
                break;

              case "persons_list":
                if (Array.isArray(rawValue)) {
                  transformedFields[field.id] = normaliseGroupMembers(rawValue);
                }
                break;

              default:
                transformedFields[field.id] = rawValue;
                break;
            }
          });
        }

        const calendarTask: CalendarTask = {
          id: duplicatedTask.id,
          name: duplicatedTask.name,
          task_type_id: duplicatedTask.task_type_id || 0,
          task_type_name: taskType?.name || "",
          task_type_color: taskType?.color || "#6b7280",
          location_id: locationId,
          location_name:
            location?.name ??
            (locationId === null ? "Any Location" : undefined),
          date: duplicatedTask.date,
          fields: transformedFields,
          field_definitions: template?.fields || [],
          time: timeValue,
          time_range: timeRangeValue,
          start_end_time: startEndTimeValue,
          duration: durationValue,
        };

        newTasks.push(calendarTask);
      });

      // Create all new instances via API
      await createInstances(
        newInstances.map((inst: any) => ({
          event_id: inst.event_id,
          template_id: inst.template_id,
          name: inst.name,
          task_type_id: inst.task_type_id,
          date: inst.date,
          day_index: inst.day_index || 0,
          is_floating: inst.is_floating || false,
          is_transfer: inst.is_transfer || false,
          field_values: inst.field_values,
        })),
      );

      // Context updated; the derivation effect will rebuild CalendarTasks.

      // Clear selection
      setSelectedTasksForLock([]);
    } catch (error) {
      console.error("Error duplicating tasks:", error);
    }
  };

  const handleExportSelectedTasks = async (targetDates: string[]) => {
    if (isExportingTasks) return;
    if (selectedTaskInstances.length === 0 || targetDates.length === 0) return;

    setIsExportingTasks(true);
    try {
      const payloads = buildTaskExportPayloads(
        selectedTaskInstances,
        selectedDate,
        targetDates,
        selectedEvent.start_date,
      );
      await createInstances(payloads);

      const taskCount = selectedTaskInstances.length;
      const targetCount = targetDates.length;
      addToast(
        targetCount === 1
          ? `Exported ${taskCount} task${taskCount === 1 ? "" : "s"} to ${getDayLabel(targetDates[0])}.`
          : `Exported ${taskCount} task${taskCount === 1 ? "" : "s"} to ${targetCount} days.`,
        "success",
      );
      setSelectedTasksForLock([]);
      setShowExportModal(false);
    } catch (error) {
      console.error("Error exporting selected tasks:", error);
      addToast("Could not export selected tasks. Please try again.", "error");
    } finally {
      setIsExportingTasks(false);
    }
  };

  // Track pending task updates to batch them
  const pendingTaskUpdates = useRef<Map<number, any>>(new Map());
  const batchUpdateTimer = useRef<NodeJS.Timeout | null>(null);

  const handleTaskDrop = (
    task: CalendarTask,
    newTime: string,
    referenceTask?: CalendarTask,
    selectedWorkingDate: string = selectedDate,
    newWorkingStartMinutes?: number,
  ) => {
    try {
      const parseDisplayMinutes = (time: string): number => {
        const [hours, minutes] = time.split(":").map(Number);
        return hours * 60 + minutes;
      };

      // Find the time field
      const timeFieldDef = task.field_definitions?.find(
        (f) => f.type === "start_end_time",
      );
      if (!timeFieldDef) {
        console.warn("No start_end_time field found");
        return;
      }

      // Get current value
      const currentValue = task.fields[timeFieldDef.id];
      if (!currentValue?.start || !currentValue?.end) {
        console.warn("No valid time value found");
        return;
      }

      // Calculate the duration
      const [startHour, startMin] = currentValue.start.split(":").map(Number);
      const [endHour, endMin] = currentValue.end.split(":").map(Number);
      const currentStartMinutes = startHour * 60 + startMin;
      const currentEndMinutes = endHour * 60 + endMin;
      const durationMinutes =
        currentEndMinutes <= currentStartMinutes
          ? currentEndMinutes + 24 * 60 - currentStartMinutes
          : currentEndMinutes - currentStartMinutes;

      const explicitWorkingStart =
        typeof newWorkingStartMinutes === "number" &&
        Number.isFinite(newWorkingStartMinutes)
          ? newWorkingStartMinutes
          : null;
      const hasExplicitWorkingStart = explicitWorkingStart !== null;
      let actualNewStartMinutes =
        explicitWorkingStart ?? parseDisplayMinutes(newTime);

      // If there's a reference task, calculate relative offset using ORIGINAL positions
      if (referenceTask && task.id !== referenceTask.id) {
        const refTimeFieldDef = referenceTask.field_definitions?.find(
          (f) => f.type === "start_end_time",
        );
        if (refTimeFieldDef) {
          const refValue = referenceTask.fields[refTimeFieldDef.id];
          if (refValue?.start) {
            // Calculate offset from reference task's ORIGINAL position
            const refStartMinutes =
              toWorkingDayMinutes(
                referenceTask.date,
                refValue.start,
                selectedWorkingDate,
              ) ?? parseDisplayMinutes(refValue.start);
            const thisStartMinutes =
              toWorkingDayMinutes(
                task.date,
                currentValue.start,
                selectedWorkingDate,
              ) ?? currentStartMinutes;
            const offsetMinutes = thisStartMinutes - refStartMinutes;

            // Apply offset to the new time
            actualNewStartMinutes = actualNewStartMinutes + offsetMinutes;
          }
        }
      }

      // Calculate new end time
      const newEndMinutes = actualNewStartMinutes + durationMinutes;
      const actualNewTime = minutesToClockTime(actualNewStartMinutes);
      const actualNewDate = hasExplicitWorkingStart
        ? addDays(
            selectedWorkingDate,
            Math.floor(actualNewStartMinutes / (24 * 60)),
          )
        : getActualDateForWorkingSlot(
            selectedWorkingDate,
            actualNewTime,
            scheduleDayBoundary,
          );

      const newTimeValue = {
        start: actualNewTime,
        end: minutesToClockTime(newEndMinutes),
      };

      // Add to pending updates
      pendingTaskUpdates.current.set(task.id, {
        taskId: task.id,
        fieldId: timeFieldDef.id,
        newValue: newTimeValue,
        date: actualNewDate,
      });

      // Clear existing timer and set new one
      if (batchUpdateTimer.current) {
        clearTimeout(batchUpdateTimer.current);
      }

      batchUpdateTimer.current = setTimeout(() => {
        processBatchedTaskUpdates();
      }, 50); // Wait 50ms for all drops to complete
    } catch (error) {
      console.error("Error preparing task drop:", error);
    }
  };

  const processBatchedTaskUpdates = () => {
    try {
      if (pendingTaskUpdates.current.size === 0) return;

      // Read from ref (always latest, avoids stale closure from setTimeout)
      const taskInstances = [...instancesRef.current];

      // Apply all updates
      pendingTaskUpdates.current.forEach((update) => {
        const taskIndex = taskInstances.findIndex(
          (instance: any) => instance.id === update.taskId,
        );
        if (taskIndex !== -1) {
          if (!taskInstances[taskIndex].field_values) {
            taskInstances[taskIndex].field_values = {};
          }
          taskInstances[taskIndex].field_values![update.fieldId] =
            update.newValue;
          if (update.date) {
            taskInstances[taskIndex].date = update.date;
          }
        }
      });

      // Fire-and-forget API updates for changed instances
      const changedTaskIds = Array.from(pendingTaskUpdates.current.keys());
      Promise.all(
        changedTaskIds.map((taskId) => {
          const inst = taskInstances.find((i: any) => i.id === taskId);
          if (inst) {
            return updateInstance(inst.id, {
              field_values: inst.field_values,
              date: inst.date,
            });
          }
          return Promise.resolve();
        }),
      ).catch(console.error);

      // Create a snapshot of pending updates for the state update
      const updatesSnapshot = new Map(pendingTaskUpdates.current);

      // Clear pending updates before state update
      pendingTaskUpdates.current.clear();

      // Update state optimistically without full refresh
      setTasks((prevTasks) =>
        prevTasks.map((task) => {
          const update = updatesSnapshot.get(task.id);
          if (update) {
            // Find the time field definition
            const timeFieldDef = task.field_definitions?.find(
              (f) => f.type === "start_end_time",
            );
            if (timeFieldDef) {
              // Create a completely new task object to ensure re-render
              return {
                ...task,
                fields: {
                  ...task.fields,
                  [update.fieldId]: update.newValue,
                },
                start_end_time: update.newValue,
                date: update.date ?? task.date,
              };
            }
          }
          return task;
        }),
      );
    } catch (error) {
      console.error("Error processing batched updates:", error);
    }
  };

  const handlePreviousDay = () => {
    const currentDate = new Date(selectedDate);
    const previousDate = new Date(currentDate);
    previousDate.setDate(currentDate.getDate() - 1);

    const previousDateStr = previousDate.toISOString().split("T")[0];

    // Check if within event range
    if (previousDateStr >= selectedEvent.start_date) {
      setSelectedDate(previousDateStr);
    }
  };

  const handleNextDay = () => {
    const currentDate = new Date(selectedDate);
    const nextDate = new Date(currentDate);
    nextDate.setDate(currentDate.getDate() + 1);

    const nextDateStr = nextDate.toISOString().split("T")[0];

    // Check if within event range
    if (nextDateStr <= selectedEvent.end_date) {
      setSelectedDate(nextDateStr);
    }
  };

  const handleSendToFlowCheck = async (silent: boolean = false) => {
    // Abort any in-flight flow check
    flowCheckAbortRef.current?.abort();
    const controller = new AbortController();
    flowCheckAbortRef.current = controller;

    // Capture generation to detect stale results
    const generation = ++flowCheckGenerationRef.current;

    setFlowCheckStatus("checking");
    try {
      const result = await performFlowCheck({
        selectedEvent,
        selectedDate,
        templates,
        taskTypes,
        persons,
        locations,
        taskInstances: contextInstances,
        scheduleDayBoundary,
        silent,
        signal: controller.signal,
        // Skip floating tasks in auto-checks only when mode is "skip-floating"
        skipFloating: silent && getFlowCheckMode() === "skip-floating",
      });

      // Discard if a newer check was started while we were waiting
      if (generation !== flowCheckGenerationRef.current) return;

      setFlowCheckStatus(result.status);
      setFlowCheckErrors(result.errors);
      setFlowCheckDiagnostics(result.diagnostics);
      setInfeasibleTaskIds(result.infeasibleTaskIds);
      setInfeasibleTaskErrors(result.infeasibleTaskErrors);
    } catch (err: any) {
      // Silently ignore aborted requests
      if (err?.name === "AbortError") return;
      throw err;
    }
  };

  // Auto-check flow when data changes (debounced, cancel-and-replace)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      // Only auto-check if there are tasks and persons
      const eventTasks = contextInstances.filter(
        (instance: any) => instance.event_id === selectedEvent?.id,
      );

      if (eventTasks.length > 0 && persons.length > 0 && locations.length > 0) {
        handleSendToFlowCheck(true); // Silent auto-check (skips floating tasks)
      }
    }, 1500); // 1.5 second debounce

    return () => clearTimeout(timeoutId);
  }, [
    persons,
    locations,
    capabilities,
    selectedDate,
    contextInstances,
    scheduleDayBoundary.offsetHour,
  ]);

  if (!selectedEvent) {
    return (
      <div className="p-6 text-center text-foreground-muted">
        Please select an event to configure Constraint Model Inputs.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header with view controls */}
      <CMIHeader
        selectedDate={selectedDate}
        selectedEvent={selectedEvent}
        flowCheckStatus={flowCheckStatus}
        flowCheckErrors={flowCheckErrors}
        flowCheckDiagnostics={flowCheckDiagnostics}
        infeasibleTasks={infeasibleTasks}
        getDayInfo={getDayInfo}
        onRefresh={() => setRefreshTrigger((prev) => prev + 1)}
        onInfeasibleTaskClick={handleInfeasibleTaskClick}
        onOptimise={async () => {
          // --- Run a FULL flow check (including floating tasks) before optimising ---
          // When mode is "always-full", auto-checks already include floating tasks,
          // but we still gate on the current status. When "skip-floating", we must
          // run a fresh full check since auto-checks skipped floating tasks.
          const mode = getFlowCheckMode();
          if (mode === "skip-floating") {
            setFlowCheckStatus("checking");
            try {
              const fullCheck = await performFlowCheck({
                selectedEvent,
                selectedDate,
                templates,
                taskTypes,
                persons,
                locations,
                taskInstances: contextInstances,
                scheduleDayBoundary,
                silent: true,
                skipFloating: false, // include floating tasks
              });
              setFlowCheckStatus(fullCheck.status);
              setFlowCheckErrors(fullCheck.errors);
              setFlowCheckDiagnostics(fullCheck.diagnostics);
              setInfeasibleTaskIds(fullCheck.infeasibleTaskIds);
              setInfeasibleTaskErrors(fullCheck.infeasibleTaskErrors);

              if (fullCheck.status === "invalid") {
                return;
              }
            } catch (err) {
              console.error("Pre-optimise flow check failed:", err);
              alert(
                "Cannot optimise: Flow check encountered an error. Please try again.",
              );
              setFlowCheckStatus("invalid");
              return;
            }
          } else {
            // "always-full" mode  -  auto-check already validated floating tasks.
            // Just verify the current status is not "invalid".
            if (flowCheckStatus === "invalid") {
              return;
            }
          }

          // Check if all persons have home locations
          const personsWithoutHomeLocation = persons.filter(
            (person) => !person.home_location_id,
          );

          if (personsWithoutHomeLocation.length > 0) {
            const names = personsWithoutHomeLocation
              .map((p) => `${p.first_name} ${p.last_name}`)
              .join(", ");
            alert(
              `Cannot optimise: The following persons do not have a home location assigned: ${names}. Please assign home locations in the Users section before optimising.`,
            );
            return;
          }

          // Get task instances for this event and date (same as flow checker)
          const eventTasks = contextInstances.filter(
            (instance: any) =>
              instance.event_id === selectedEvent?.id &&
              isInstanceInSelectedWorkingDay(instance),
          );

          if (eventTasks.length === 0) {
            alert(
              "No tasks found for this date. Please add tasks before optimising.",
            );
            return;
          }

          // Extract location_id from field_values using template (exactly like flow checker)
          const tasksWithLocation = eventTasks.map((task: any) => {
            const template = templates.find(
              (t: any) => t.id === task.template_id,
            );
            const taskType = taskTypes.find(
              (type) => type.id === task.task_type_id,
            );

            let locationId = null;
            const isFloating = template?.is_floating || false;
            const isTransfer = template?.is_transfer || false;

            // Find location field from template (same as flow checker)
            if (template?.fields && task.field_values) {
              const locationField = template.fields.find(
                (f: any) =>
                  f.type === "location" || f.type === "start_location",
              );

              if (locationField) {
                const locationFieldValue = task.field_values[locationField.id];

                locationId =
                  locationFieldValue === null
                    ? null // Preserve null = "Any Location" (solver picks)
                    : typeof locationFieldValue === "number"
                      ? locationFieldValue
                      : locationFieldValue?.value;
              }
            }

            return {
              ...task,
              id: Math.floor(task.id), // Convert float IDs to integers
              location_id: locationId,
              is_floating: isFloating,
              is_transfer: isTransfer,
              counts_towards_work_time:
                taskType?.counts_towards_work_time !== false,
            };
          });

          // Allow tasks with null location (any-location tasks) - only exclude undefined
          const validTasks = tasksWithLocation.filter(
            (task: any) => task.location_id !== undefined,
          ).map((task: any) =>
            lineariseTaskTimesForWorkingDay(
              task,
              selectedDate,
              scheduleDayBoundary,
            ),
          );

          if (validTasks.length === 0) {
            alert(
              "No tasks with valid locations found. Please ensure all tasks have locations assigned.",
            );
            return;
          }

          // Fetch capabilities from API (like flow checker)
          const capabilities = await capabilitiesApi.getAll(selectedEvent.id);

          // Build fatigue_scores map from task types
          const fatigueScores: { [key: number]: number } = {};
          taskTypes.forEach((taskType) => {
            fatigueScores[taskType.id] = taskType.fatigue_score ?? 1.0;
          });

          // Look up previous day's fatigue for carry-over
          let personsWithFatigue = persons;
          try {
            const prevDate = new Date(selectedDate + "T00:00:00");
            prevDate.setDate(prevDate.getDate() - 1);
            const prevDateStr = prevDate.toISOString().split("T")[0];

            const jobList = await optimizationApi.getJobsForEvent(
              selectedEvent.id,
            );
            const prevJob = jobList.jobs.find(
              (j) => j.date === prevDateStr && j.status === "completed",
            );
            if (prevJob) {
              const prevStatus = await optimizationApi.getJobStatus(
                prevJob.id,
                selectedEvent.id,
              );
              const perPerson =
                prevStatus.result_data?.fatigue_stats?.per_person;
              if (perPerson && typeof perPerson === "object") {
                personsWithFatigue = persons.map((p: any) => ({
                  ...p,
                  initial_fatigue: perPerson[String(p.id)] ?? 0,
                }));
                console.log(
                  `[Optimize] Loaded initial_fatigue from previous day (${prevDateStr})`,
                );
              }
            }
          } catch (err) {
            console.warn(
              "[Optimize] Could not load previous day fatigue, using 0:",
              err,
            );
          }

          // Prepare optimization request (same structure as flow checker + fatigue_scores)
          const optimizationRequest = {
            event_id: selectedEvent.id,
            date: selectedDate,
            working_day_boundary_offset_hour: scheduleDayBoundary.offsetHour,
            test_mode: false, // Always use real optimizer
            tasks: validTasks,
            persons: personsWithFatigue,
            locations: locations,
            capabilities: capabilities,
            fatigue_scores: fatigueScores,
          };

          try {
            const result =
              await optimizationApi.startOptimization(optimizationRequest);

            // Track optimization in context
            startOptimization(selectedEvent.id, selectedDate, result.job_id);
          } catch (error) {
            console.error("Error starting optimization:", error);
            alert(
              `Failed to start optimisation:\n\n${
                error instanceof Error ? error.message : "Unknown error"
              }`,
            );
          }
        }}
        onPreviousDay={handlePreviousDay}
        onNextDay={handleNextDay}
      />

      {/* Selected Tasks Panel */}
      <SelectedTasksPanel
        selectedCount={selectedTasksForLock.length}
        onClear={() => setSelectedTasksForLock([])}
        onDuplicate={handleDuplicateSelectedTasks}
        onDelete={handleDeleteSelectedTasks}
        onExport={() => setShowExportModal(true)}
        exportDisabled={isExportingTasks}
        customHints={
          <p className="mt-0.5 text-xs text-foreground-muted">
            Press{" "}
            <kbd className="rounded border border-bordercl bg-surface-inset px-1.5 py-0.5 font-mono text-[11px] text-foreground-secondary">
              D
            </kbd>{" "}
            to duplicate •{" "}
            <kbd className="rounded border border-bordercl bg-surface-inset px-1.5 py-0.5 font-mono text-[11px] text-foreground-secondary">
              Delete
            </kbd>{" "}
            to delete •{" "}
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

      <div className="flex justify-end gap-2">
        <button
          className="rounded-md px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30"
          onClick={() => onOpenGeneralSchedule?.(selectedDate)}
        >
          Open General Schedule
        </button>
        <button
          className="rounded-md border border-bordercl px-3 py-1.5 text-sm text-foreground-secondary hover:bg-surface-hover"
          onClick={() => setShowGeneralSchedule((value) => !value)}
        >
          {showGeneralSchedule ? "Hide programme bands" : "Show programme bands"}
        </button>
      </div>

      {/* Calendar */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div className="bg-surface rounded-lg shadow-sm border border-bordercl overflow-hidden">
          <Calendar
            tasks={tasks}
            viewType="daily"
            selectedDate={selectedDate}
            eventStartDate={selectedEvent.start_date}
            eventEndDate={selectedEvent.end_date}
            backgroundBlocks={showGeneralSchedule ? generalScheduleBlocks : []}
            scheduleDayRange={selectedEvent.meta_data?.schedule_day_range}
            scheduleDayBoundary={scheduleDayBoundary}
            onTaskEdit={handleTaskEdit}
            onTaskShiftClick={(task) => {
              setSelectedTasksForLock((prev) =>
                prev.includes(task.id)
                  ? prev.filter((id) => id !== task.id)
                  : [...prev, task.id],
              );
            }}
            onTaskDrop={handleTaskDrop}
            enableTaskRelativeDrop
            selectedTaskIds={selectedTasksForLock}
            onSlotDoubleClick={handleSlotDoubleClick}
            infeasibleTaskIds={infeasibleTaskIds}
            infeasibleTaskErrors={infeasibleTaskErrors}
            persons={persons}
          />
        </div>
      )}

      {/* Template Selector Modal */}
      <TemplateSelectorModal
        isOpen={showTemplateSelector}
        templates={templates}
        taskTypes={taskTypes}
        onSelect={handleTemplateSelect}
        onClose={() => {
          setShowTemplateSelector(false);
          setNewTaskSlotInfo(null);
        }}
      />

      <ExportSelectedTasksModal
        open={showExportModal}
        selectedTasks={selectedTaskInstances}
        sourceDate={selectedDate}
        eventStartDate={selectedEvent.start_date}
        eventEndDate={selectedEvent.end_date}
        dayAliases={selectedEvent.meta_data?.day_aliases}
        isExporting={isExportingTasks}
        onCancel={() => setShowExportModal(false)}
        onExport={handleExportSelectedTasks}
      />

      {/* Task Edit Modal */}
      {editingTask && (
        <TaskEditModal
          task={editingTask}
          isOpen={!!editingTask}
          onClose={() => setEditingTask(null)}
          onSave={handleTaskSave}
          onDelete={handleTaskDelete}
          taskType={taskTypes.find((t) => t.id === editingTask.task_type_id)}
          capabilities={capabilities}
          persons={persons}
          groups={groups}
          locations={locations}
        />
      )}
    </div>
  );
}
