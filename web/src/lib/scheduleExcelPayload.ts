import type { CalendarTask } from "@/components/Calendar";
import type { Location, Person } from "@/lib/api";
import type {
  ExcelExportLocation,
  ExcelExportPayload,
  ExcelExportTask,
} from "@/lib/electronDiagnostics";
import {
  endToWorkingDayMinutes,
  toWorkingDayMinutes,
} from "@/lib/workingDayBoundary";

const CONDITION_TYPES = new Set([
  "time_range",
  "duration",
  "capabilities_list",
  "start_end_time",
  "persons_list",
  "location",
  "dynamic_transfer_allocation",
  "transferee",
]);

interface ExcelEventLike {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  meta_data?: { day_aliases?: Record<string, string> } | null;
}

interface ExcelSourceTask {
  id: number;
  description?: string | null;
  additional?: Record<string, unknown> | null;
}

export interface ExcelPayloadDay {
  date: string;
  tasks: CalendarTask[];
}

export interface BuildScheduleExcelPayloadInput {
  title: string;
  event: ExcelEventLike;
  days: ExcelPayloadDay[];
  people: Person[];
  locations: Location[];
  sourceTasks?: ExcelSourceTask[];
  layoutColours?: Record<number, string | null | undefined>;
}

function numericId(value: unknown): number | null {
  const candidate = value && typeof value === "object" && "value" in value
    ? (value as { value?: unknown }).value
    : value;
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function clockMinutes(value: string | undefined): number | null {
  if (!value || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    return null;
  }
  const total = hours * 60 + minutes;
  return total >= 0 && total <= 2879 ? total : null;
}

function workingDayTimes(task: CalendarTask, workingDate: string): {
  startMinutes: number | null;
  endMinutes: number | null;
} {
  const startClock = task.start_end_time?.start;
  const endClock = task.start_end_time?.end;
  if (!startClock || !endClock) {
    return {
      startMinutes: clockMinutes(startClock),
      endMinutes: clockMinutes(endClock),
    };
  }
  const linearStart = toWorkingDayMinutes(task.date, startClock, workingDate);
  const linearEnd = endToWorkingDayMinutes(task.date, startClock, endClock, workingDate);
  if (linearStart !== null && linearEnd !== null) {
    return { startMinutes: linearStart, endMinutes: linearEnd };
  }
  const startMinutes = clockMinutes(startClock);
  let endMinutes = clockMinutes(endClock);
  if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
    endMinutes += 24 * 60;
  }
  return { startMinutes, endMinutes };
}

function hasValue(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.some(hasValue);
  return true;
}

function formatValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    for (const key of ["label", "name", "value", "url"]) {
      if (hasValue(item[key])) return formatValue(item[key]);
    }
    try {
      return JSON.stringify(item);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function titleCase(value: string): string {
  return value
    .replace(/^field_/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildAdditionalInfo(task: CalendarTask, source?: ExcelSourceTask): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  const add = (label: string, value: unknown) => {
    if (!hasValue(value)) return;
    const rendered = formatValue(value);
    if (!rendered) return;
    const line = label ? `${label}: ${rendered}` : rendered;
    if (!seen.has(line)) {
      seen.add(line);
      lines.push(line);
    }
  };

  add("Description", source?.description);
  add("Notes", source?.additional?.notes);
  add("Description", source?.additional?.description);

  for (const field of task.field_definitions || []) {
    const definition = field as typeof field & { category?: string; label?: string };
    const isArbitrary = definition.category === "arbitrary" ||
      (definition.category !== "conditions" && !CONDITION_TYPES.has(definition.type));
    if (!isArbitrary) continue;
    add(
      definition.name || definition.label || titleCase(definition.id),
      task.fields?.[definition.id] ?? source?.additional?.[definition.id],
    );
  }
  return lines.join("\n");
}

function locationValue(location?: Location): ExcelExportLocation | null {
  if (!location?.name) return null;
  return { name: location.name, address: location.address || "" };
}

function buildVenue(task: CalendarTask, locations: Location[]): {
  venue: ExcelExportLocation | null;
  routeStart: ExcelExportLocation | null;
  routeEnd: ExcelExportLocation | null;
} {
  const locationFields = (task.field_definitions || []).filter((field) => field.type === "location");
  if (locationFields.length >= 2) {
    const startId = numericId(task.fields?.[locationFields[0].id]);
    const endId = numericId(task.fields?.[locationFields[1].id]);
    const routeStart = locationValue(locations.find((location) => location.id === startId));
    const routeEnd = locationValue(locations.find((location) => location.id === endId));
    if (routeStart && routeEnd) return { venue: null, routeStart, routeEnd };
  }
  const resolved = locations.find((location) => location.id === Number(task.location_id));
  return {
    venue: locationValue(resolved) || (task.location_name ? { name: task.location_name, address: "" } : null),
    routeStart: null,
    routeEnd: null,
  };
}

function collectAssignedPersonIds(task: CalendarTask): number[] {
  const ids = new Set<number>();
  for (const value of task.assigned_persons || []) {
    const id = numericId(value);
    if (id) ids.add(id);
  }
  for (const values of Object.values(task.field_assignments || {})) {
    for (const value of values || []) {
      const id = numericId(value);
      if (id) ids.add(id);
    }
  }
  return [...ids].sort((left, right) => left - right);
}

function displayPeople(people: Person[]): Array<{ id: number; displayName: string }> {
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  const sorted = [...people].sort((left, right) =>
    collator.compare(left.last_name || "", right.last_name || "") ||
    collator.compare(left.first_name || "", right.first_name || "") ||
    left.id - right.id,
  );
  const baseNames = sorted.map((person) =>
    `${person.first_name || ""} ${person.last_name || ""}`.trim() || `Person ${person.id}`,
  );
  const counts = new Map<string, number>();
  baseNames.forEach((name) => counts.set(name.toLocaleLowerCase(), (counts.get(name.toLocaleLowerCase()) || 0) + 1));
  const positions = new Map<string, number>();
  return sorted.map((person, index) => {
    const base = baseNames[index];
    const key = base.toLocaleLowerCase();
    const position = (positions.get(key) || 0) + 1;
    positions.set(key, position);
    return {
      id: person.id,
      displayName: (counts.get(key) || 0) > 1 ? `${base} (${position})` : base,
    };
  });
}

function dayNumber(startDate: string, date: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const current = Date.parse(`${date}T00:00:00Z`);
  return Math.floor((current - start) / 86_400_000) + 1;
}

export function buildScheduleExcelPayload(input: BuildScheduleExcelPayloadInput): ExcelExportPayload {
  const sourceById = new Map((input.sourceTasks || []).map((task) => [task.id, task]));
  const days = [...input.days]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((day) => ({
      date: day.date,
      alias: input.event.meta_data?.day_aliases?.[day.date] || "Schedule",
      dayNumber: dayNumber(input.event.start_date, day.date),
      tasks: [...day.tasks]
        .map((task): ExcelExportTask => {
          const times = workingDayTimes(task, day.date);
          return {
            id: task.id,
            title: task.name,
            startMinutes: times.startMinutes,
            endMinutes: times.endMinutes,
            colour: input.layoutColours?.[task.id] || task.task_type_color || "#3b82f6",
            assignedSummary: task.resource_info || "",
            additionalInfo: buildAdditionalInfo(task, sourceById.get(task.id)),
            assignedPersonIds: collectAssignedPersonIds(task),
            ...buildVenue(task, input.locations),
          };
        })
        .sort((left, right) =>
          (left.startMinutes ?? Number.MAX_SAFE_INTEGER) - (right.startMinutes ?? Number.MAX_SAFE_INTEGER) ||
          (left.endMinutes ?? Number.MAX_SAFE_INTEGER) - (right.endMinutes ?? Number.MAX_SAFE_INTEGER) ||
          left.id - right.id,
        ),
    }));

  return {
    title: input.title,
    eventId: input.event.id,
    eventName: input.event.name,
    eventStartDate: input.event.start_date,
    eventEndDate: input.event.end_date,
    people: displayPeople(input.people),
    days,
  };
}
