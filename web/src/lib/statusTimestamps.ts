export type StatusTimestampInput = string | number | Date | null | undefined;

/** Parse a timestamp value into a valid Date, or null when no reliable value exists. */
export function parseStatusTimestamp(value: StatusTimestampInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const normalisedValue =
    typeof value === "string" && isIsoDateTimeWithoutZone(value)
      ? `${value}Z`
      : value;
  const date =
    normalisedValue instanceof Date
      ? new Date(normalisedValue.getTime())
      : new Date(normalisedValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format a status timestamp as a compact local phrase for confidence messages. */
export function formatStatusTimestamp(
  value: StatusTimestampInput,
  options: { now?: Date } = {},
): string | null {
  const date = parseStatusTimestamp(value);
  if (!date) return null;

  const now = options.now ?? new Date();
  const timeText = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  if (isSameLocalDay(date, now)) {
    return `today at ${timeText}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) {
    return `yesterday at ${timeText}`;
  }

  const dateText = `${String(date.getDate()).padStart(2, "0")}.${String(
    date.getMonth() + 1,
  ).padStart(2, "0")}.${date.getFullYear()}`;
  return `${dateText} at ${timeText}`;
}

/** Return the newest reliable timestamp from a collection. */
export function latestStatusTimestamp(
  values: StatusTimestampInput[],
): string | null {
  const latest = values
    .map(parseStatusTimestamp)
    .filter((date): date is Date => date !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return latest ? latest.toISOString() : null;
}

/** Compare two timestamp values, treating missing or invalid values as older. */
export function compareStatusTimestamps(
  left: StatusTimestampInput,
  right: StatusTimestampInput,
): number {
  const leftTime = parseStatusTimestamp(left)?.getTime() ?? 0;
  const rightTime = parseStatusTimestamp(right)?.getTime() ?? 0;
  return leftTime - rightTime;
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isIsoDateTimeWithoutZone(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/.test(
    value,
  );
}
