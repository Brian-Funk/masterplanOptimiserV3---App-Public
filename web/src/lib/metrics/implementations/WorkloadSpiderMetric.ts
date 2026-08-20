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
 * Workload Spider Graph - per-person multi-dimensional radar chart.
 *
 * Axes:
 *   1. Assignments  - number of task assignments
 *   2. Working Hours - total hours of work
 *   3. Breaks        - number of gaps between consecutive tasks on the same day
 *
 * For individual persons the raw values are shown.
 * For capabilities / groups the values are averaged over ALL persons who hold
 * that capability (including those with 0 assignments), so the shapes are
 * directly comparable to individual entries.
 *
 * Values are normalised to 0-100 across all datasets so the radar stays
 * readable regardless of absolute scale.
 */
export class WorkloadSpiderMetric extends BaseMetric {
  config: MetricConfig = {
    id: "workload_spider",
    name: "Workload Spider (hours / amount / breaks)",
    description:
      "Per-person radar comparing assignments, working hours, and breaks",
    category: "workload",
    visualization: "radar",
    supportsPersonFilter: true,
    supportsCapabilityFilter: true,
  };

  private static AXES = ["Assignments", "Working Hours", "Breaks"];

  private static DEFAULT_COLORS = [
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

    const datasets: RadarVisualization["datasets"] = [];

    // --- Individual persons ---
    for (const personId of personIds) {
      const person = schedule.people.find((p) => p.id === personId);
      if (!person) continue;

      const personTasks = schedule.tasks.filter((t) =>
        t.person_ids.includes(personId),
      );

      const stats = this.computeStats(personTasks, personId);

      const colorKey = `person-${personId}`;
      const color =
        (settings?.colorMap?.[colorKey] as string) ||
        WorkloadSpiderMetric.DEFAULT_COLORS[
          datasets.length % WorkloadSpiderMetric.DEFAULT_COLORS.length
        ];

      datasets.push({
        label: `${person.first_name} ${person.last_name}`,
        values: [stats.assignments, stats.hours, stats.breaks],
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

      // Sum person-hours style: iterate per member, accumulate, then average
      let totalAssignments = 0;
      let totalHours = 0;
      let totalBreaks = 0;

      for (const member of members) {
        const memberTasks = schedule.tasks.filter((t) =>
          t.person_ids.includes(member.id),
        );
        const stats = this.computeStats(memberTasks, member.id);
        totalAssignments += stats.assignments;
        totalHours += stats.hours;
        totalBreaks += stats.breaks;
      }

      const colorKey = `capability-${capabilityId}`;
      const color =
        (settings?.colorMap?.[colorKey] as string) ||
        WorkloadSpiderMetric.DEFAULT_COLORS[
          datasets.length % WorkloadSpiderMetric.DEFAULT_COLORS.length
        ];

      const label =
        memberCount > 1
          ? `${capability.name} (avg, ${memberCount}p)`
          : capability.name;

      datasets.push({
        label,
        values: [
          Number((totalAssignments / memberCount).toFixed(2)),
          Number((totalHours / memberCount).toFixed(2)),
          Number((totalBreaks / memberCount).toFixed(2)),
        ],
        color,
      });
    }

    // If nothing selected, show overall average
    if (datasets.length === 0) {
      const allPeopleCount = Math.max(1, schedule.people.length);
      let totalAssignments = 0;
      let totalHours = 0;
      let totalBreaks = 0;

      for (const person of schedule.people) {
        const tasks = schedule.tasks.filter((t) =>
          t.person_ids.includes(person.id),
        );
        const stats = this.computeStats(tasks, person.id);
        totalAssignments += stats.assignments;
        totalHours += stats.hours;
        totalBreaks += stats.breaks;
      }

      datasets.push({
        label:
          allPeopleCount > 1 ? `Overall (avg, ${allPeopleCount}p)` : "Overall",
        values: [
          Number((totalAssignments / allPeopleCount).toFixed(2)),
          Number((totalHours / allPeopleCount).toFixed(2)),
          Number((totalBreaks / allPeopleCount).toFixed(2)),
        ],
        color: "#3b82f6",
      });
    }

    const chartData: RadarVisualization = {
      type: "radar",
      axes: WorkloadSpiderMetric.AXES,
      datasets,
    };

    return {
      value: datasets.length,
      label: `${datasets.length} dataset(s)`,
      data: chartData,
    };
  }

  // ── helpers ──

  private computeStats(tasks: TaskInstance[], personId: number): {
    assignments: number;
    hours: number;
    breaks: number;
  } {
    const assignments = tasks.length;

    let hours = 0;
    for (const task of tasks) {
      if (!personCountsTowardsWorkTime(task, personId)) continue;
      hours += this.getTaskDuration(task);
    }
    hours = Number(hours.toFixed(2));

    // Breaks = gaps between consecutive tasks on the same day
    const breaks = this.countBreaks(tasks.filter(countsTowardsWorkTime));

    return { assignments, hours, breaks };
  }

  /**
   * Count the number of inter-task gaps per day.
   * For each day, sort tasks by start time and count how many pairs of
   * consecutive tasks have a gap (task[i].end < task[i+1].start).
   */
  private countBreaks(tasks: TaskInstance[]): number {
    // Group by date
    const byDay = new Map<string, TaskInstance[]>();
    for (const task of tasks) {
      const date =
        task.date || new Date(task.start_time).toISOString().split("T")[0];
      if (!byDay.has(date)) byDay.set(date, []);
      byDay.get(date)!.push(task);
    }

    let breakCount = 0;
    for (const dayTasks of byDay.values()) {
      // Sort by start time
      dayTasks.sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      );
      for (let i = 0; i < dayTasks.length - 1; i++) {
        const endCurrent = new Date(dayTasks[i].end_time).getTime();
        const startNext = new Date(dayTasks[i + 1].start_time).getTime();
        if (startNext > endCurrent) {
          breakCount++;
        }
      }
    }
    return breakCount;
  }
}
