import { BaseMetric } from "../BaseMetric";
import {
  MetricConfig,
  MetricResult,
  ScheduleData,
  MetricFilters,
  MetricSettings,
  RadarVisualization,
  TaskInstance,
} from "../MetricInterface";
import {
  countsTowardsWorkTime,
  personCountsTowardsWorkTime,
} from "../metricScheduleData";

/**
 * Task Type Count Spider - radar chart with one axis per task type.
 *
 * Each axis shows the number of assignments of that task type.
 * For individual persons the raw counts are shown.
 * For capabilities / groups the counts are averaged over ALL members who hold
 * that capability, keeping shapes comparable across individuals and groups.
 *
 * Values are normalised to 0-100 in the chart so the radar stays readable
 * regardless of absolute scale; tooltips show the raw counts.
 */
export class TaskTypeCountSpiderMetric extends BaseMetric {
  config: MetricConfig = {
    id: "task_type_count_spider",
    name: "Task Types (amount)",
    description: "Per-person radar showing number of assignments per task type",
    category: "distribution",
    visualization: "radar",
    supportsPersonFilter: true,
    supportsCapabilityFilter: true,
  };

  private static readonly DEFAULT_COLORS = [
    "#3b82f6",
    "#ef4444",
    "#10b981",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#84cc16",
  ];

  async calculate(
    schedule: ScheduleData,
    _filters?: MetricFilters,
    settings?: MetricSettings,
  ): Promise<MetricResult> {
    const personIds = settings?.personIds || [];
    const capabilityIds = settings?.capabilityIds || [];

    // Build axes from task types present in the schedule
    const taskTypes = schedule.taskTypes || [];
    const axes = taskTypes.map((tt) => tt.name);

    // If there are no task types we can't draw a meaningful radar
    if (axes.length === 0) {
      return {
        value: 0,
        label: "No task types",
        data: { type: "radar", axes: ["-"], datasets: [] },
      };
    }

    const datasets: RadarVisualization["datasets"] = [];

    // --- Individual persons ---
    for (const personId of personIds) {
      const person = schedule.people.find((p) => p.id === personId);
      if (!person) continue;

      const personTasks = schedule.tasks.filter((t) =>
        t.person_ids.includes(personId),
      );

      const values = this.countByType(personTasks, taskTypes);

      const colorKey = `person-${personId}`;
      const color =
        (settings?.colorMap?.[colorKey] as string) ||
        TaskTypeCountSpiderMetric.DEFAULT_COLORS[
          datasets.length % TaskTypeCountSpiderMetric.DEFAULT_COLORS.length
        ];

      datasets.push({
        label: `${person.first_name} ${person.last_name}`,
        values,
        color,
      });
    }

    // --- Capabilities (averaged over all members) ---
    for (const capabilityId of capabilityIds) {
      const capability = schedule.capabilities.find(
        (c) => c.id === capabilityId,
      );
      if (!capability) continue;

      const members = schedule.people.filter((p) =>
        p.capabilities.includes(capability.machine_name),
      );
      const memberCount = Math.max(1, members.length);

      // Accumulate per-member counts then average
      const totals = new Array(taskTypes.length).fill(0);
      for (const member of members) {
        const memberTasks = schedule.tasks.filter((t) =>
          t.person_ids.includes(member.id),
        );
        const memberCounts = this.countByType(memberTasks, taskTypes);
        for (let i = 0; i < totals.length; i++) {
          totals[i] += memberCounts[i];
        }
      }

      const values = totals.map((t) => Number((t / memberCount).toFixed(2)));

      const colorKey = `capability-${capabilityId}`;
      const color =
        (settings?.colorMap?.[colorKey] as string) ||
        TaskTypeCountSpiderMetric.DEFAULT_COLORS[
          datasets.length % TaskTypeCountSpiderMetric.DEFAULT_COLORS.length
        ];

      const label =
        memberCount > 1
          ? `${capability.name} (avg, ${memberCount}p)`
          : capability.name;

      datasets.push({ label, values, color });
    }

    // If nothing selected, show overall average
    if (datasets.length === 0) {
      const allPeopleCount = Math.max(1, schedule.people.length);
      const totals = new Array(taskTypes.length).fill(0);

      for (const person of schedule.people) {
        const tasks = schedule.tasks.filter((t) =>
          t.person_ids.includes(person.id),
        );
        const counts = this.countByType(tasks, taskTypes);
        for (let i = 0; i < totals.length; i++) {
          totals[i] += counts[i];
        }
      }

      const values = totals.map((t) => Number((t / allPeopleCount).toFixed(2)));

      datasets.push({
        label:
          allPeopleCount > 1 ? `Overall (avg, ${allPeopleCount}p)` : "Overall",
        values,
        color: "#3b82f6",
      });
    }

    const chartData: RadarVisualization = {
      type: "radar",
      axes,
      datasets,
    };

    return {
      value: datasets.length,
      label: `${datasets.length} dataset(s)`,
      data: chartData,
    };
  }

  // ── helpers ──

  /**
   * For a set of tasks return an array of counts, one per task type,
   * in the same order as `taskTypes`.
   */
  private countByType(
    tasks: TaskInstance[],
    taskTypes: { id: number }[],
  ): number[] {
    return taskTypes.map(
      (tt) => tasks.filter((t) => t.task_type_id === tt.id).length,
    );
  }
}

/**
 * Task Type Hours Spider - radar chart with one axis per task type.
 *
 * Each axis shows the total working hours of that task type.
 * For individual persons the raw hours are shown.
 * For capabilities / groups the hours are averaged over ALL members who hold
 * that capability, keeping shapes comparable across individuals and groups.
 */
export class TaskTypeHoursSpiderMetric extends BaseMetric {
  config: MetricConfig = {
    id: "task_type_hours_spider",
    name: "Task Types (hours)",
    description: "Per-person radar showing working hours per task type",
    category: "distribution",
    visualization: "radar",
    supportsPersonFilter: true,
    supportsCapabilityFilter: true,
  };

  private static readonly DEFAULT_COLORS = [
    "#3b82f6",
    "#ef4444",
    "#10b981",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#84cc16",
  ];

  async calculate(
    schedule: ScheduleData,
    _filters?: MetricFilters,
    settings?: MetricSettings,
  ): Promise<MetricResult> {
    const personIds = settings?.personIds || [];
    const capabilityIds = settings?.capabilityIds || [];

    const taskTypes = schedule.taskTypes || [];
    const axes = taskTypes.map((tt) => tt.name);

    if (axes.length === 0) {
      return {
        value: 0,
        label: "No task types",
        data: { type: "radar", axes: ["-"], datasets: [] },
      };
    }

    const datasets: RadarVisualization["datasets"] = [];

    // --- Individual persons ---
    for (const personId of personIds) {
      const person = schedule.people.find((p) => p.id === personId);
      if (!person) continue;

      const personTasks = schedule.tasks.filter((t) =>
        personCountsTowardsWorkTime(t, personId),
      );

      const values = this.hoursByType(personTasks, taskTypes);

      const colorKey = `person-${personId}`;
      const color =
        (settings?.colorMap?.[colorKey] as string) ||
        TaskTypeHoursSpiderMetric.DEFAULT_COLORS[
          datasets.length % TaskTypeHoursSpiderMetric.DEFAULT_COLORS.length
        ];

      datasets.push({
        label: `${person.first_name} ${person.last_name}`,
        values,
        color,
      });
    }

    // --- Capabilities (averaged over all members) ---
    for (const capabilityId of capabilityIds) {
      const capability = schedule.capabilities.find(
        (c) => c.id === capabilityId,
      );
      if (!capability) continue;

      const members = schedule.people.filter((p) =>
        p.capabilities.includes(capability.machine_name),
      );
      const memberCount = Math.max(1, members.length);

      const totals = new Array(taskTypes.length).fill(0);
      for (const member of members) {
        const memberTasks = schedule.tasks.filter((t) =>
          personCountsTowardsWorkTime(t, member.id),
        );
        const memberHours = this.hoursByType(memberTasks, taskTypes);
        for (let i = 0; i < totals.length; i++) {
          totals[i] += memberHours[i];
        }
      }

      const values = totals.map((t) => Number((t / memberCount).toFixed(2)));

      const colorKey = `capability-${capabilityId}`;
      const color =
        (settings?.colorMap?.[colorKey] as string) ||
        TaskTypeHoursSpiderMetric.DEFAULT_COLORS[
          datasets.length % TaskTypeHoursSpiderMetric.DEFAULT_COLORS.length
        ];

      const label =
        memberCount > 1
          ? `${capability.name} (avg, ${memberCount}p)`
          : capability.name;

      datasets.push({ label, values, color });
    }

    // If nothing selected, show overall average
    if (datasets.length === 0) {
      const allPeopleCount = Math.max(1, schedule.people.length);
      const totals = new Array(taskTypes.length).fill(0);

      for (const person of schedule.people) {
        const tasks = schedule.tasks.filter((t) =>
          personCountsTowardsWorkTime(t, person.id),
        );
        const hours = this.hoursByType(tasks, taskTypes);
        for (let i = 0; i < totals.length; i++) {
          totals[i] += hours[i];
        }
      }

      const values = totals.map((t) => Number((t / allPeopleCount).toFixed(2)));

      datasets.push({
        label:
          allPeopleCount > 1 ? `Overall (avg, ${allPeopleCount}p)` : "Overall",
        values,
        color: "#3b82f6",
      });
    }

    const chartData: RadarVisualization = {
      type: "radar",
      axes,
      datasets,
    };

    return {
      value: datasets.length,
      label: `${datasets.length} dataset(s)`,
      data: chartData,
    };
  }

  // ── helpers ──

  /**
   * For a set of tasks return an array of total hours, one per task type,
   * in the same order as `taskTypes`.
   */
  private hoursByType(
    tasks: TaskInstance[],
    taskTypes: { id: number }[],
  ): number[] {
    return taskTypes.map((tt) => {
      let hours = 0;
      for (const t of tasks) {
        if (t.task_type_id === tt.id && countsTowardsWorkTime(t)) {
          hours += this.getTaskDuration(t);
        }
      }
      return Number(hours.toFixed(2));
    });
  }
}
