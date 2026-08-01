/**
 * Shared task transformation utility.
 * Converts BackendTask[] + related data -> CalendarTask[] for the Calendar component.
 *
 * Used by both the admin ScheduleTab and the organiser/viewer pages.
 */
import type { CalendarTask } from "@/components/Calendar";
import type { Group } from "@/lib/api";
import {
  mergeRuntimeGroupFieldDisplay,
  resolveRuntimeGroupAssignmentsForFields,
} from "@/lib/groupMembers";
import type { BackendTask, MasterplanLayout } from "@/types/masterplan";

interface TaskType {
  id: number;
  name: string;
  color?: string;
}

interface PersonLike {
  id: number;
  first_name: string;
  last_name: string;
  capabilities?: string[];
  unavailabilities?: Array<{ starts_at: string; ends_at: string }>;
}

interface LocationLike {
  id: number;
  name: string;
}

interface TemplateLike {
  id: number;
  fields?: any[];
}

/**
 * Convert minutes-from-midnight to "HH:MM" string.
 */
export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/**
 * Transform an array of backend tasks into CalendarTasks.
 */
export function transformBackendTasks(opts: {
  tasks: BackendTask[];
  taskTypes: TaskType[];
  persons: PersonLike[];
  locations: LocationLike[];
  templates: TemplateLike[];
  layouts: MasterplanLayout[];
  groups?: Group[];
  fallbackDate: string;
  workingDayBoundaryOffsetHour?: number;
}): CalendarTask[] {
  const {
    tasks,
    taskTypes,
    persons,
    locations,
    templates,
    layouts,
    groups = [],
    fallbackDate,
    workingDayBoundaryOffsetHour = 0,
  } = opts;

  return tasks.map((task) => {
    const template = templates.find((t) => t.id === task.task_template_id);
    const taskType = taskTypes.find((t) => t.id === task.task_type_id);
    const layout = layouts.find((l) => l.task_id === task.id);

    const schedule = task.final || task.optimised || {};
    const taskDate = task.additional?.date || fallbackDate;

    // Person assignments
    const assignedPersonIds: number[] = schedule.assigned_persons || [];
    const rawFieldAssignments: Record<string, number[]> | null =
      schedule.field_assignments || null;
    const runtimeGroupDisplay = resolveRuntimeGroupAssignmentsForFields({
      fields: template?.fields || [],
      fieldValues: task.constraints?.field_values || {},
      groups,
      persons: persons.map((person) => ({
        id: person.id,
        unavailabilities: person.unavailabilities || [],
      })),
      taskDate,
      selectedWorkingDate: fallbackDate,
      workingDayBoundaryOffsetHour,
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
      for (const [fieldId, personIds] of Object.entries(fieldAssignments)) {
        const fieldDef = template.fields.find((f: any) => f.id === fieldId);
        const fieldLabel =
          fieldDef?.name || fieldId.replace(/^field_/, "").replace(/_/g, " ");
        const names = (personIds as number[])
          .map((pid) => persons.find((p) => p.id === pid))
          .filter(Boolean)
          .map((p: any) => `${p.first_name} ${p.last_name}`);
        if (names.length > 0) {
          fieldParts.push(`${fieldLabel}: ${names.join(", ")}`);
        }
      }
      formattedPersons = fieldParts.join(" | ");
    } else {
      formattedPersons = assignedPersonIds
        .map((pid) => persons.find((p) => p.id === pid))
        .filter(Boolean)
        .map((p: any) => `${p.first_name} ${p.last_name}`)
        .join(", ");
    }

    // Location name
    const locationData = schedule.location
      ? locations.find((l) => l.id === schedule.location)
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
        const startLoc = locations.find((l) => l.id === startLocId);
        const endLoc = locations.find((l) => l.id === endLocId);
        if (startLoc && endLoc) {
          locationName = `${startLoc.name} \u2192 ${endLoc.name}`;
        }
      }
    }

    return {
      id: task.id,
      name: task.title,
      task_type_id: task.task_type_id,
      task_type_name: taskType?.name || "",
      task_type_color: layout?.custom_color || taskType?.color || "#3b82f6",
      location_id: schedule.location,
      location_name: locationName,
      resource_info: formattedPersons,
      date: taskDate,
      start_end_time:
        schedule.start_time !== undefined && schedule.end_time !== undefined
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
      _layout: layout || null,
      _backendTaskId: task.id,
      _visual_x_offset: layout?.visual_x_offset ?? 0,
      _visual_width: layout?.visual_width ?? null,
    } as CalendarTask & {
      _layout: MasterplanLayout | null;
      _backendTaskId: number;
    };
  });
}
