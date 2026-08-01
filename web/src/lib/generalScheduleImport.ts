import type {
  AudienceTeam,
  Location,
  ScheduleView,
  SessionElement,
  SessionElementType,
} from "@/lib/api";
import {
  getActualDateForWorkingSlot,
  timeToMinutes,
  type ScheduleDayBoundary,
} from "@/lib/workingDayBoundary";

export const GENERAL_SCHEDULE_IMPORT_HEADER =
  "Working day\tStart\tEnd\tTitle\tType\tLocation\tPublic views\tAudiences\tDescription";

export type ScheduleImportPayload = Omit<
  Partial<SessionElement>,
  "id" | "event_id"
> & {
  title: string;
  date: string;
  start_time: string;
  end_time: string;
};

export type ScheduleImportRow = {
  line: number;
  values: string[];
  payload: ScheduleImportPayload | null;
  errors: string[];
  duplicate: boolean;
};

export type ScheduleImportResult = {
  rows: ScheduleImportRow[];
  headerErrors: string[];
};

type ScheduleImportReferences = {
  eventStart: string;
  eventEnd: string;
  boundary: ScheduleDayBoundary;
  types: SessionElementType[];
  locations: Location[];
  views: ScheduleView[];
  teams: AudienceTeam[];
  existing: SessionElement[];
};

const REQUIRED_HEADERS = ["working day", "start", "end", "title", "type"];
const SUPPORTED_HEADERS = [
  ...REQUIRED_HEADERS,
  "location",
  "public views",
  "audiences",
  "description",
];

const normalise = (value: string): string => value.trim().toLocaleLowerCase();

const findByName = <T extends { name: string }>(rows: T[], value: string): T | null => {
  const wanted = normalise(value);
  return rows.find((row) => normalise(row.name) === wanted) || null;
};

const resolveNames = <T extends { id: number; name: string }>(
  value: string,
  rows: T[],
  label: string,
  errors: string[],
): number[] => {
  if (!value.trim()) return [];
  const result: number[] = [];
  for (const name of value.split(";").map((part) => part.trim()).filter(Boolean)) {
    const match = findByName(rows, name);
    if (!match) {
      errors.push(`${label} "${name}" was not found in this event.`);
    } else if (!result.includes(match.id)) {
      result.push(match.id);
    }
  }
  return result;
};

const duplicateKey = (
  date: string,
  start: string,
  end: string,
  title: string,
): string => `${date}|${start}|${end}|${normalise(title)}`;

/** Parse fixed-column tab-separated schedule rows and resolve event references. */
export function parseGeneralScheduleSpreadsheet(
  source: string,
  references: ScheduleImportReferences,
): ScheduleImportResult {
  const lines = source.replace(/\r/g, "").split("\n").filter((line) => line.trim());
  if (lines.length === 0) return { rows: [], headerErrors: [] };

  const headers = lines[0].split("\t").map(normalise);
  const headerErrors = REQUIRED_HEADERS
    .filter((header) => !headers.includes(header))
    .map((header) => `Missing required column: ${header}.`);
  const unsupported = headers.filter((header) => header && !SUPPORTED_HEADERS.includes(header));
  if (unsupported.length > 0) {
    headerErrors.push(`Unsupported column(s): ${unsupported.join(", ")}.`);
  }
  if (headerErrors.length > 0) return { rows: [], headerErrors };

  const indexes = Object.fromEntries(headers.map((header, index) => [header, index]));
  const valueAt = (values: string[], name: string): string =>
    values[indexes[name]]?.trim() || "";
  const existingKeys = new Set(
    references.existing.map((element) =>
      duplicateKey(
        element.date,
        element.start_time,
        element.end_time,
        element.title,
      ),
    ),
  );
  const importKeys = new Set<string>();

  const rows = lines.slice(1).map((line, index): ScheduleImportRow => {
    const values = line.split("\t");
    const errors: string[] = [];
    const workingDay = valueAt(values, "working day");
    const start = valueAt(values, "start");
    const end = valueAt(values, "end");
    const title = valueAt(values, "title");
    const typeName = valueAt(values, "type");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(workingDay)) {
      errors.push("Working day must use YYYY-MM-DD.");
    } else if (workingDay < references.eventStart || workingDay > references.eventEnd) {
      errors.push("Working day is outside the selected event.");
    }
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);
    if (startMinutes === null) errors.push("Start must use HH:MM.");
    if (endMinutes === null) errors.push("End must use HH:MM.");
    if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
      errors.push("End must be after start.");
    }
    if (!title) errors.push("Title is required.");
    const type = findByName(references.types, typeName);
    if (!type) errors.push(`Type "${typeName || "(blank)"}" was not found in this event.`);

    const locationName = valueAt(values, "location");
    const location = locationName ? findByName(references.locations, locationName) : null;
    if (locationName && !location) {
      errors.push(`Location "${locationName}" was not found in this event.`);
    }
    const scheduleViewIds = resolveNames(
      valueAt(values, "public views"),
      references.views,
      "Public view",
      errors,
    );
    const attendeeTeamIds = resolveNames(
      valueAt(values, "audiences"),
      references.teams,
      "Audience",
      errors,
    );
    const actualDate = /^\d{4}-\d{2}-\d{2}$/.test(workingDay) && startMinutes !== null
      ? getActualDateForWorkingSlot(workingDay, start, references.boundary)
      : workingDay;
    const key = duplicateKey(actualDate, start, end, title);
    const duplicate = existingKeys.has(key) || importKeys.has(key);
    importKeys.add(key);

    return {
      line: index + 2,
      values,
      errors,
      duplicate,
      payload: errors.length === 0 && type
        ? {
            title,
            date: actualDate,
            start_time: start,
            end_time: end,
            session_element_type_id: type.id,
            location_id: location?.id || null,
            schedule_view_ids: scheduleViewIds,
            attendee_team_ids: attendeeTeamIds,
            visibility: "public",
            description: valueAt(values, "description") || null,
          }
        : null,
    };
  });

  return { rows, headerErrors };
}
