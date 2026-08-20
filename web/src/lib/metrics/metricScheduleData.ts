import {
  Capability,
  Person,
  TaskInstance as ApiTaskInstance,
  TaskTemplate,
  TaskType,
} from "@/lib/api";
import {
  ScheduleData,
  TaskInstance,
  TaskTypeInfo,
  Person as MetricPerson,
  Capability as MetricCapability,
} from "./MetricInterface";
import {
  getWorkingDayForDateTime,
  type ScheduleDayBoundary,
} from "@/lib/workingDayBoundary";

type FieldTypeMap = Map<string, string>;
type MetricScheduleSource = "final" | "optimised" | "raw";

export interface MetricScheduleDiagnostics {
  includedTasks: number;
  skippedMissingTimes: number;
  skippedInvalidDuration: number;
  unassignedTimedTasks: number;
  missingPersonReferences: number;
}

export interface MetricBuildResult {
  data: ScheduleData;
  diagnostics: MetricScheduleDiagnostics;
}

export interface MaxHoursViolation {
  personId: number;
  personName: string;
  date: string;
  hours: number;
  maxHours: number;
}

export interface MetricTaskBreakdown {
  taskId: string;
  taskName: string;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  source: MetricScheduleSource;
  assignmentSource: string[];
}

export interface MaxHoursViolationBreakdown extends MaxHoursViolation {
  tasks: MetricTaskBreakdown[];
}

function uniqueNumbers(values: unknown[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const value of values) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    const id = Math.trunc(numeric);
    if (id <= 0 || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function dedupeMetricIds(ids: readonly number[] | undefined): number[] {
  return uniqueNumbers(Array.isArray(ids) ? [...ids] : []);
}

/** Return true unless a task is explicitly excluded from working-time accounting. */
export function countsTowardsWorkTime(task: TaskInstance): boolean {
  return task.counts_towards_work_time !== false;
}

/**
 * Return the people whose assignment role consumes working time. Older saved
 * optimisation results do not carry role-level information, so they retain
 * the historical all-riders-counted behaviour.
 */
export function workingPersonIds(task: TaskInstance): number[] {
  return dedupeMetricIds(task.working_person_ids ?? task.person_ids);
}

export function personCountsTowardsWorkTime(
  task: TaskInstance,
  personId: number,
): boolean {
  return (
    countsTowardsWorkTime(task) && workingPersonIds(task).includes(personId)
  );
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
}

export function parseMetricTimeToMinutes(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const timePart = trimmed.includes("T")
    ? trimmed.split("T")[1]?.slice(0, 5)
    : trimmed.slice(0, 5);
  const match = /^(\d{1,2}):(\d{2})$/.exec(timePart || "");
  if (match) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || minutes < 0 || minutes > 59) return null;
    if (hours === 24 && minutes === 0) return 1440;
    if (hours > 24) return null;
    return hours * 60 + minutes;
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function minutesToISO(date: string, minutes: number): string {
  const dayOffset = Math.floor(minutes / 1440);
  const minuteOfDay = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(minuteOfDay / 60);
  const mins = minuteOfDay % 60;
  return `${addDays(date, dayOffset)}T${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`;
}

function makeInterval(
  date: string,
  startValue: unknown,
  endValue: unknown,
): { start_time: string; end_time: string } | null {
  const start = parseMetricTimeToMinutes(startValue);
  let end = parseMetricTimeToMinutes(endValue);
  if (start === null || end === null) return null;
  if (end <= start) end += 1440;
  if (end <= start) return null;
  return {
    start_time: minutesToISO(date, start),
    end_time: minutesToISO(date, end),
  };
}

function getScheduleBlockInfo(
  task: ApiTaskInstance,
): { source: MetricScheduleSource; schedule: Record<string, unknown> } | null {
  const final = task.final || null;
  if (final && Object.keys(final).length > 0) {
    return { source: "final", schedule: final };
  }
  const optimised = task.optimised || null;
  if (optimised && Object.keys(optimised).length > 0) {
    return { source: "optimised", schedule: optimised };
  }
  return null;
}

function getScheduleBlock(task: ApiTaskInstance): Record<string, unknown> | null {
  return getScheduleBlockInfo(task)?.schedule || null;
}

function buildTemplateFieldMap(templates: TaskTemplate[]): Map<number, FieldTypeMap> {
  const map = new Map<number, FieldTypeMap>();
  for (const template of templates) {
    const fields = [
      ...((template.fields as any[]) || []),
      ...((template.custom_fields as any[]) || []),
    ];
    const fieldMap: FieldTypeMap = new Map();
    for (const field of fields) {
      if (!field || typeof field !== "object") continue;
      const id = String((field as any).id || "");
      const type = String((field as any).type || "");
      if (id && type) fieldMap.set(id, type);
    }
    map.set(template.id, fieldMap);
  }
  return map;
}

function extractTypedPersonEntries(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids: unknown[] = [];
  for (const item of value) {
    if (typeof item === "number" || typeof item === "string") {
      ids.push(item);
    } else if (
      item &&
      typeof item === "object" &&
      (item as any).type === "person"
    ) {
      ids.push((item as any).id);
    }
  }
  return uniqueNumbers(ids);
}

function extractCapabilityEntries(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids: unknown[] = [];
  for (const item of value) {
    if (typeof item === "number" || typeof item === "string") {
      ids.push(item);
    } else if (item && typeof item === "object" && (item as any).id != null) {
      ids.push((item as any).id);
    }
  }
  return uniqueNumbers(ids);
}

export function extractMetricTaskTimes(
  task: ApiTaskInstance,
): { start_time: string; end_time: string } | null {
  const date = task.date || "";
  if (!date) return null;

  const schedule = getScheduleBlock(task);
  if (schedule) {
    const interval = makeInterval(
      date,
      schedule.start_time ?? schedule.start,
      schedule.end_time ?? schedule.end,
    );
    if (interval) return interval;
  }

  const fields = task.field_values || {};
  for (const value of Object.values(fields)) {
    if (
      value &&
      typeof value === "object" &&
      "start" in (value as Record<string, unknown>) &&
      "end" in (value as Record<string, unknown>)
    ) {
      const interval = makeInterval(
        date,
        (value as any).start,
        (value as any).end,
      );
      if (interval) return interval;
    }
  }

  const directInterval = makeInterval(
    date,
    (task as any).start_time,
    (task as any).end_time,
  );
  if (directInterval) return directInterval;

  return null;
}

export function extractMetricPersonIds(
  task: ApiTaskInstance,
  fieldTypes?: FieldTypeMap,
): number[] {
  return extractMetricPersonAssignments(task, fieldTypes).ids;
}

function addAssignmentSource(
  sources: Map<number, Set<string>>,
  personIds: number[],
  source: string,
) {
  for (const personId of personIds) {
    if (!sources.has(personId)) sources.set(personId, new Set());
    sources.get(personId)!.add(source);
  }
}

export function extractMetricPersonAssignments(
  task: ApiTaskInstance,
  fieldTypes?: FieldTypeMap,
): {
  ids: number[];
  workingIds: number[];
  sources: Record<number, string[]>;
} {
  const schedule = getScheduleBlock(task);
  if (schedule) {
    const ids: number[] = [];
    const workingIds: number[] = [];
    const sourceMap = new Map<number, Set<string>>();
    if (Array.isArray(schedule.assigned_persons)) {
      const assignedIds = uniqueNumbers(schedule.assigned_persons);
      ids.push(...assignedIds);
      addAssignmentSource(sourceMap, assignedIds, "assigned_persons");
    }
    const fieldAssignments = schedule.field_assignments;
    let hasRoleAssignments = false;
    if (fieldAssignments && typeof fieldAssignments === "object") {
      for (const [fieldId, value] of Object.entries(
        fieldAssignments as Record<string, unknown>,
      )) {
        if (Array.isArray(value)) {
          hasRoleAssignments = true;
          const fieldIds = uniqueNumbers(value);
          ids.push(...fieldIds);
          addAssignmentSource(sourceMap, fieldIds, `field:${fieldId}`);
          const fieldType = fieldTypes?.get(fieldId);
          if (fieldType !== "transferee" && fieldId !== "_transferee") {
            workingIds.push(...fieldIds);
          }
        }
      }
    }
    const assignedIds = uniqueNumbers(ids);
    return {
      ids: assignedIds,
      workingIds:
        task.is_transfer && hasRoleAssignments
          ? uniqueNumbers(workingIds)
          : assignedIds,
      sources: Object.fromEntries(
        Array.from(sourceMap.entries()).map(([personId, values]) => [
          personId,
          Array.from(values),
        ]),
      ),
    };
  }

  const ids: number[] = [];
  const sourceMap = new Map<number, Set<string>>();
  if (Array.isArray((task as any).person_ids)) {
    const directIds = uniqueNumbers((task as any).person_ids);
    ids.push(...directIds);
    addAssignmentSource(sourceMap, directIds, "person_ids");
  }
  if ((task as any).assigned_person_id) {
    const assignedIds = uniqueNumbers([(task as any).assigned_person_id]);
    ids.push(...assignedIds);
    addAssignmentSource(sourceMap, assignedIds, "assigned_person_id");
  }

  const fields = task.field_values || {};
  for (const [fieldId, value] of Object.entries(fields)) {
    if (fieldTypes?.get(fieldId) !== "persons_list") continue;
    const fieldIds = extractTypedPersonEntries(value);
    ids.push(...fieldIds);
    addAssignmentSource(sourceMap, fieldIds, `field:${fieldId}`);
  }

  return {
    ids: uniqueNumbers(ids),
    workingIds: uniqueNumbers(ids),
    sources: Object.fromEntries(
      Array.from(sourceMap.entries()).map(([personId, values]) => [
        personId,
        Array.from(values),
      ]),
    ),
  };
}

export function extractMetricCapabilityIds(
  task: ApiTaskInstance,
  fieldTypes?: FieldTypeMap,
): number[] {
  const ids: number[] = [];
  if (Array.isArray((task as any).capability_ids)) {
    ids.push(...uniqueNumbers((task as any).capability_ids));
  }
  if (Array.isArray((task as any).task_capabilities)) {
    ids.push(
      ...uniqueNumbers(
        (task as any).task_capabilities.map((tc: any) => tc.capability_id),
      ),
    );
  }

  const fields = task.field_values || {};
  for (const [fieldId, value] of Object.entries(fields)) {
    if (fieldTypes?.get(fieldId) !== "capabilities_list") continue;
    ids.push(...extractCapabilityEntries(value));
  }

  return uniqueNumbers(ids);
}

export function getMetricTaskDurationHours(task: {
  start_time: string;
  end_time: string;
}): number {
  const startDate = task.start_time.slice(0, 10);
  const endDate = task.end_time.slice(0, 10);
  const startMinutes = parseMetricTimeToMinutes(task.start_time);
  const endMinutes = parseMetricTimeToMinutes(task.end_time);
  if (!startDate || !endDate || startMinutes === null || endMinutes === null) {
    return 0;
  }
  const dayDelta =
    (Date.parse(`${endDate}T00:00:00Z`) -
      Date.parse(`${startDate}T00:00:00Z`)) /
    86400000;
  const durationMinutes = dayDelta * 1440 + endMinutes - startMinutes;
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return 0;
  return durationMinutes / 60;
}

function getClockFromISO(value: string): string | null {
  const timePart = value.includes("T") ? value.split("T")[1] : value;
  const match = /^(\d{1,2}:\d{2})/.exec(timePart || "");
  return match ? match[1] : null;
}

function resolveMetricTaskDate(
  task: ApiTaskInstance,
  times: { start_time: string; end_time: string },
  boundary?: Partial<ScheduleDayBoundary> | null,
): string {
  const actualDate = task.date || times.start_time.slice(0, 10);
  const startClock = getClockFromISO(times.start_time);
  return (
    getWorkingDayForDateTime(actualDate, startClock, boundary) || actualDate
  );
}

export function calculatePersonHoursByDay(
  schedule: ScheduleData,
): Map<string, Map<number, number>> {
  const byDay = new Map<string, Map<number, number>>();
  for (const task of schedule.tasks) {
    if (!countsTowardsWorkTime(task)) continue;
    const duration = getMetricTaskDurationHours(task);
    if (duration <= 0) continue;
    const date = task.date || task.start_time.slice(0, 10);
    if (!byDay.has(date)) byDay.set(date, new Map());
    const dayHours = byDay.get(date)!;
    for (const personId of workingPersonIds(task)) {
      dayHours.set(personId, (dayHours.get(personId) || 0) + duration);
    }
  }
  return byDay;
}

export function getPersonTaskBreakdownForDay(
  schedule: ScheduleData,
  personId: number,
  date: string,
): MetricTaskBreakdown[] {
  return schedule.tasks
    .filter(
      (task) =>
        countsTowardsWorkTime(task) &&
        task.date === date &&
        personCountsTowardsWorkTime(task, personId),
    )
    .map((task) => ({
      taskId: task.id,
      taskName: task.name,
      date: task.date,
      startTime: task.start_time,
      endTime: task.end_time,
      durationHours: Number(getMetricTaskDurationHours(task).toFixed(2)),
      source: task.schedule_source || "raw",
      assignmentSource: task.person_assignment_sources?.[personId] || [],
    }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function findMaxHoursViolations(
  schedule: ScheduleData,
): MaxHoursViolation[] {
  const hoursByDay = calculatePersonHoursByDay(schedule);
  const peopleById = new Map(schedule.people.map((person) => [person.id, person]));
  const violations: MaxHoursViolation[] = [];

  for (const [date, personHours] of hoursByDay.entries()) {
    for (const [personId, hours] of personHours.entries()) {
      const person = peopleById.get(personId);
      if (!person) continue;
      const maxHours = person?.max_hours_per_day;
      if (maxHours == null || hours <= maxHours + 0.001) continue;
      violations.push({
        personId,
        personName: person.name || `${person.first_name} ${person.last_name}`,
        date,
        hours: Number(hours.toFixed(2)),
        maxHours,
      });
    }
  }

  return violations;
}

export function findMaxHoursViolationBreakdowns(
  schedule: ScheduleData,
): MaxHoursViolationBreakdown[] {
  return findMaxHoursViolations(schedule).map((violation) => ({
    ...violation,
    tasks: getPersonTaskBreakdownForDay(
      schedule,
      violation.personId,
      violation.date,
    ),
  }));
}

export function findWorstMaxHoursViolation(
  schedule: ScheduleData,
): MaxHoursViolationBreakdown | null {
  const breakdowns = findMaxHoursViolationBreakdowns(schedule);
  if (breakdowns.length === 0) return null;
  return breakdowns.reduce((worst, current) => {
    const worstOver = worst.hours - worst.maxHours;
    const currentOver = current.hours - current.maxHours;
    return currentOver > worstOver ? current : worst;
  });
}

export function buildMetricScheduleData(
  taskInstances: ApiTaskInstance[],
  apiPersons: Person[],
  apiCapabilities: Capability[],
  dayAliases: Record<string, string>,
  apiTaskTypes: TaskType[] = [],
  eventDates?: string[],
  taskTemplates: TaskTemplate[] = [],
  eventDayBoundaries: Record<number, Partial<ScheduleDayBoundary>> = {},
): MetricBuildResult {
  const fieldTypesByTemplate = buildTemplateFieldMap(taskTemplates);
  const personIds = new Set(apiPersons.map((person) => person.id));
  const diagnostics: MetricScheduleDiagnostics = {
    includedTasks: 0,
    skippedMissingTimes: 0,
    skippedInvalidDuration: 0,
    unassignedTimedTasks: 0,
    missingPersonReferences: 0,
  };

  const people: MetricPerson[] = apiPersons.map((person) => ({
    id: person.id,
    name: `${person.first_name} ${person.last_name}`.trim(),
    first_name: person.first_name,
    last_name: person.last_name,
    email: person.email,
    max_hours_per_day: person.max_hours_per_day,
    capabilities: person.capabilities || [],
  }));

  const capabilities: MetricCapability[] = apiCapabilities.map((capability) => ({
    id: capability.id,
    name: capability.name,
    machine_name: capability.machine_name,
    color: "#6b7280",
  }));

  const tasks: TaskInstance[] = [];
  const taskTypesById = new Map(
    apiTaskTypes.map((taskType) => [taskType.id, taskType]),
  );
  for (const task of taskInstances || []) {
    const times = extractMetricTaskTimes(task);
    if (!times) {
      diagnostics.skippedMissingTimes += 1;
      continue;
    }
    const duration = getMetricTaskDurationHours(times);
    if (duration <= 0) {
      diagnostics.skippedInvalidDuration += 1;
      continue;
    }

    const fieldTypes =
      task.template_id != null ? fieldTypesByTemplate.get(task.template_id) : undefined;
    const assignments = extractMetricPersonAssignments(task, fieldTypes);
    const assignedPersonIds = assignments.ids;
    if (assignedPersonIds.length === 0) {
      diagnostics.unassignedTimedTasks += 1;
    }
    diagnostics.missingPersonReferences += assignedPersonIds.filter(
      (id) => !personIds.has(id),
    ).length;

    const taskEventId = (task as any).event_id;
    const boundary =
      taskEventId != null ? eventDayBoundaries[taskEventId] : undefined;
    const metricDate = resolveMetricTaskDate(task, times, boundary);
    const scheduleSource = getScheduleBlockInfo(task)?.source || "raw";

    tasks.push({
      id: String(task.id),
      person_ids: assignedPersonIds.filter((id) => personIds.has(id)),
      working_person_ids: assignments.workingIds.filter((id) => personIds.has(id)),
      task_id: (task as any).task_id || task.id,
      task_type_id: task.task_type_id || 0,
      capability_ids: extractMetricCapabilityIds(task, fieldTypes),
      date: metricDate,
      start_time: times.start_time,
      end_time: times.end_time,
      name: task.name || "",
      schedule_source: scheduleSource,
      person_assignment_sources: assignments.sources,
      counts_towards_work_time:
        taskTypesById.get(task.task_type_id || 0)?.counts_towards_work_time !==
        false,
    });
    diagnostics.includedTasks += 1;
  }

  const taskTypes: TaskTypeInfo[] = apiTaskTypes.map((taskType) => ({
    id: taskType.id,
    name: taskType.name,
    color: taskType.color || "#6b7280",
    fatigue_score: taskType.fatigue_score ?? 0,
    counts_towards_work_time: taskType.counts_towards_work_time !== false,
  }));

  return {
    data: {
      tasks,
      people,
      capabilities,
      taskTypes,
      dayAliases,
      eventDates,
    },
    diagnostics,
  };
}
