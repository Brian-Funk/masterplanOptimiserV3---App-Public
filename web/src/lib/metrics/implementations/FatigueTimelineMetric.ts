import { BaseMetric } from "../BaseMetric";
import {
  MetricConfig,
  MetricResult,
  ScheduleData,
  MetricFilters,
  MetricSettings,
  LineChartVisualization,
  TaskInstance,
} from "../MetricInterface";

/**
 * Fatigue Timeline - line chart of fatigue score over time.
 *
 * Uses the same fatigue model as the optimiser:
 *   task fatigue  = fatigue_score × duration_in_minutes
 *   break recovery = -3.0  per idle gap ≥ 30 min
 *
 * Two views via the Event / Day toggle:
 *
 * **Event view** (default) - x-axis = days, y = total fatigue per day.
 * **Day view** - x-axis = time of day (HH:MM), y = cumulative fatigue
 * building up through the day as tasks are completed and breaks occur.
 *
 * Supports person + capability filters.  Capabilities are averaged over all
 * members (including those with 0 tasks).
 */
export class FatigueTimelineMetric extends BaseMetric {
  config: MetricConfig = {
    id: "fatigue_timeline",
    name: "Fatigue (timeline)",
    description:
      "Fatigue score over time - event view: per-day totals, day view: intra-day accumulation",
    category: "fatigue",
    visualization: "line_chart",
    supportsPersonFilter: true,
    supportsCapabilityFilter: true,
    // hasTimeAxis intentionally NOT set - the toggle switches between
    // event-level (days on x) and day-level (hours on x) views
  };

  private static BREAK_THRESHOLD_MIN = 30;
  private static BREAK_EFFECT = -3.0;

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
    const isDayMode = settings?.timeAggregation === "day";

    if (isDayMode) {
      return this.calculateDayView(
        schedule,
        personIds,
        capabilityIds,
        settings,
      );
    }
    return this.calculateEventView(
      schedule,
      personIds,
      capabilityIds,
      settings,
    );
  }

  // ── Event view: x = days, y = fatigue per day ──

  private calculateEventView(
    schedule: ScheduleData,
    personIds: number[],
    capabilityIds: number[],
    settings?: MetricSettings,
  ): MetricResult {
    const taskTypeMap = new Map(schedule.taskTypes.map((tt) => [tt.id, tt]));

    // Collect all unique dates
    const sortedDates = this.getSortedDates(schedule);

    const lines: LineChartVisualization["lines"] = [];

    // --- Individual persons ---
    for (const personId of personIds) {
      const person = schedule.people.find((p) => p.id === personId);
      if (!person) continue;

      const points = sortedDates.map((date) => ({
        x: date,
        y: this.computeDayFatigue(schedule.tasks, personId, date, taskTypeMap),
      }));

      const colorKey = `person-${personId}`;
      const color =
        (settings?.colorMap?.[colorKey] as string) ||
        FatigueTimelineMetric.DEFAULT_COLORS[
          lines.length % FatigueTimelineMetric.DEFAULT_COLORS.length
        ];

      lines.push({
        label: `${person.first_name} ${person.last_name}`,
        points,
        color,
      });
    }

    // --- Capabilities (averaged over all members) ---
    for (const capId of capabilityIds) {
      const capability = schedule.capabilities.find((c) => c.id === capId);
      if (!capability) continue;

      const members = schedule.people.filter((p) =>
        p.capabilities.includes(capability.machine_name),
      );
      const memberCount = Math.max(1, members.length);

      const points = sortedDates.map((date) => {
        let total = 0;
        for (const member of members) {
          total += this.computeDayFatigue(
            schedule.tasks,
            member.id,
            date,
            taskTypeMap,
          );
        }
        return { x: date, y: Number((total / memberCount).toFixed(1)) };
      });

      const colorKey = `capability-${capId}`;
      const color =
        (settings?.colorMap?.[colorKey] as string) ||
        FatigueTimelineMetric.DEFAULT_COLORS[
          lines.length % FatigueTimelineMetric.DEFAULT_COLORS.length
        ];

      const label =
        memberCount > 1
          ? `${capability.name} (avg, ${memberCount}p)`
          : capability.name;

      lines.push({ label, points, color });
    }

    // --- No selection → overall average ---
    if (lines.length === 0) {
      const allPeopleCount = Math.max(1, schedule.people.length);
      const points = sortedDates.map((date) => {
        let total = 0;
        for (const person of schedule.people) {
          total += this.computeDayFatigue(
            schedule.tasks,
            person.id,
            date,
            taskTypeMap,
          );
        }
        return { x: date, y: Number((total / allPeopleCount).toFixed(1)) };
      });

      lines.push({
        label:
          allPeopleCount > 1 ? `Overall (avg, ${allPeopleCount}p)` : "Overall",
        points,
        color: "#3b82f6",
      });
    }

    const avg =
      lines[0]?.points.length > 0
        ? lines[0].points.reduce((s, p) => s + p.y, 0) / lines[0].points.length
        : 0;

    return {
      value: Number(avg.toFixed(1)),
      label: `avg ${avg.toFixed(1)}`,
      data: {
        type: "line_chart",
        lines,
        xAxisLabel: "Date",
        yAxisLabel: "Fatigue",
      },
    };
  }

  // ── Day view: x = time within day, y = cumulative fatigue ──

  private calculateDayView(
    schedule: ScheduleData,
    personIds: number[],
    capabilityIds: number[],
    settings?: MetricSettings,
  ): MetricResult {
    const taskTypeMap = new Map(schedule.taskTypes.map((tt) => [tt.id, tt]));
    const lines: LineChartVisualization["lines"] = [];

    // Determine the full time window of the day from ALL tasks so the
    // x-axis always spans the complete working period regardless of
    // which persons are selected.
    const { dayStart, dayEnd } = this.getDayBounds(schedule.tasks);

    const buildTrace = (pId: number) =>
      this.buildIntraDayTrace(
        schedule.tasks,
        pId,
        taskTypeMap,
        dayStart,
        dayEnd,
      );

    // --- Individual persons ---
    for (const personId of personIds) {
      const person = schedule.people.find((p) => p.id === personId);
      if (!person) continue;

      const colorKey = `person-${personId}`;
      const color =
        (settings?.colorMap?.[colorKey] as string) ||
        FatigueTimelineMetric.DEFAULT_COLORS[
          lines.length % FatigueTimelineMetric.DEFAULT_COLORS.length
        ];

      lines.push({
        label: `${person.first_name} ${person.last_name}`,
        points: buildTrace(personId),
        color,
      });
    }

    // --- Capabilities (averaged) ---
    for (const capId of capabilityIds) {
      const capability = schedule.capabilities.find((c) => c.id === capId);
      if (!capability) continue;

      const members = schedule.people.filter((p) =>
        p.capabilities.includes(capability.machine_name),
      );
      const memberCount = Math.max(1, members.length);

      const memberTraces = members.map((m) => buildTrace(m.id));
      const avgPoints = this.averageTraces(memberTraces, memberCount, dayStart);

      const colorKey = `capability-${capId}`;
      const color =
        (settings?.colorMap?.[colorKey] as string) ||
        FatigueTimelineMetric.DEFAULT_COLORS[
          lines.length % FatigueTimelineMetric.DEFAULT_COLORS.length
        ];

      const label =
        memberCount > 1
          ? `${capability.name} (avg, ${memberCount}p)`
          : capability.name;

      lines.push({ label, points: avgPoints, color });
    }

    // --- No selection → overall average ---
    if (lines.length === 0) {
      const allPeopleCount = Math.max(1, schedule.people.length);
      const memberTraces = schedule.people.map((p) => buildTrace(p.id));
      const avgPoints = this.averageTraces(
        memberTraces,
        allPeopleCount,
        dayStart,
      );

      lines.push({
        label:
          allPeopleCount > 1 ? `Overall (avg, ${allPeopleCount}p)` : "Overall",
        points: avgPoints,
        color: "#3b82f6",
      });
    }

    // Unify x-axis across all lines so Chart.js aligns them properly
    // (carry-forward fill instead of defaulting to 0 for missing x values)
    this.unifyXAxis(lines, dayStart);
    const xOrder = lines[0]?.points.map((point) => String(point.x)) || [];
    const xLabels = Object.fromEntries(xOrder.map((value) => [value, value]));

    const peakFatigue = lines.reduce((max, line) => {
      const lineMax = line.points.reduce((m, p) => Math.max(m, p.y), 0);
      return Math.max(max, lineMax);
    }, 0);

    return {
      value: Number(peakFatigue.toFixed(1)),
      label: `peak ${peakFatigue.toFixed(1)}`,
      data: {
        type: "line_chart",
        lines,
        xOrder,
        xLabels,
        xAxisLabel: "Time",
        yAxisLabel: "Fatigue",
      },
    };
  }

  // ── Helpers ──

  /**
   * Total fatigue for one person on one day.
   * fatigue = Σ(fatigue_score × duration_min) + breaks × BREAK_EFFECT,
   * floored at 0.
   */
  private computeDayFatigue(
    allTasks: TaskInstance[],
    personId: number,
    date: string,
    taskTypeMap: Map<number, { fatigue_score: number }>,
  ): number {
    const dayTasks = allTasks
      .filter((t) => {
        const d = t.date || new Date(t.start_time).toISOString().split("T")[0];
        return d === date && t.person_ids.includes(personId);
      })
      .sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      );

    let fatigue = 0;

    // Task fatigue
    for (const task of dayTasks) {
      const fs = taskTypeMap.get(task.task_type_id)?.fatigue_score ?? 0;
      const durMin = this.getTaskDuration(task) * 60;
      fatigue += fs * durMin;
    }

    // Break recovery
    for (let i = 1; i < dayTasks.length; i++) {
      const prevEnd = new Date(dayTasks[i - 1].end_time).getTime();
      const curStart = new Date(dayTasks[i].start_time).getTime();
      const gapMin = (curStart - prevEnd) / (1000 * 60);
      if (gapMin >= FatigueTimelineMetric.BREAK_THRESHOLD_MIN) {
        fatigue += FatigueTimelineMetric.BREAK_EFFECT;
      }
    }

    return Math.max(0, Number(fatigue.toFixed(1)));
  }

  /**
   * Build an intra-day cumulative fatigue trace for one person.
   * Always spans from `dayStart` to `dayEnd` so the chart covers the
   * full working period.  Periods with no task activity produce a flat
   * line at the current fatigue level.
   */
  private buildIntraDayTrace(
    tasks: TaskInstance[],
    personId: number,
    taskTypeMap: Map<number, { fatigue_score: number }>,
    dayStart: string,
    dayEnd: string,
  ): Array<{ x: string; y: number }> {
    const personTasks = tasks
      .filter((t) => t.person_ids.includes(personId))
      .sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      );

    const points: Array<{ x: string; y: number }> = [];
    let cumFatigue = 0;

    // Anchor at start of day
    points.push({ x: dayStart, y: 0 });

    for (let i = 0; i < personTasks.length; i++) {
      const task = personTasks[i];

      // Check for break before this task
      if (i > 0) {
        const prevEnd = new Date(personTasks[i - 1].end_time).getTime();
        const curStart = new Date(task.start_time).getTime();
        const gapMin = (curStart - prevEnd) / (1000 * 60);
        if (gapMin >= FatigueTimelineMetric.BREAK_THRESHOLD_MIN) {
          cumFatigue = Math.max(
            0,
            cumFatigue + FatigueTimelineMetric.BREAK_EFFECT,
          );
        }
      }

      // Point at task start (fatigue before this task is processed)
      const startTime = this.formatTime(task.start_time);
      points.push({ x: startTime, y: Number(cumFatigue.toFixed(1)) });

      // Add task fatigue
      const fs = taskTypeMap.get(task.task_type_id)?.fatigue_score ?? 0;
      const durMin = this.getTaskDuration(task) * 60;
      cumFatigue += fs * durMin;

      // Point at task end (fatigue after this task)
      const endTime = this.formatTime(task.end_time);
      points.push({ x: endTime, y: Number(cumFatigue.toFixed(1)) });
    }

    // Anchor at end of day (flat line from last event to day end)
    points.push({ x: dayEnd, y: Number(cumFatigue.toFixed(1)) });

    return points;
  }

  /**
   * Determine the full time window of the day from all tasks.
   * Returns the earliest start and latest end as "HH:MM" strings.
   */
  private getDayBounds(tasks: TaskInstance[]): {
    dayStart: string;
    dayEnd: string;
  } {
    if (tasks.length === 0) return { dayStart: "06:00", dayEnd: "22:00" };

    let minTask: TaskInstance | null = null;
    let maxTask: TaskInstance | null = null;
    let minTime = Number.POSITIVE_INFINITY;
    let maxTime = Number.NEGATIVE_INFINITY;

    for (const t of tasks) {
      const start = new Date(t.start_time).getTime();
      const end = new Date(t.end_time).getTime();
      if (Number.isFinite(start) && start < minTime) {
        minTime = start;
        minTask = t;
      }
      if (Number.isFinite(end) && end > maxTime) {
        maxTime = end;
        maxTask = t;
      }
    }

    return {
      dayStart: minTask ? this.formatTime(minTask.start_time) : "06:00",
      dayEnd: maxTask ? this.formatTime(maxTask.end_time) : "22:00",
    };
  }

  /**
   * Extract "HH:MM" from an ISO datetime string (avoids timezone issues
   * by parsing the string directly rather than going through Date).
   */
  private formatTime(isoDateTime: string): string {
    const timePart = isoDateTime.split("T")[1];
    if (!timePart) return "00:00";
    return timePart.substring(0, 5); // "HH:MM"
  }

  /**
   * Average multiple intra-day traces.
   * Unifies the x-axis across all traces using carry-forward fill, then
   * averages the y values at each time point.
   */
  private averageTraces(
    traces: Array<Array<{ x: string; y: number }>>,
    divisor: number,
    dayStart: string,
  ): Array<{ x: string; y: number }> {
    // Collect all unique x values
    const allX = new Set<string>();
    for (const trace of traces) {
      for (const p of trace) allX.add(p.x);
    }
    const sortedX = this.sortTimeLabels(Array.from(allX), dayStart);

    if (sortedX.length === 0) return [];

    // For each trace, carry-forward fill to all x values
    const filled = traces.map((trace) => {
      const pMap = new Map(trace.map((p) => [p.x, p.y]));
      let lastVal = 0;
      return sortedX.map((x) => {
        if (pMap.has(x)) lastVal = pMap.get(x)!;
        return lastVal;
      });
    });

    // Point-wise average
    return sortedX.map((x, xi) => {
      let sum = 0;
      for (const f of filled) sum += f[xi];
      return { x, y: Number((sum / divisor).toFixed(1)) };
    });
  }

  /**
   * Ensure all lines share the same x values using carry-forward fill.
   * This prevents Chart.js from filling missing points with 0 (the default
   * in MetricCard's chartData memo).
   * Mutates the lines' points arrays in place.
   */
  private unifyXAxis(
    lines: LineChartVisualization["lines"],
    dayStart: string,
  ): void {
    const allX = new Set<string>();
    for (const line of lines) {
      for (const p of line.points) allX.add(String(p.x));
    }
    const sortedX = this.sortTimeLabels(Array.from(allX), dayStart);

    if (sortedX.length === 0) return;

    for (const line of lines) {
      const pMap = new Map(line.points.map((p) => [String(p.x), p.y]));
      let lastVal = 0;
      line.points = sortedX.map((x) => {
        if (pMap.has(x)) lastVal = pMap.get(x)!;
        return { x, y: lastVal };
      });
    }
  }

  private sortTimeLabels(values: string[], dayStart: string): string[] {
    const startMinutes = this.timeLabelToMinutes(dayStart) ?? 0;
    return [...values].sort(
      (a, b) =>
        this.linearMinutesFromStart(a, startMinutes) -
        this.linearMinutesFromStart(b, startMinutes),
    );
  }

  private linearMinutesFromStart(value: string, startMinutes: number): number {
    const minutes = this.timeLabelToMinutes(value) ?? 0;
    return minutes < startMinutes ? minutes + 1440 : minutes;
  }

  private timeLabelToMinutes(value: string): number | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (minutes < 0 || minutes > 59 || hours < 0 || hours > 24) return null;
    return hours * 60 + minutes;
  }
}
