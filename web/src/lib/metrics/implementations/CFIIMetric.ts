import { BaseMetric } from "../BaseMetric";
import {
  MetricConfig,
  MetricResult,
  ScheduleData,
  MetricFilters,
  MetricSettings,
  HeatmapVisualization,
  TaskInstance,
} from "../MetricInterface";

/**
 * Cumulative Fatigue Imbalance Index (CFII)
 *
 * Measures how much a person's fatigue **exceeds** the group average at each
 * time step, highlighting who is disadvantaged and when.
 *
 *   CFII(p, t) = FRS(p, t) − mean(FRS(*, t))
 *
 * Positive → disadvantaged (more fatigue than peers)
 * Zero     → balanced
 * Negative → advantaged
 *
 * Fatigue Risk Score (FRS) per person per day uses the same optimiser model:
 *   task fatigue  = fatigue_score × duration_in_minutes
 *   break recovery = -3.0  per idle gap ≥ 30 min
 *   floor at 0
 *
 * Primary visualization: **diverging heatmap** (rows = people, columns = days)
 *   Red  → significantly disadvantaged
 *   White → balanced
 *   Blue → advantaged
 *
 * `hasTimeAxis: true` - days are on the x-axis so the Event / Day toggle is
 * hidden.
 */
export class CFIIMetric extends BaseMetric {
  config: MetricConfig = {
    id: "cfii",
    name: "Fatigue Imbalance (CFII)",
    description:
      "How much each person's fatigue deviates from the group average - red = disadvantaged, blue = advantaged",
    category: "fatigue",
    visualization: "heatmap",
    supportsPersonFilter: false,
    supportsCapabilityFilter: false,
    hasTimeAxis: true,
  };

  private static BREAK_THRESHOLD_MIN = 30;
  private static BREAK_EFFECT = -3.0;

  async calculate(
    schedule: ScheduleData,
    _filters?: MetricFilters,
    _settings?: MetricSettings,
  ): Promise<MetricResult> {
    const taskTypeMap = new Map(schedule.taskTypes.map((tt) => [tt.id, tt]));

    // ── Collect all unique dates ───────────────────────────────────────
    const sortedDates = this.getSortedDates(schedule);

    // ── Compute FRS(person, day) ───────────────────────────────────────
    // fatigue[personId][date] = number
    const frs = new Map<number, Map<string, number>>();

    for (const person of schedule.people) {
      const personFrs = new Map<string, number>();

      for (const date of sortedDates) {
        const dayTasks = schedule.tasks
          .filter((t) => {
            const d =
              t.date || new Date(t.start_time).toISOString().split("T")[0];
            return d === date && t.person_ids.includes(person.id);
          })
          .sort(
            (a, b) =>
              new Date(a.start_time).getTime() -
              new Date(b.start_time).getTime(),
          );

        let fatigue = 0;

        // Sum task fatigue
        for (const task of dayTasks) {
          const tt = taskTypeMap.get(task.task_type_id);
          const fatigueScore = tt?.fatigue_score ?? 0;
          const durationMin = this.getTaskDuration(task) * 60;
          fatigue += fatigueScore * durationMin;
        }

        // Break recovery
        for (let i = 1; i < dayTasks.length; i++) {
          const prevEnd = new Date(dayTasks[i - 1].end_time).getTime();
          const curStart = new Date(dayTasks[i].start_time).getTime();
          const gapMin = (curStart - prevEnd) / (1000 * 60);
          if (gapMin >= CFIIMetric.BREAK_THRESHOLD_MIN) {
            fatigue += CFIIMetric.BREAK_EFFECT;
          }
        }

        personFrs.set(date, Math.max(0, fatigue));
      }

      frs.set(person.id, personFrs);
    }

    // ── Compute mean FRS per day ───────────────────────────────────────
    const meanFrs = new Map<string, number>();
    const personCount = schedule.people.length || 1;

    for (const date of sortedDates) {
      let sum = 0;
      for (const person of schedule.people) {
        sum += frs.get(person.id)?.get(date) ?? 0;
      }
      meanFrs.set(date, sum / personCount);
    }

    // ── Build heatmap data: CFII = FRS(p,d) - mean(FRS(*,d)) ──────────
    const heatmapData: HeatmapVisualization["data"] = [];
    let worstCfii = 0;
    let cumulativeMax = 0;
    let cumulativeMaxPerson = "";

    // Track cumulative positive CFII per person for the summary
    const cumulativePositive = new Map<number, number>();

    for (const person of schedule.people) {
      let cumPos = 0;
      const displayName =
        person.first_name && person.last_name
          ? `${person.first_name} ${person.last_name}`
          : person.name;

      for (const date of sortedDates) {
        const personFrs = frs.get(person.id)?.get(date) ?? 0;
        const mean = meanFrs.get(date) ?? 0;
        const cfii = Number((personFrs - mean).toFixed(1));

        heatmapData.push({ x: date, y: displayName, value: cfii });

        if (cfii > worstCfii) worstCfii = cfii;
        if (cfii > 0) cumPos += cfii;
      }

      cumulativePositive.set(person.id, cumPos);
      if (cumPos > cumulativeMax) {
        cumulativeMax = cumPos;
        cumulativeMaxPerson = displayName;
      }
    }

    const chartData: HeatmapVisualization = {
      type: "heatmap",
      data: heatmapData,
      xOrder: sortedDates,
      xLabels: Object.fromEntries(
        sortedDates.map((date) => [date, schedule.dayAliases[date] || date]),
      ),
      colorScale: "diverging",
    };

    return {
      value: Number(worstCfii.toFixed(1)),
      label: cumulativeMaxPerson
        ? `${cumulativeMaxPerson} +${cumulativeMax.toFixed(0)}`
        : `peak ${worstCfii.toFixed(1)}`,
      data: chartData,
    };
  }
}
