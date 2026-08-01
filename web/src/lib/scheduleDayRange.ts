export type ScheduleDayRange = {
  startHour: number;
  endHour: number;
};

export const DEFAULT_SCHEDULE_DAY_RANGE: ScheduleDayRange = {
  startHour: 6,
  endHour: 24,
};

export const MAX_SCHEDULE_DAY_END_HOUR = 36;

const toInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
};

export function isValidScheduleDayRange(
  range: Partial<ScheduleDayRange> | null | undefined,
): range is ScheduleDayRange {
  const startHour = toInteger(range?.startHour);
  const endHour = toInteger(range?.endHour);
  return (
    startHour !== null &&
    endHour !== null &&
    startHour >= 0 &&
    startHour <= 23 &&
    endHour >= 1 &&
    endHour <= MAX_SCHEDULE_DAY_END_HOUR &&
    endHour > startHour
  );
}

export function normaliseScheduleDayRange(
  value: Partial<ScheduleDayRange> | null | undefined,
): ScheduleDayRange {
  if (!isValidScheduleDayRange(value)) {
    return DEFAULT_SCHEDULE_DAY_RANGE;
  }
  return {
    startHour: Number(value.startHour),
    endHour: Number(value.endHour),
  };
}

export function formatScheduleHourLabel(hour: number): string {
  if (hour === 24) return "24:00";
  if (hour > 24) {
    return `${String(hour - 24).padStart(2, "0")}:00 (next day)`;
  }
  return `${String(hour).padStart(2, "0")}:00`;
}

export function getScheduleDayBoundaryOffsetHour(
  range: Partial<ScheduleDayRange> | null | undefined,
): number {
  return Math.max(0, normaliseScheduleDayRange(range).endHour - 24);
}
