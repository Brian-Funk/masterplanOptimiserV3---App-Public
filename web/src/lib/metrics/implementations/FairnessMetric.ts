import { BaseMetric } from "../BaseMetric";
import {
  MetricConfig,
  MetricResult,
  ScheduleData,
  MetricFilters,
  LineChartVisualization,
  MetricSettings,
} from "../MetricInterface";
import {
  countsTowardsWorkTime,
  personCountsTowardsWorkTime,
} from "../metricScheduleData";

/**
 * Fairness Metric - standard deviation of total working hours across people.
 *
 * A lower value means work is distributed more evenly; a higher value signals
 * imbalance.  Shown as a line chart over time (one point per day).
 *
 * Supports capability filters only (not individual persons) - the interesting
 * question is how fair the schedule is within a subgroup.  When multiple
 * capabilities are selected each gets its own line so you can compare fairness
 * across different teams.  When nothing is selected the full schedule
 * population is used.
 *
 * Each data-point is the std-dev of per-person working hours on that day.
 * People with zero hours on a given day still count toward the calculation
 * (they pull the std-dev up, correctly reflecting that some people had no work).
 */
export class FairnessMetric extends BaseMetric {
  config: MetricConfig = {
    id: "fairness",
    name: "Fairness (standard deviation)",
    description:
      "Standard deviation of working hours across people - lower is fairer",
    category: "distribution",
    visualization: "line_chart",
    supportsPersonFilter: false,
    supportsCapabilityFilter: true,
    hasTimeAxis: true,
  };

  private static DEFAULT_COLORS = [
    "#f59e0b",
    "#3b82f6",
    "#ef4444",
    "#10b981",
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
    const capabilityIds = settings?.capabilityIds || [];

    // Collect all unique dates in the schedule
    const sortedDates = this.getSortedDates(schedule);

    const lines: LineChartVisualization["lines"] = [];

    if (capabilityIds.length > 0) {
      // One line per capability - std-dev within that capability's members
      for (let ci = 0; ci < capabilityIds.length; ci++) {
        const capability = schedule.capabilities.find(
          (c) => c.id === capabilityIds[ci],
        );
        if (!capability) continue;

        const members = schedule.people.filter((p) =>
          p.capabilities.includes(capability.machine_name),
        );
        if (members.length === 0) continue;

        const memberIds = members.map((m) => m.id);
        const points = this.computeStdDevLine(schedule, sortedDates, memberIds);

        const colorKey = `capability-${capabilityIds[ci]}`;
        const color =
          (settings?.colorMap?.[colorKey] as string) ||
          FairnessMetric.DEFAULT_COLORS[
            ci % FairnessMetric.DEFAULT_COLORS.length
          ];

        lines.push({
          label: `${capability.name} (${members.length}p)`,
          points,
          color,
        });
      }
    } else {
      // No selection → overall fairness across all people
      const allIds = schedule.people.map((p) => p.id);
      const points = this.computeStdDevLine(schedule, sortedDates, allIds);

      const color = (settings?.colorMap?.["fairness"] as string) || "#f59e0b";

      lines.push({
        label: `Std Dev (all, ${allIds.length}p)`,
        points,
        color,
      });
    }

    // Overall summary: average std-dev of the first (or only) line
    const primaryPoints = lines[0]?.points || [];
    const avgSd =
      primaryPoints.length > 0
        ? primaryPoints.reduce((s, p) => s + p.y, 0) / primaryPoints.length
        : 0;

    const chartData: LineChartVisualization = {
      type: "line_chart",
      lines,
      xAxisLabel: "Date",
      yAxisLabel: "Std Dev (hours)",
    };

    return {
      value: Number(avgSd.toFixed(3)),
      label:
        lines.length === 1
          ? `σ ${avgSd.toFixed(2)} hrs`
          : `${lines.length} groups`,
      data: chartData,
    };
  }

  // ── helpers ──

  /**
   * Compute std-dev of per-person hours for each date.
   */
  private computeStdDevLine(
    schedule: ScheduleData,
    sortedDates: string[],
    populationIds: number[],
  ): Array<{ x: string; y: number }> {
    return sortedDates.map((date) => {
      const dayTasks = schedule.tasks.filter((t) => {
        const d = t.date || new Date(t.start_time).toISOString().split("T")[0];
        return countsTowardsWorkTime(t) && d === date;
      });

      const hoursPerPerson = populationIds.map((pid) => {
        let total = 0;
        for (const task of dayTasks) {
          if (personCountsTowardsWorkTime(task, pid)) {
            total += this.getTaskDuration(task);
          }
        }
        return total;
      });

      return { x: date, y: Number(this.stdDev(hoursPerPerson).toFixed(3)) };
    });
  }

  /**
   * Population standard deviation.
   */
  private stdDev(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance =
      values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }
}
