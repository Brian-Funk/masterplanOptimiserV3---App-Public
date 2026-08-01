/**
 * Shared utility for converting TaskInstances to CalendarTasks.
 * Used by OptimisedTab and the Presentation view.
 */

import type { CalendarTask } from "@/components/Calendar";
import type { Group, Person, Location, TaskType, TaskTemplate } from "@/lib/api";
import {
  mergeRuntimeGroupFieldDisplay,
  resolveRuntimeGroupAssignmentsForFields,
} from "@/lib/groupMembers";

/** Convert minutes-since-midnight to HH:MM string */
export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/** Convert HH:MM string to minutes-since-midnight */
export function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Convert a raw TaskInstance (with optimised/final schedule) into a CalendarTask
 * suitable for the Calendar component.
 *
 * @param workingDayBoundaryOffsetHour Hours after midnight belonging to the previous working day.
 */
export function toCalendarTask(
  instance: any,
  templates: TaskTemplate[],
  taskTypes: TaskType[],
  persons: Person[],
  locations: Location[],
  groups: Group[] = [],
  workingDayBoundaryOffsetHour = 0,
): CalendarTask {
  const template = templates.find((t) => t.id === instance.template_id);
  const taskType = taskTypes.find((t) => t.id === instance.task_type_id);

  // Display logic per OPTIMISATION_STRUCTURE.md:
  // - Always use task.final (current schedule state)
  // - After optimisation: final = optimised (both have same data)
  // - After user edit: final = user changes, optimised = original
  const schedule = instance.final || instance.optimised || {};

  // Get assigned persons from optimisation result
  const assignedPersonIds: number[] = schedule.assigned_persons || [];
  const assignedPersonsData = assignedPersonIds
    .map((personId: number) => persons.find((p) => p.id === personId))
    .filter(Boolean);

  // Get per-field assignments if available
  const rawFieldAssignments = schedule.field_assignments || null;
  const runtimeGroupDisplay = resolveRuntimeGroupAssignmentsForFields({
    fields: template?.fields || [],
    fieldValues: instance.field_values || {},
    groups,
    persons,
    taskDate: instance.date,
    workingDayBoundaryOffsetHour,
    taskStart: schedule.start_time,
    taskEnd: schedule.end_time,
  });
  const {
    fieldAssignments,
    fieldAssignmentExclusions,
  } = mergeRuntimeGroupFieldDisplay(rawFieldAssignments, runtimeGroupDisplay);

  // Format persons - show per-field breakdown if field_assignments exist
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
        .map((pid: number) => persons.find((p) => p.id === pid))
        .filter(Boolean)
        .map((p: any) => `${p.first_name} ${p.last_name}`);
      if (names.length > 0) {
        fieldParts.push(`${fieldLabel}: ${names.join(", ")}`);
      }
    }
    formattedPersons = fieldParts.join(" | ");
  } else {
    formattedPersons = assignedPersonsData
      .map((p: any) => `${p.first_name} ${p.last_name}`)
      .join(", ");
  }

  // Get location name
  const locationData = schedule.location
    ? locations.find((l) => l.id === schedule.location)
    : null;

  // For transfer tasks with multiple location fields, show start → end
  let locationName = locationData?.name || "";
  if (template?.fields) {
    const locationFields = template.fields.filter(
      (f: any) => f.type === "location",
    );
    if (locationFields.length >= 2 && instance.field_values) {
      const startLocFieldValue = instance.field_values[locationFields[0].id];
      const endLocFieldValue = instance.field_values[locationFields[1].id];

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
        locationName = `${startLoc.name} → ${endLoc.name}`;
      }
    }
  }

  return {
    id: instance.id,
    name: instance.name || template?.name || "Unnamed Task",
    task_type_id: instance.task_type_id,
    task_type_name: taskType?.name || "",
    task_type_color: taskType?.color || "#3b82f6",
    location_id: schedule.location,
    location_name: locationName,
    resource_info: formattedPersons,
    date: instance.date,
    start_end_time:
      schedule.start_time !== undefined && schedule.end_time !== undefined
        ? {
            start: minutesToTime(schedule.start_time),
            end: minutesToTime(schedule.end_time),
          }
        : undefined,
    fields: instance.field_values || {},
    field_definitions: template?.fields || [],
    // Additional fields for edit modal
    startTime: schedule.start_time || "",
    endTime: schedule.end_time || "",
    location: schedule.location?.toString() || "",
    color: taskType?.color || "#3b82f6",
    taskTypeId: instance.task_type_id,
    taskType: taskType?.name || "",
    templateId: instance.template_id,
    optimised: instance.optimised || {},
    final: instance.final || {},
    assigned_persons: schedule.assigned_persons || [],
    field_assignments: fieldAssignments || undefined,
    field_assignment_exclusions: fieldAssignmentExclusions,
  } as CalendarTask;
}

/**
 * Convert an array of TaskInstances (filtered for an event) to CalendarTasks.
 *
 * @param workingDayBoundaryOffsetHour Hours after midnight belonging to the previous working day.
 */
export function instancesToCalendarTasks(
  instances: any[],
  eventId: number,
  templates: TaskTemplate[],
  taskTypes: TaskType[],
  persons: Person[],
  locations: Location[],
  groups: Group[] = [],
  workingDayBoundaryOffsetHour = 0,
): CalendarTask[] {
  const optimised = instances.filter(
    (inst) => inst.event_id === eventId && (inst.optimised || inst.final),
  );
  return optimised.map((inst) =>
    toCalendarTask(
      inst,
      templates,
      taskTypes,
      persons,
      locations,
      groups,
      workingDayBoundaryOffsetHour,
    ),
  );
}
