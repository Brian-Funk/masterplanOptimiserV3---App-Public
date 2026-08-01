import type { TaskInstance, TaskInstanceCreate } from "@/lib/api";
import { addDays, dateDiffInDays } from "@/lib/workingDayBoundary";

const GENERATED_ADDITIONAL_KEYS = new Set([
  "calendar_event_id",
  "calendarEventId",
  "conflict",
  "conflicts",
  "external_calendar_id",
  "final",
  "google_calendar_event_id",
  "googleCalendarEventId",
  "manual_edit",
  "manual_edit_state",
  "manualEdit",
  "mp_backend_id",
  "mpBackendId",
  "optimised",
  "optimized",
  "publish",
  "published",
  "published_at",
  "publishedAt",
]);

function cloneJson<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function copyAdditional(
  additional: TaskInstance["additional"],
): TaskInstanceCreate["additional"] {
  if (!additional) return additional ?? null;
  const cloned = cloneJson(additional);
  return Object.fromEntries(
    Object.entries(cloned).filter(
      ([key]) => !GENERATED_ADDITIONAL_KEYS.has(key),
    ),
  );
}

export function buildTaskExportPayload(
  sourceTask: TaskInstance,
  sourceWorkingDate: string,
  targetWorkingDate: string,
  eventStartDate: string,
): TaskInstanceCreate {
  const actualDateOffset = dateDiffInDays(
    sourceWorkingDate,
    sourceTask.date,
  );
  const targetActualDate = addDays(targetWorkingDate, actualDateOffset);
  const targetDayIndex = dateDiffInDays(eventStartDate, targetWorkingDate);

  return {
    event_id: sourceTask.event_id,
    template_id: sourceTask.template_id ?? null,
    name: sourceTask.name,
    task_type_id: sourceTask.task_type_id ?? null,
    date: targetActualDate,
    day_index: targetDayIndex,
    is_floating: sourceTask.is_floating,
    is_transfer: sourceTask.is_transfer,
    field_values: sourceTask.field_values
      ? cloneJson(sourceTask.field_values)
      : sourceTask.field_values ?? null,
    constraints: sourceTask.constraints
      ? cloneJson(sourceTask.constraints)
      : sourceTask.constraints ?? null,
    additional: copyAdditional(sourceTask.additional),
  };
}

export function buildTaskExportPayloads(
  sourceTasks: TaskInstance[],
  sourceWorkingDate: string,
  targetWorkingDates: string[],
  eventStartDate: string,
): TaskInstanceCreate[] {
  return targetWorkingDates.flatMap((targetWorkingDate) =>
    sourceTasks.map((sourceTask) =>
      buildTaskExportPayload(
        sourceTask,
        sourceWorkingDate,
        targetWorkingDate,
        eventStartDate,
      ),
    ),
  );
}
