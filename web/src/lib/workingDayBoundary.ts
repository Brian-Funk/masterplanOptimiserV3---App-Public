import {
  getScheduleDayBoundaryOffsetHour,
  type ScheduleDayRange,
} from "@/lib/scheduleDayRange";

export type ScheduleDayBoundary = {
  offsetHour: number;
};

export const DEFAULT_SCHEDULE_DAY_BOUNDARY: ScheduleDayBoundary = {
  offsetHour: 0,
};

const MIN_OFFSET_HOUR = 0;
const MAX_OFFSET_HOUR = 12;
const MINUTES_PER_DAY = 24 * 60;

const toInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
};

export function isValidScheduleDayBoundary(
  value: Partial<ScheduleDayBoundary> | null | undefined,
): value is ScheduleDayBoundary {
  const offsetHour = toInteger(value?.offsetHour);
  return (
    offsetHour !== null &&
    offsetHour >= MIN_OFFSET_HOUR &&
    offsetHour <= MAX_OFFSET_HOUR
  );
}

export function normaliseScheduleDayBoundary(
  value: Partial<ScheduleDayBoundary> | null | undefined,
): ScheduleDayBoundary {
  if (!isValidScheduleDayBoundary(value)) {
    return DEFAULT_SCHEDULE_DAY_BOUNDARY;
  }
  return { offsetHour: Number(value.offsetHour) };
}

export function getScheduleDayBoundaryFromRange(
  range: Partial<ScheduleDayRange> | null | undefined,
): ScheduleDayBoundary {
  return { offsetHour: getScheduleDayBoundaryOffsetHour(range) };
}

export function timeToMinutes(time: string | null | undefined): number | null {
  if (!time || typeof time !== "string") return null;
  const [rawHours, rawMinutes] = time.split(":");
  const hours = Number(rawHours);
  const minutes = Number(rawMinutes);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return hours * 60 + minutes;
}

export function minutesToClockTime(minutes: number): string {
  const normalized = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function minutesToLinearTime(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const mins = absolute % 60;
  return `${sign}${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function parseDateOnly(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function formatDateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const parsed = parseDateOnly(date);
  parsed.setDate(parsed.getDate() + days);
  return formatDateOnly(parsed);
}

export function dateDiffInDays(fromDate: string, toDate: string): number {
  const from = parseDateOnly(fromDate);
  const to = parseDateOnly(toDate);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function getTaskClockStart(task: {
  time?: string;
  start_end_time?: { start?: string | null } | null;
  time_range?: { start?: string | null } | null;
}): string | null {
  return task.start_end_time?.start || task.time || task.time_range?.start || null;
}

export function getWorkingDayForDateTime(
  actualDate: string | null | undefined,
  clockTime: string | null | undefined,
  boundary: Partial<ScheduleDayBoundary> | null | undefined,
): string | null {
  if (!actualDate) return null;
  const { offsetHour } = normaliseScheduleDayBoundary(boundary);
  const minutes = timeToMinutes(clockTime);
  if (offsetHour > 0 && minutes !== null && minutes < offsetHour * 60) {
    return addDays(actualDate, -1);
  }
  return actualDate;
}

export function getActualDateForWorkingSlot(
  workingDate: string,
  clockTime: string,
  boundary: Partial<ScheduleDayBoundary> | null | undefined,
): string {
  const { offsetHour } = normaliseScheduleDayBoundary(boundary);
  const minutes = timeToMinutes(clockTime);
  if (offsetHour > 0 && minutes !== null && minutes < offsetHour * 60) {
    return addDays(workingDate, 1);
  }
  return workingDate;
}

/** Return the latest local datetime accepted for a working day's availability. */
export function getWorkingDayEndDateTimeLimit(
  workingDate: string,
  boundary: Partial<ScheduleDayBoundary> | null | undefined,
): string {
  const { offsetHour } = normaliseScheduleDayBoundary(boundary);
  if (offsetHour === 0) return `${workingDate}T23:59`;
  return `${addDays(workingDate, 1)}T${String(offsetHour).padStart(2, "0")}:00`;
}

export function isTaskInWorkingDay(
  task: {
    date?: string | null;
    time?: string;
    start_end_time?: { start?: string | null } | null;
    time_range?: { start?: string | null } | null;
  },
  workingDate: string,
  boundary: Partial<ScheduleDayBoundary> | null | undefined,
): boolean {
  if (!task.date) return false;
  const start = getTaskClockStart(task);
  const taskWorkingDate = getWorkingDayForDateTime(task.date, start, boundary);
  return taskWorkingDate === workingDate;
}

export function toWorkingDayMinutes(
  actualDate: string | null | undefined,
  clockTime: string,
  selectedWorkingDate: string,
): number | null {
  const minutes = timeToMinutes(clockTime);
  if (minutes === null || !actualDate) return null;
  return minutes + dateDiffInDays(selectedWorkingDate, actualDate) * MINUTES_PER_DAY;
}

export function endToWorkingDayMinutes(
  actualDate: string | null | undefined,
  startClockTime: string,
  endClockTime: string,
  selectedWorkingDate: string,
): number | null {
  const start = toWorkingDayMinutes(actualDate, startClockTime, selectedWorkingDate);
  const endBase = toWorkingDayMinutes(actualDate, endClockTime, selectedWorkingDate);
  if (start === null || endBase === null) return null;
  return endBase <= start ? endBase + MINUTES_PER_DAY : endBase;
}

export function formatWorkingHourLabel(hour: number): string {
  return `${String(((hour % 24) + 24) % 24).padStart(2, "0")}:00`;
}

export function hasOvernightTail(
  boundary: Partial<ScheduleDayBoundary> | null | undefined,
): boolean {
  return normaliseScheduleDayBoundary(boundary).offsetHour > 0;
}

export function lineariseTaskTimesForWorkingDay<T extends {
  date?: string | null;
  field_values?: Record<string, any> | null;
  start_time?: number | string | null;
  end_time?: number | string | null;
}>(
  task: T,
  selectedWorkingDate: string,
  boundary: Partial<ScheduleDayBoundary> | null | undefined,
): T {
  if (!hasOvernightTail(boundary) || !task.date) return task;

  let changed = false;
  const fieldValues = task.field_values
    ? Object.fromEntries(
        Object.entries(task.field_values).map(([fieldId, value]) => {
          if (
            value &&
            typeof value === "object" &&
            typeof value.start === "string" &&
            typeof value.end === "string"
          ) {
            const start = toWorkingDayMinutes(
              task.date,
              value.start,
              selectedWorkingDate,
            );
            const end = endToWorkingDayMinutes(
              task.date,
              value.start,
              value.end,
              selectedWorkingDate,
            );
            if (start !== null && end !== null) {
              changed = true;
              return [
                fieldId,
                {
                  ...value,
                  start: minutesToLinearTime(start),
                  end: minutesToLinearTime(end),
                },
              ];
            }
          }
          return [fieldId, value];
        }),
      )
    : task.field_values;

  const nextTask: T = changed ? { ...task, field_values: fieldValues } : task;

  if (typeof task.start_time === "number" && typeof task.end_time === "number") {
    const start = task.start_time + dateDiffInDays(selectedWorkingDate, task.date) * MINUTES_PER_DAY;
    const end = task.end_time <= task.start_time ? start + (task.end_time + MINUTES_PER_DAY - task.start_time) : task.end_time + dateDiffInDays(selectedWorkingDate, task.date) * MINUTES_PER_DAY;
    return {
      ...nextTask,
      start_time: start,
      end_time: end,
    };
  }

  return nextTask;
}
