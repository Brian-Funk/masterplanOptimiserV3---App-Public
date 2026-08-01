/**
 * Date formatting helpers - Swiss DD.MM.YYYY format.
 */

/** Format a date-only string (YYYY-MM-DD or ISO) as DD.MM.YYYY. */
export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear());
  return `${day}.${month}.${year}`;
}

/** Format a date with weekday prefix, e.g. "Wed, 01.04.2026". */
export function formatDateWithWeekday(dateStr: string): string {
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
  const weekday = d.toLocaleDateString("en-GB", { weekday: "short" });
  return `${weekday}, ${formatDateShort(dateStr)}`;
}

/** Format a date with long weekday, e.g. "Wednesday, 01.04.2026". */
export function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
  return `${weekday}, ${formatDateShort(dateStr)}`;
}

function parseLocalDateTimeParts(dateStr: string): {
  year: string;
  month: string;
  day: string;
  hours: string;
  minutes: string;
} | null {
  const match = dateStr.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})/,
  );
  if (!match) return null;
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return {
    year: match[1],
    month: match[2],
    day: match[3],
    hours: String(hours).padStart(2, "0"),
    minutes: match[5],
  };
}

/** Format an event-local datetime without applying a browser timezone conversion. */
export function formatLocalDateTime(dateStr: string): string {
  const local = parseLocalDateTimeParts(dateStr);
  if (local) {
    return `${local.day}.${local.month}.${local.year} ${local.hours}:${local.minutes}`;
  }
  return formatDateTime(dateStr);
}

/** Format a full datetime as DD.MM.YYYY HH:MM. */
export function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear());
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

/** Format a date range while preserving the Swiss date style. */
export function formatDateRange(
  startDate?: string | null,
  endDate?: string | null,
): string {
  if (!startDate && !endDate) return "";
  if (startDate && endDate && startDate !== endDate) {
    return `${formatDateShort(startDate)} - ${formatDateShort(endDate)}`;
  }
  return formatDateShort(startDate || endDate || "");
}
