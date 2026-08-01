import { BaseMetric } from "../BaseMetric";
import {
  MetricConfig,
  MetricResult,
  ScheduleData,
  MetricFilters,
  LineChartVisualization,
  MetricSettings,
  TaskInstance,
} from "../MetricInterface";
import { countsTowardsWorkTime } from "../metricScheduleData";

/**
 * Max Continuous Work Streak - line chart showing the longest unbroken run
 * of work per person per day.
 *
 * Two consecutive tasks are considered part of the same streak when the gap
 * between the end of the first and the start of the next is ≤ 15 minutes
 * (overlapping tasks are always merged).
 *
 * **Person lines** show the individual's longest streak each day (hours).
 * **Capability lines** average the per-member max streaks (including members
 * with 0 tasks, whose max streak is 0).
 * **Overall** (no filter) averages across all persons.
 *
 * `hasTimeAxis: true` - days are on the x-axis so the Event/Day toggle is
 * hidden (filtering to a single day would leave only one data-point).
 */
export class MaxWorkStreakMetric extends BaseMetric {
  config: MetricConfig = {
    id: "max_work_streak",
    name: "Max Work Streak (hours)",
    description:
      "Longest continuous work stretch per person per day - gaps ≤ 15 min are merged",
    category: "fatigue",
    visualization: "line_chart",
    supportsPersonFilter: true,
    supportsCapabilityFilter: true,
    hasTimeAxis: true,
  };

  /** Gaps of at most this many minutes are still considered "continuous" */
  private static GAP_THRESHOLD_MIN = 15;

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

  // ─── public API ───────────────────────────────────────────────────────

  async calculate(
    schedule: ScheduleData,
    _filters?: MetricFilters,
    settings?: MetricSettings,
  ): Promise<MetricResult> {
    const personIds = settings?.personIds || [];
    const capabilityIds = settings?.capabilityIds || [];

    // Collect and sort all dates that appear in the schedule
    const allDates = this.getSortedDates(schedule);

    if (personIds.length === 0 && capabilityIds.length === 0) {
      return this.calculateOverall(schedule, allDates);
    }

    const lines: LineChartVisualization["lines"] = [];

    // ── person lines ────────────────────────────────────────────────────
    if (personIds.length > 0) {
      for (const personId of personIds) {
        const person = schedule.people.find((p) => p.id === personId);
        if (!person) continue;

        const personTasks = schedule.tasks.filter((t) =>
          t.person_ids.includes(personId),
        );
        const points = allDates.map((date) => ({
          x: date,
          y: this.maxStreakForDay(personTasks, date),
        }));

        const colorKey = `person-${personId}`;
        const color =
          (settings?.colorMap?.[colorKey] as string) ||
          MaxWorkStreakMetric.DEFAULT_COLORS[
            lines.length % MaxWorkStreakMetric.DEFAULT_COLORS.length
          ];

        lines.push({
          label: `${person.first_name} ${person.last_name}`,
          points,
          color,
        });
      }
    }

    // ── capability lines (average of members' max streaks) ──────────────
    if (capabilityIds.length > 0) {
      for (let ci = 0; ci < capabilityIds.length; ci++) {
        const capability = schedule.capabilities.find(
          (c) => c.id === capabilityIds[ci],
        );
        if (!capability) continue;

        const members = schedule.people.filter((p) =>
          p.capabilities.includes(capability.machine_name),
        );
        if (members.length === 0) continue;

        const points = allDates.map((date) => {
          const sum = members.reduce((acc, member) => {
            const tasks = schedule.tasks.filter((t) =>
              t.person_ids.includes(member.id),
            );
            return acc + this.maxStreakForDay(tasks, date);
          }, 0);
          return {
            x: date,
            y: Number((sum / members.length).toFixed(2)),
          };
        });

        const colorKey = `capability-${capabilityIds[ci]}`;
        const color =
          (settings?.colorMap?.[colorKey] as string) ||
          MaxWorkStreakMetric.DEFAULT_COLORS[
            lines.length % MaxWorkStreakMetric.DEFAULT_COLORS.length
          ];

        lines.push({
          label: `${capability.name} (avg, ${members.length}p)`,
          points,
          color,
        });
      }
    }

    return this.buildResult(lines);
  }

  // ─── overall (no filter) ──────────────────────────────────────────────

  private calculateOverall(
    schedule: ScheduleData,
    allDates: string[],
  ): MetricResult {
    const personCount = Math.max(1, schedule.people.length);

    const points = allDates.map((date) => {
      const sum = schedule.people.reduce((acc, person) => {
        const tasks = schedule.tasks.filter((t) =>
          t.person_ids.includes(person.id),
        );
        return acc + this.maxStreakForDay(tasks, date);
      }, 0);
      return {
        x: date,
        y: Number((sum / personCount).toFixed(2)),
      };
    });

    const avgStreak =
      points.length > 0
        ? points.reduce((s, p) => s + p.y, 0) / points.length
        : 0;

    const chartData: LineChartVisualization = {
      type: "line_chart",
      lines: [
        {
          label: `Avg Max Streak (${personCount}p)`,
          points,
          color: "#3b82f6",
        },
      ],
      xAxisLabel: "Date",
      yAxisLabel: "Hours",
    };

    return {
      value: Number(avgStreak.toFixed(2)),
      label: `${avgStreak.toFixed(1)} hrs avg streak`,
      data: chartData,
    };
  }

  // ─── helpers ──────────────────────────────────────────────────────────

  /**
   * Return the longest continuous work streak (hours) for the given task
   * set on a specific day.  Tasks that overlap or are separated by ≤ 15 min
   * are merged into a single streak.
   */
  private maxStreakForDay(tasks: TaskInstance[], date: string): number {
    // Filter to the target day and sort chronologically
    const dayTasks = tasks
      .filter(
        (t) =>
          countsTowardsWorkTime(t) &&
          (t.date || new Date(t.start_time).toISOString().split("T")[0]) ===
          date,
      )
      .sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      );

    if (dayTasks.length === 0) return 0;

    // Walk through sorted tasks, merging overlapping / close ones into streaks
    let maxStreakMs = 0;
    let streakStart = new Date(dayTasks[0].start_time).getTime();
    let streakEnd = new Date(dayTasks[0].end_time).getTime();

    for (let i = 1; i < dayTasks.length; i++) {
      const taskStart = new Date(dayTasks[i].start_time).getTime();
      const taskEnd = new Date(dayTasks[i].end_time).getTime();
      const gapMin = (taskStart - streakEnd) / (1000 * 60);

      if (gapMin <= MaxWorkStreakMetric.GAP_THRESHOLD_MIN) {
        // Merge into the current streak
        streakEnd = Math.max(streakEnd, taskEnd);
      } else {
        // Close previous streak, start a new one
        maxStreakMs = Math.max(maxStreakMs, streakEnd - streakStart);
        streakStart = taskStart;
        streakEnd = taskEnd;
      }
    }

    // Close final streak
    maxStreakMs = Math.max(maxStreakMs, streakEnd - streakStart);

    return Number((maxStreakMs / (1000 * 60 * 60)).toFixed(2));
  }

  /**
   * Collect all unique dates from the task list, sorted ascending.
   */
  private collectSortedDates(tasks: TaskInstance[]): string[] {
    const dates = new Set<string>();
    for (const t of tasks) {
      dates.add(t.date || new Date(t.start_time).toISOString().split("T")[0]);
    }
    return Array.from(dates).sort();
  }

  /**
   * Build a MetricResult from the computed lines.
   */
  private buildResult(lines: LineChartVisualization["lines"]): MetricResult {
    // Use the peak value across all lines as the summary
    let peak = 0;
    for (const line of lines) {
      for (const pt of line.points) {
        if (pt.y > peak) peak = pt.y;
      }
    }

    const chartData: LineChartVisualization = {
      type: "line_chart",
      lines,
      xAxisLabel: "Date",
      yAxisLabel: "Hours",
    };

    return {
      value: peak,
      label:
        lines.length === 1
          ? `${peak.toFixed(1)} hrs peak streak`
          : `${lines.length} lines, ${peak.toFixed(1)} hrs peak`,
      data: chartData,
    };
  }
}
