import { describe, expect, it } from "vitest";
import {
  buildMetricScheduleData,
  calculatePersonHoursByDay,
  findMaxHoursViolations,
  workingPersonIds,
} from "@/lib/metrics/metricScheduleData";
import { FairnessMetric } from "@/lib/metrics/implementations/FairnessMetric";
import {
  TaskTypeCountSpiderMetric,
  TaskTypeHoursSpiderMetric,
} from "@/lib/metrics/implementations/TaskTypeSpiderMetric";
import { WorkloadSpiderMetric } from "@/lib/metrics/implementations/WorkloadSpiderMetric";

const people = [
  {
    id: 1,
    first_name: "Passenger",
    last_name: "Example",
    email: null,
    max_hours_per_day: 2,
    capabilities: [],
  },
  {
    id: 2,
    first_name: "Driver",
    last_name: "Example",
    email: null,
    max_hours_per_day: 8,
    capabilities: ["driver"],
  },
] as any;

const taskTypes = [
  {
    id: 7,
    name: "Transfer",
    color: "#334155",
    fatigue_score: 1,
    counts_towards_work_time: true,
  },
] as any;

const templates = [
  {
    id: 9,
    fields: [
      { id: "driver", type: "capabilities_list" },
      { id: "travellers", type: "transferee" },
    ],
    custom_fields: [],
  },
] as any;

function transferTask(final: Record<string, unknown>) {
  return {
    id: 11,
    name: "Transfer",
    event_id: 1,
    template_id: 9,
    task_type_id: 7,
    date: "2032-04-21",
    is_floating: false,
    is_transfer: true,
    field_values: {},
    final,
  } as any;
}

function build(final: Record<string, unknown>) {
  return buildMetricScheduleData(
    [transferTask(final)],
    people,
    [],
    {},
    taskTypes,
    ["2032-04-21"],
    templates,
  ).data;
}

describe("transfer working-time metrics", () => {
  it("retains every rider but records only non-transferee roles as working", () => {
    const schedule = build({
      start_time: "09:00",
      end_time: "12:00",
      assigned_persons: [1, 2],
      field_assignments: { driver: [2], travellers: [1] },
    });

    expect(schedule.tasks[0].person_ids).toEqual([1, 2]);
    expect(workingPersonIds(schedule.tasks[0])).toEqual([2]);
    expect(calculatePersonHoursByDay(schedule).get("2032-04-21")).toEqual(
      new Map([[2, 3]]),
    );
    expect(findMaxHoursViolations(schedule)).toEqual([]);
  });

  it("retains the all-riders-counted fallback for old results without roles", () => {
    const schedule = build({
      start_time: "09:00",
      end_time: "12:00",
      assigned_persons: [1, 2],
    });

    expect(workingPersonIds(schedule.tasks[0])).toEqual([1, 2]);
    expect(findMaxHoursViolations(schedule)).toMatchObject([
      { personId: 1, hours: 3, maxHours: 2 },
    ]);
  });

  it("aligns fairness and working-hours-by-task-type without hiding travel", async () => {
    const schedule = build({
      start_time: "09:00",
      end_time: "12:00",
      assigned_persons: [1, 2],
      field_assignments: { driver: [2], travellers: [1] },
    });

    const fairness = await new FairnessMetric().calculate(schedule);
    expect(fairness.value).toBe(1.5);

    const hours = await new TaskTypeHoursSpiderMetric().calculate(
      schedule,
      undefined,
      { personIds: [1, 2] },
    );
    expect((hours.data as any).datasets.map((item: any) => item.values)).toEqual([
      [0],
      [3],
    ]);

    const counts = await new TaskTypeCountSpiderMetric().calculate(
      schedule,
      undefined,
      { personIds: [1, 2] },
    );
    expect((counts.data as any).datasets.map((item: any) => item.values)).toEqual([
      [1],
      [1],
    ]);
  });

  it("retains descriptive duration for non-work task types", async () => {
    const schedule = build({
      start_time: "09:00",
      end_time: "12:00",
      assigned_persons: [1],
    });
    schedule.tasks[0].counts_towards_work_time = false;

    expect(calculatePersonHoursByDay(schedule).get("2032-04-21")).toBeUndefined();

    const hours = await new TaskTypeHoursSpiderMetric().calculate(
      schedule,
      undefined,
      { personIds: [1] },
    );
    expect((hours.data as any).datasets[0].values).toEqual([3]);
  });

  it("keeps passenger assignment and break context while excluding its hours", async () => {
    const schedule = build({
      start_time: "09:00",
      end_time: "12:00",
      assigned_persons: [1, 2],
      field_assignments: { driver: [2], travellers: [1] },
    });

    const result = await new WorkloadSpiderMetric().calculate(
      schedule,
      undefined,
      { personIds: [1, 2] },
    );
    expect((result.data as any).datasets.map((item: any) => item.values)).toEqual([
      [1, 0, 0],
      [1, 3, 0],
    ]);
  });
});
