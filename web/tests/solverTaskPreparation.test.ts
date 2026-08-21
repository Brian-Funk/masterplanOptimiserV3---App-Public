import { describe, expect, it } from "vitest";

import {
  prepareSolverTasksForWorkingDay,
  shouldIgnoreSelectedTasks,
} from "@/app/dashboard/admin/tabs/cmi/solverTaskPreparation";

const templates = [
  {
    id: 11,
    fields: [
      { id: 101, type: "start_end_time" },
      { id: 102, type: "location" },
    ],
  },
  {
    id: 12,
    is_floating: true,
    fields: [
      { id: 201, type: "time_range" },
      { id: 202, type: "location" },
    ],
  },
];

const instances = [
  {
    id: 1,
    event_id: 7,
    template_id: 11,
    task_type_id: 4,
    date: "2032-04-21",
    field_values: {
      101: { start: "09:00", end: "10:00" },
      102: 3,
    },
    optimised: { assigned_persons: [9] },
    final: { assigned_persons: [9] },
  },
  {
    id: 2,
    event_id: 7,
    template_id: 12,
    task_type_id: 4,
    date: "2032-04-21",
    field_values: {
      201: { start: "10:00", end: "12:00" },
      202: 3,
    },
  },
  {
    id: 3,
    event_id: 8,
    template_id: 11,
    task_type_id: 4,
    date: "2032-04-21",
    field_values: {
      101: { start: "11:00", end: "12:00" },
      102: 3,
    },
  },
];

describe("solver task preparation", () => {
  it("excludes ignored tasks before building solver input without mutating them", () => {
    const original = structuredClone(instances);
    const result = prepareSolverTasksForWorkingDay({
      eventId: 7,
      selectedDate: "2032-04-21",
      templates,
      taskTypes: [{ id: 4, counts_towards_work_time: true }],
      taskInstances: instances,
      ignoredTaskIds: new Set([1]),
    });

    expect(result.allTaskInstances.map((task) => task.id)).toEqual([1, 2]);
    expect(result.activeTaskInstances.map((task) => task.id)).toEqual([2]);
    expect(result.solverTasks.map((task) => task.id)).toEqual([2]);
    expect(result.ignoredCount).toBe(1);
    expect(instances).toEqual(original);
  });

  it("reports an empty active scope when every task is ignored", () => {
    const result = prepareSolverTasksForWorkingDay({
      eventId: 7,
      selectedDate: "2032-04-21",
      templates,
      taskInstances: instances,
      ignoredTaskIds: new Set([1, 2]),
    });

    expect(result.allTaskInstances).toHaveLength(2);
    expect(result.activeTaskInstances).toEqual([]);
    expect(result.solverTasks).toEqual([]);
    expect(result.ignoredCount).toBe(2);
  });

  it("uses the same active scope when a quick check skips floating tasks", () => {
    const result = prepareSolverTasksForWorkingDay({
      eventId: 7,
      selectedDate: "2032-04-21",
      templates,
      taskInstances: instances,
      ignoredTaskIds: new Set(),
      skipFloating: true,
    });

    expect(result.activeTaskInstances.map((task) => task.id)).toEqual([1, 2]);
    expect(result.solverTasks.map((task) => task.id)).toEqual([1]);
  });

  it("ignores a mixed selection and restores an all-ignored selection", () => {
    expect(shouldIgnoreSelectedTasks([1, 2], new Set([1]))).toBe(true);
    expect(shouldIgnoreSelectedTasks([1, 2], new Set([1, 2]))).toBe(false);
  });
});
