import type { Group, GroupMember, Person } from "@/lib/api";

export interface ResolvedGroupMembers {
  personIds: number[];
  directPersonIds: number[];
  includedGroupIds: number[];
  warnings: string[];
}

export interface ExcludedGroupPerson {
  person_id: number;
  group_id: number;
  group_name: string;
  reason: "unavailable";
  unavailable_from?: string;
  unavailable_to?: string;
}

export interface ResolvedGroupAssignment {
  personIds: number[];
  directPersonIds: number[];
  groupPersonIds: number[];
  includedGroupIds: number[];
  excludedPersons: ExcludedGroupPerson[];
  warnings: string[];
}

interface RuntimeGroupAssignmentArgs {
  value: unknown[] | null | undefined;
  groups: Group[];
  persons: Pick<Person, "id" | "unavailabilities">[];
  taskDate?: string | null;
  selectedWorkingDate?: string | null;
  workingDayBoundaryOffsetHour?: number | null;
  taskStart?: string | number | null;
  taskEnd?: string | number | null;
}

interface RuntimeGroupFieldArgs {
  fields: Array<{ id: string | number; type: string }> | null | undefined;
  fieldValues: Record<string, unknown> | null | undefined;
  groups: Group[];
  persons: Pick<Person, "id" | "unavailabilities">[];
  taskDate?: string | null;
  selectedWorkingDate?: string | null;
  workingDayBoundaryOffsetHour?: number | null;
  taskStart?: string | number | null;
  taskEnd?: string | number | null;
}

export interface RuntimeGroupFieldDisplay {
  fieldAssignments: Record<string, number[]>;
  fieldAssignmentExclusions: Record<string, ExcludedGroupPerson[]>;
  representedPersonIds: number[];
  warnings: string[];
}

type Interval = {
  start: number;
  end: number;
  labelStart?: string;
  labelEnd?: string;
};

type LocalDateTime = {
  date: string;
  minutes: number;
};

const MINUTES_PER_DAY = 24 * 60;

function coerceMemberId(rawId: unknown): number | null {
  const id =
    typeof rawId === "number"
      ? rawId
      : typeof rawId === "string" && rawId.trim() !== ""
        ? Number(rawId)
        : NaN;

  return Number.isInteger(id) ? id : null;
}

/** Convert legacy and typed group member values into supported member entries. */
export function normaliseGroupMembers(
  members: unknown[] | null | undefined,
): GroupMember[] {
  const result: GroupMember[] = [];
  const seen = new Set<string>();

  for (const member of members || []) {
    const memberType =
      typeof member === "object" && member !== null && "type" in member
        ? (member as { type?: unknown }).type
        : "person";
    const id =
      typeof member === "object" && member !== null && "id" in member
        ? coerceMemberId((member as { id?: unknown }).id)
        : coerceMemberId(member);

    if ((memberType !== "person" && memberType !== "group") || id === null) {
      continue;
    }

    const key = `${memberType}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ type: memberType, id });
  }

  return result;
}

/** Return the direct person IDs stored in one group member list. */
export function getDirectPersonIdsFromMembers(
  members: unknown[] | null | undefined,
): number[] {
  return normaliseGroupMembers(members)
    .filter((member) => member.type === "person")
    .map((member) => member.id);
}

/** Return the direct included group IDs stored in one group member list. */
export function getIncludedGroupIdsFromMembers(
  members: unknown[] | null | undefined,
): number[] {
  return normaliseGroupMembers(members)
    .filter((member) => member.type === "group")
    .map((member) => member.id);
}

/** Merge person and group member references without duplicating entries. */
export function mergeGroupMemberSelections(
  current: unknown[] | null | undefined,
  incoming: unknown[] | null | undefined,
): GroupMember[] {
  return normaliseGroupMembers([
    ...normaliseGroupMembers(current),
    ...normaliseGroupMembers(incoming),
  ]);
}

/** Remove one person or group reference from a mixed member selection. */
export function removeGroupMemberSelection(
  current: unknown[] | null | undefined,
  memberType: GroupMember["type"] | undefined,
  memberId: number,
): GroupMember[] {
  const typeToRemove = memberType || "person";
  return normaliseGroupMembers(current).filter(
    (member) => member.type !== typeToRemove || member.id !== memberId,
  );
}

function appendUnique(target: number[], seen: Set<number>, values: number[]) {
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    target.push(value);
  }
}

function parseClockMinutes(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  const match = trimmed.match(/(?:T|\s)?(?<hour>-?\d{1,3}):(?<minute>\d{2})/);
  if (!match?.groups) return null;
  const hour = Number(match.groups.hour);
  const minute = Number(match.groups.minute);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (minute < 0 || minute >= 60) return null;
  return hour * 60 + minute;
}

function dateSerial(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return Math.floor(parsed.getTime() / 86_400_000);
}

function dateDiffDays(baseDate: string | null | undefined, actualDate: string | null | undefined): number {
  const base = dateSerial(baseDate);
  const actual = dateSerial(actualDate);
  if (base === null || actual === null) return 0;
  return actual - base;
}

function addDays(dateValue: string, days: number): string {
  const serial = dateSerial(dateValue);
  if (serial === null) return dateValue;
  const result = new Date((serial + days) * 86_400_000);
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
}

function parseLocalDateTime(value: unknown): LocalDateTime | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(
    /^(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}):(\d{2})/,
  );
  if (!match || dateSerial(match[1]) === null) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { date: match[1], minutes: hour * 60 + minute };
}

function getIntervalValues(entry: unknown): [unknown, unknown] {
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    return [record.from ?? record.start, record.to ?? record.end];
  }
  if (Array.isArray(entry) && entry.length === 2) {
    return [entry[0], entry[1]];
  }
  return [null, null];
}

function formatIntervalLabel(minutes: number): string {
  const normalized = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatLocalDateTimeLabel(value: LocalDateTime): string {
  const [year, month, day] = value.date.split("-");
  return `${day}.${month}.${year} ${formatIntervalLabel(value.minutes)}`;
}

function workingDayWindow(boundaryOffsetHour: number | null | undefined): {
  start: number;
  end: number;
} {
  const offset = Number.isFinite(Number(boundaryOffsetHour))
    ? Math.min(12, Math.max(0, Math.trunc(Number(boundaryOffsetHour))))
    : 0;
  const start = offset * 60;
  return {
    start,
    end: start === 0 ? MINUTES_PER_DAY : MINUTES_PER_DAY + start,
  };
}

function intersectInterval(
  interval: Interval,
  window: { start: number; end: number },
): Interval | null {
  const start = Math.max(interval.start, window.start);
  const end = Math.min(interval.end, window.end);
  if (start >= end) return null;
  return { ...interval, start, end };
}

function resolveSelectedWorkingDate(
  args: RuntimeGroupAssignmentArgs,
  taskStart: number | null,
): string | null {
  if (args.selectedWorkingDate) return args.selectedWorkingDate;
  if (!args.taskDate) return null;
  if (taskStart === null) return args.taskDate;

  if (taskStart >= MINUTES_PER_DAY) {
    return addDays(args.taskDate, -Math.floor(taskStart / MINUTES_PER_DAY));
  }

  const boundary = workingDayWindow(args.workingDayBoundaryOffsetHour).start;
  return boundary > 0 && taskStart >= 0 && taskStart < boundary
    ? addDays(args.taskDate, -1)
    : args.taskDate;
}

function buildTaskInterval(
  args: RuntimeGroupAssignmentArgs,
  selectedWorkingDate: string | null,
): { start: number; end: number } | null {
  const start = parseClockMinutes(args.taskStart);
  const endBase = parseClockMinutes(args.taskEnd);
  if (start === null || endBase === null) return null;

  const offset = dateDiffDays(selectedWorkingDate || args.taskDate, args.taskDate);
  const linearStart =
    Math.abs(start) >= MINUTES_PER_DAY
      ? start
      : start + offset * MINUTES_PER_DAY;
  let linearEnd =
    Math.abs(endBase) >= MINUTES_PER_DAY
      ? endBase
      : endBase + offset * MINUTES_PER_DAY;
  if (linearEnd <= linearStart) {
    linearEnd += MINUTES_PER_DAY;
  }
  return { start: linearStart, end: linearEnd };
}

function buildPersonUnavailableIntervals(
  person: Pick<Person, "unavailabilities"> | undefined,
  baseDate: string | null | undefined,
  boundaryOffsetHour: number | null | undefined,
): Interval[] {
  if (!person) return [];
  const intervals: Interval[] = [];
  const window = workingDayWindow(boundaryOffsetHour);

  const appendClipped = (interval: Interval) => {
    const clipped = intersectInterval(interval, window);
    if (clipped) intervals.push(clipped);
  };

  const addDatedInterval = (
    startValue: LocalDateTime,
    endValue: LocalDateTime,
  ) => {
    const selectedDate = baseDate || startValue.date;
    const start =
      dateDiffDays(selectedDate, startValue.date) * MINUTES_PER_DAY +
      startValue.minutes;
    let end =
      dateDiffDays(selectedDate, endValue.date) * MINUTES_PER_DAY +
      endValue.minutes;
    if (end <= start) end += MINUTES_PER_DAY;
    appendClipped({
      start,
      end,
      labelStart: formatLocalDateTimeLabel(startValue),
      labelEnd: formatLocalDateTimeLabel(endValue),
    });
  };

  for (const entry of person.unavailabilities || []) {
    const datedStart = parseLocalDateTime(entry.starts_at);
    const datedEnd = parseLocalDateTime(entry.ends_at);
    if (datedStart && datedEnd) addDatedInterval(datedStart, datedEnd);
  }

  const seen = new Set<string>();
  return intervals.filter((interval) => {
    const key = `${interval.start}:${interval.end}:${interval.labelStart || ""}:${interval.labelEnd || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findFirstOverlap(intervals: Interval[], taskInterval: { start: number; end: number }): Interval | null {
  for (const interval of intervals) {
    if (interval.start < taskInterval.end && interval.end > taskInterval.start) {
      return interval;
    }
  }
  return null;
}

function resolveMemberList(
  members: unknown[] | null | undefined,
  groups: Group[],
  visiting: Set<number>,
): ResolvedGroupMembers {
  const personIds: number[] = [];
  const directPersonIds: number[] = [];
  const includedGroupIds: number[] = [];
  const warnings: string[] = [];
  const seenPersons = new Set<number>();
  const seenDirectPersons = new Set<number>();
  const seenIncludedGroups = new Set<number>();

  for (const member of normaliseGroupMembers(members)) {
    if (member.type === "person") {
      appendUnique(directPersonIds, seenDirectPersons, [member.id]);
      appendUnique(personIds, seenPersons, [member.id]);
      continue;
    }

    if (seenIncludedGroups.has(member.id)) continue;
    seenIncludedGroups.add(member.id);
    includedGroupIds.push(member.id);

    if (visiting.has(member.id)) {
      warnings.push("This would create a circular group reference.");
      continue;
    }

    const includedGroup = groups.find((group) => group.id === member.id);
    if (!includedGroup) {
      warnings.push("This group no longer exists.");
      continue;
    }

    visiting.add(member.id);
    const resolved = resolveMemberList(
      includedGroup.members,
      groups,
      visiting,
    );
    visiting.delete(member.id);

    appendUnique(personIds, seenPersons, resolved.personIds);
    warnings.push(...resolved.warnings);
  }

  return {
    personIds,
    directPersonIds,
    includedGroupIds,
    warnings: [...new Set(warnings)],
  };
}

/** Resolve a group to concrete person IDs, including people from nested groups. */
export function resolveGroupMembers(
  groupId: number,
  groups: Group[],
): ResolvedGroupMembers {
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group) {
    return {
      personIds: [],
      directPersonIds: [],
      includedGroupIds: [],
      warnings: ["This group no longer exists."],
    };
  }

  return resolveMemberList(group.members, groups, new Set([groupId]));
}

/** Resolve an unsaved member list, such as the current group editor form. */
export function resolveGroupMemberList(
  members: unknown[] | null | undefined,
  groups: Group[],
): ResolvedGroupMembers {
  return resolveMemberList(members, groups, new Set());
}

/** Resolve live person and group references for one task without losing date semantics. */
export function resolveGroupAssignmentForTask(
  args: RuntimeGroupAssignmentArgs,
): ResolvedGroupAssignment {
  const result: ResolvedGroupAssignment = {
    personIds: [],
    directPersonIds: [],
    groupPersonIds: [],
    includedGroupIds: [],
    excludedPersons: [],
    warnings: [],
  };
  const parsedTaskStart = parseClockMinutes(args.taskStart);
  const selectedWorkingDate = resolveSelectedWorkingDate(args, parsedTaskStart);
  const taskInterval = buildTaskInterval(args, selectedWorkingDate);
  const availabilityKnown = taskInterval !== null;
  const personById = new Map(args.persons.map((person) => [person.id, person]));
  const unavailableByPerson = new Map<number, Interval[]>();
  const seenPersons = new Set<number>();
  const seenDirectPersons = new Set<number>();
  const seenGroupPersons = new Set<number>();
  const seenGroups = new Set<number>();
  const seenExclusions = new Set<string>();

  const appendEffective = (personId: number, fromGroup: boolean) => {
    if (!personById.has(personId)) return;
    appendUnique(result.personIds, seenPersons, [personId]);
    if (fromGroup) {
      appendUnique(result.groupPersonIds, seenGroupPersons, [personId]);
    } else {
      appendUnique(result.directPersonIds, seenDirectPersons, [personId]);
    }
  };

  const addExclusion = (personId: number, group: Group, overlap: Interval) => {
    const key = `${group.id}:${personId}`;
    if (seenExclusions.has(key)) return;
    seenExclusions.add(key);
    result.excludedPersons.push({
      person_id: personId,
      group_id: group.id,
      group_name: group.name || `Group ${group.id}`,
      reason: "unavailable",
      unavailable_from: overlap.labelStart || formatIntervalLabel(overlap.start),
      unavailable_to: overlap.labelEnd || formatIntervalLabel(overlap.end),
    });
  };

  const getUnavailableIntervals = (personId: number) => {
    if (!unavailableByPerson.has(personId)) {
      unavailableByPerson.set(
        personId,
        buildPersonUnavailableIntervals(
          personById.get(personId),
          selectedWorkingDate,
          args.workingDayBoundaryOffsetHour,
        ),
      );
    }
    return unavailableByPerson.get(personId) || [];
  };

  const resolveGroup = (
    group: Group,
    visiting: Set<number>,
  ): { allPeople: number[]; availablePeople: number[] } => {
    const allPeople: number[] = [];
    const availablePeople: number[] = [];
    const seenAll = new Set<number>();
    const seenAvailable = new Set<number>();

    for (const member of normaliseGroupMembers(group.members)) {
      if (member.type === "person") {
        if (!personById.has(member.id)) continue;
        appendUnique(allPeople, seenAll, [member.id]);

        if (!availabilityKnown) {
          appendUnique(availablePeople, seenAvailable, [member.id]);
          continue;
        }

        const overlap = findFirstOverlap(
          getUnavailableIntervals(member.id),
          taskInterval!,
        );
        if (overlap) {
          addExclusion(member.id, group, overlap);
          continue;
        }
        appendUnique(availablePeople, seenAvailable, [member.id]);
        continue;
      }

      if (visiting.has(member.id)) {
        result.warnings.push("This would create a circular group reference.");
        continue;
      }
      const nestedGroup = args.groups.find((candidate) => candidate.id === member.id);
      if (!nestedGroup) {
        result.warnings.push("This group no longer exists.");
        continue;
      }

      visiting.add(member.id);
      const nested = resolveGroup(nestedGroup, visiting);
      visiting.delete(member.id);
      appendUnique(allPeople, seenAll, nested.allPeople);
      appendUnique(availablePeople, seenAvailable, nested.availablePeople);
    }

    return { allPeople, availablePeople };
  };

  for (const reference of normaliseGroupMembers(args.value)) {
    if (reference.type === "person") {
      appendEffective(reference.id, false);
      continue;
    }

    const group = args.groups.find((candidate) => candidate.id === reference.id);
    if (!group) {
      result.warnings.push("This group no longer exists.");
      continue;
    }
    appendUnique(result.includedGroupIds, seenGroups, [group.id]);

    if (!availabilityKnown) {
      result.warnings.push(
        `Availability for group ${group.name || group.id} could not be checked because task time is unknown.`,
      );
    }

    const resolved = resolveGroup(group, new Set([group.id]));
    if (availabilityKnown && resolved.allPeople.length > 0 && resolved.availablePeople.length === 0) {
      result.warnings.push(
        `All members of ${group.name || `Group ${group.id}`} are unavailable during this task.`,
      );
    }
    for (const personId of resolved.availablePeople) {
      appendEffective(personId, true);
    }
  }

  return {
    ...result,
    warnings: [...new Set(result.warnings)],
  };
}

export function resolveRuntimeGroupAssignmentsForFields(
  args: RuntimeGroupFieldArgs,
): RuntimeGroupFieldDisplay {
  const fieldAssignments: Record<string, number[]> = {};
  const fieldAssignmentExclusions: Record<string, ExcludedGroupPerson[]> = {};
  const representedPersonIds: number[] = [];
  const representedSeen = new Set<number>();
  const warnings: string[] = [];

  for (const field of args.fields || []) {
    if (field.type !== "persons_list") continue;
    const fieldId = String(field.id);
    const rawValue = args.fieldValues?.[fieldId];
    if (!Array.isArray(rawValue)) continue;

    const resolved = resolveGroupAssignmentForTask({
      value: rawValue,
      groups: args.groups,
      persons: args.persons,
      taskDate: args.taskDate,
      selectedWorkingDate: args.selectedWorkingDate,
      workingDayBoundaryOffsetHour: args.workingDayBoundaryOffsetHour,
      taskStart: args.taskStart,
      taskEnd: args.taskEnd,
    });

    fieldAssignments[fieldId] = resolved.personIds;
    if (resolved.excludedPersons.length > 0) {
      fieldAssignmentExclusions[fieldId] = resolved.excludedPersons;
    }
    appendUnique(representedPersonIds, representedSeen, resolved.personIds);
    warnings.push(...resolved.warnings);
  }

  return {
    fieldAssignments,
    fieldAssignmentExclusions,
    representedPersonIds,
    warnings: [...new Set(warnings)],
  };
}

export function mergeRuntimeGroupFieldDisplay(
  baseFieldAssignments: Record<string, number[]> | null | undefined,
  runtimeDisplay: RuntimeGroupFieldDisplay,
): {
  fieldAssignments: Record<string, number[]> | undefined;
  fieldAssignmentExclusions: Record<string, ExcludedGroupPerson[]> | undefined;
} {
  const fieldAssignments: Record<string, number[]> = {
    ...(baseFieldAssignments || {}),
  };

  for (const [fieldId, personIds] of Object.entries(
    runtimeDisplay.fieldAssignments,
  )) {
    fieldAssignments[fieldId] = personIds;
  }

  const represented = new Set(runtimeDisplay.representedPersonIds);
  if (fieldAssignments.field_Assigned && represented.size > 0) {
    fieldAssignments.field_Assigned = fieldAssignments.field_Assigned.filter(
      (personId) => !represented.has(personId),
    );
    if (fieldAssignments.field_Assigned.length === 0) {
      delete fieldAssignments.field_Assigned;
    }
  }

  const fieldAssignmentExclusions =
    Object.keys(runtimeDisplay.fieldAssignmentExclusions).length > 0
      ? runtimeDisplay.fieldAssignmentExclusions
      : undefined;

  return {
    fieldAssignments:
      Object.keys(fieldAssignments).length > 0 ? fieldAssignments : undefined,
    fieldAssignmentExclusions,
  };
}

function groupReferencesTarget(
  startGroupId: number,
  targetGroupId: number,
  groups: Group[],
  visited = new Set<number>(),
): boolean {
  if (startGroupId === targetGroupId) return true;
  if (visited.has(startGroupId)) return false;
  visited.add(startGroupId);

  const group = groups.find((candidate) => candidate.id === startGroupId);
  if (!group) return false;

  return getIncludedGroupIdsFromMembers(group.members).some((includedGroupId) =>
    groupReferencesTarget(includedGroupId, targetGroupId, groups, visited),
  );
}

/** Check whether saving a group's included groups would introduce a cycle. */
export function wouldCreateCircularGroupReference(
  groupId: number,
  includedGroupIds: number[],
  groups: Group[],
): boolean {
  return includedGroupIds.some((includedGroupId) =>
    groupReferencesTarget(includedGroupId, groupId, groups),
  );
}
