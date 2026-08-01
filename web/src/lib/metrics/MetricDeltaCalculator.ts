/**
 * Utility for computing metric deltas when task assignments change.
 * Works directly with localStorage task instances - no dependency on the metric system.
 */

/** Parse a time value (number=minutes, or "HH:MM" string) to minutes */
function parseTimeValue(val: any): number {
  if (typeof val === "number") return val;
  if (typeof val === "string" && val.includes(":")) {
    const [h, m] = val.split(":").map(Number);
    if (!isNaN(h) && !isNaN(m)) return h * 60 + m;
  }
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

/** Get a task's duration in hours from its schedule data */
function getTaskHours(task: any): number {
  const schedule = task.final || task.optimised || {};
  const start = parseTimeValue(schedule.start_time);
  const end = parseTimeValue(schedule.end_time);
  return Math.max(0, (end - start) / 60);
}

/** Get person IDs assigned to a task */
function getAssignedPersons(task: any): number[] {
  const schedule = task.final || task.optimised || {};
  return schedule.assigned_persons || [];
}

/** Compute hours per day for a specific person across all task instances */
export function computeHoursPerDay(
  taskInstances: any[],
  personId: number,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const task of taskInstances) {
    if (!getAssignedPersons(task).includes(personId)) continue;
    const date = task.date;
    if (!date) continue;
    result[date] = (result[date] || 0) + getTaskHours(task);
  }
  return result;
}

export interface PersonDelta {
  personId: number;
  personName: string;
  currentHours: Record<string, number>; // date → hours
  proposedHours: Record<string, number>; // date → hours
  dayDelta: number; // change on the task's date only
}

/**
 * Compute the metric delta for a person replacement/addition/removal on a task.
 */
export function computeAssignmentDelta(
  taskInstances: any[],
  taskId: number,
  removePersonId: number | null,
  addPersonId: number | null,
  persons: Array<{ id: number; first_name: string; last_name: string }>,
): { deltas: PersonDelta[]; taskDate: string; taskHours: number } {
  const task = taskInstances.find((t: any) => t.id === taskId);
  const taskHours = task ? getTaskHours(task) : 0;
  const taskDate = task?.date || "";
  const deltas: PersonDelta[] = [];

  if (removePersonId) {
    const person = persons.find((p) => p.id === removePersonId);
    const current = computeHoursPerDay(taskInstances, removePersonId);
    const proposed = { ...current };
    if (taskDate) {
      proposed[taskDate] = Math.max(0, (proposed[taskDate] || 0) - taskHours);
    }
    deltas.push({
      personId: removePersonId,
      personName: person
        ? `${person.first_name} ${person.last_name}`
        : `Person ${removePersonId}`,
      currentHours: current,
      proposedHours: proposed,
      dayDelta: -taskHours,
    });
  }

  if (addPersonId) {
    const person = persons.find((p) => p.id === addPersonId);
    const current = computeHoursPerDay(taskInstances, addPersonId);
    const proposed = { ...current };
    if (taskDate) {
      proposed[taskDate] = (proposed[taskDate] || 0) + taskHours;
    }
    deltas.push({
      personId: addPersonId,
      personName: person
        ? `${person.first_name} ${person.last_name}`
        : `Person ${addPersonId}`,
      currentHours: current,
      proposedHours: proposed,
      dayDelta: taskHours,
    });
  }

  return { deltas, taskDate, taskHours };
}

/**
 * Compute delta for the current edit state vs. original state in the edit modal.
 * Compares original person list with proposed person list and returns
 * deltas for each person added or removed.
 */
export function computeEditDelta(
  taskInstances: any[],
  taskId: number,
  originalPersonIds: number[],
  proposedPersonIds: number[],
  persons: Array<{ id: number; first_name: string; last_name: string }>,
): { deltas: PersonDelta[]; taskDate: string; taskHours: number } {
  const removed = originalPersonIds.filter(
    (id) => !proposedPersonIds.includes(id),
  );
  const added = proposedPersonIds.filter(
    (id) => !originalPersonIds.includes(id),
  );

  const task = taskInstances.find((t: any) => t.id === taskId);
  const taskHours = task ? getTaskHours(task) : 0;
  const taskDate = task?.date || "";
  const deltas: PersonDelta[] = [];

  for (const personId of removed) {
    const person = persons.find((p) => p.id === personId);
    const current = computeHoursPerDay(taskInstances, personId);
    const proposed = { ...current };
    if (taskDate) {
      proposed[taskDate] = Math.max(0, (proposed[taskDate] || 0) - taskHours);
    }
    deltas.push({
      personId,
      personName: person
        ? `${person.first_name} ${person.last_name}`
        : `Person ${personId}`,
      currentHours: current,
      proposedHours: proposed,
      dayDelta: -taskHours,
    });
  }

  for (const personId of added) {
    const person = persons.find((p) => p.id === personId);
    const current = computeHoursPerDay(taskInstances, personId);
    const proposed = { ...current };
    if (taskDate) {
      proposed[taskDate] = (proposed[taskDate] || 0) + taskHours;
    }
    deltas.push({
      personId,
      personName: person
        ? `${person.first_name} ${person.last_name}`
        : `Person ${personId}`,
      currentHours: current,
      proposedHours: proposed,
      dayDelta: taskHours,
    });
  }

  return { deltas, taskDate, taskHours };
}
