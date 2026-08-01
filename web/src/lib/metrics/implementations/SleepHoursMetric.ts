import { BaseMetric } from "../BaseMetric";
import {
  LineChartVisualization,
  MetricConfig,
  MetricFilters,
  MetricResult,
  MetricSettings,
  ScheduleData,
} from "../MetricInterface";
import {
  countsTowardsWorkTime,
  parseMetricTimeToMinutes,
} from "../metricScheduleData";

type SleepAggregation = "average" | "minimum";
type SleepHoursByDate = Map<string, number>;
type SleepHoursByPerson = Map<number, SleepHoursByDate>;

const DEFAULT_LINE_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
];

function roundHours(value: number): number {
  return Number(value.toFixed(2));
}

function wallClockMinutes(value: string): number | null {
  const date = value.slice(0, 10);
  const minutes = parseMetricTimeToMinutes(value);
  const dayStart = Date.parse(`${date}T00:00:00Z`);
  if (!date || minutes === null || !Number.isFinite(dayStart)) return null;
  return dayStart / 60000 + minutes;
}

function personName(person: ScheduleData["people"][number]): string {
  return (
    [person.first_name, person.last_name].filter(Boolean).join(" ").trim() ||
    person.name ||
    `Person ${person.id}`
  );
}

function calculateSleepByPerson(schedule: ScheduleData): SleepHoursByPerson {
  const result: SleepHoursByPerson = new Map();

  for (const person of schedule.people) {
    const boundariesByDay = new Map<
      string,
      { firstStart: number; lastEnd: number }
    >();

    for (const task of schedule.tasks) {
      if (!countsTowardsWorkTime(task)) continue;
      if (!task.person_ids.includes(person.id)) continue;
      const start = wallClockMinutes(task.start_time);
      const end = wallClockMinutes(task.end_time);
      if (start === null || end === null) continue;

      const date = task.date || task.start_time.slice(0, 10);
      const current = boundariesByDay.get(date);
      if (current) {
        current.firstStart = Math.min(current.firstStart, start);
        current.lastEnd = Math.max(current.lastEnd, end);
      } else {
        boundariesByDay.set(date, { firstStart: start, lastEnd: end });
      }
    }

    const scheduledDates = Array.from(boundariesByDay.keys()).sort();
    const sleepByDate: SleepHoursByDate = new Map();
    for (let index = 1; index < scheduledDates.length; index += 1) {
      const previous = boundariesByDay.get(scheduledDates[index - 1]);
      const current = boundariesByDay.get(scheduledDates[index]);
      if (!previous || !current) continue;
      const hours = Math.max(0, (current.firstStart - previous.lastEnd) / 60);
      sleepByDate.set(scheduledDates[index], roundHours(hours));
    }
    result.set(person.id, sleepByDate);
  }

  return result;
}

abstract class SleepHoursMetricBase extends BaseMetric {
  abstract config: MetricConfig;
  protected abstract aggregation: SleepAggregation;

  async calculate(
    schedule: ScheduleData,
    _filters?: MetricFilters,
    settings?: MetricSettings,
  ): Promise<MetricResult> {
    const personIds = Array.from(new Set(settings?.personIds || []));
    const capabilityIds = Array.from(new Set(settings?.capabilityIds || []));
    const sleepByPerson = calculateSleepByPerson(schedule);
    const sleepDates = this.getSleepDates(schedule, sleepByPerson);
    const lines: LineChartVisualization["lines"] = [];

    for (const personId of personIds) {
      const person = schedule.people.find((entry) => entry.id === personId);
      if (!person) continue;
      lines.push(
        this.buildLine(
          personName(person),
          sleepByPerson.get(personId) || new Map(),
          sleepDates,
          this.getColour(settings, `person-${personId}`, lines.length),
        ),
      );
    }

    for (const capabilityId of capabilityIds) {
      const capability = schedule.capabilities.find(
        (entry) => entry.id === capabilityId,
      );
      if (!capability) continue;
      const memberIds = schedule.people
        .filter((person) =>
          person.capabilities.includes(capability.machine_name),
        )
        .map((person) => person.id);
      if (memberIds.length === 0) continue;

      const groupHours = this.aggregateMembers(
        memberIds,
        sleepByPerson,
        sleepDates,
      );
      const modeLabel = this.aggregation === "minimum" ? "min" : "avg";
      lines.push(
        this.buildLine(
          `${capability.name} (${modeLabel}, ${memberIds.length}p)`,
          groupHours,
          sleepDates,
          this.getColour(
            settings,
            `capability-${capabilityId}`,
            lines.length,
          ),
        ),
      );
    }

    if (personIds.length === 0 && capabilityIds.length === 0) {
      const allPersonIds = schedule.people.map((person) => person.id);
      const overallHours = this.aggregateMembers(
        allPersonIds,
        sleepByPerson,
        sleepDates,
      );
      const lineLabel =
        this.aggregation === "minimum"
          ? `Minimum sleep (all, ${allPersonIds.length}p)`
          : `Average sleep (all, ${allPersonIds.length}p)`;
      lines.push(
        this.buildLine(
          lineLabel,
          overallHours,
          sleepDates,
          this.getColour(settings, "sleep-overall", 0),
        ),
      );
    }

    return this.buildResult(lines, sleepDates);
  }

  private getSleepDates(
    schedule: ScheduleData,
    sleepByPerson: SleepHoursByPerson,
  ): string[] {
    const dates = new Set(this.getSortedDates(schedule).slice(1));
    for (const personHours of sleepByPerson.values()) {
      for (const date of personHours.keys()) dates.add(date);
    }
    return Array.from(dates).sort();
  }

  private aggregateMembers(
    memberIds: number[],
    sleepByPerson: SleepHoursByPerson,
    dates: string[],
  ): SleepHoursByDate {
    const result: SleepHoursByDate = new Map();
    for (const date of dates) {
      const values = memberIds.flatMap((personId) => {
        const value = sleepByPerson.get(personId)?.get(date);
        return value === undefined ? [] : [value];
      });
      if (values.length === 0) continue;
      const value =
        this.aggregation === "minimum"
          ? Math.min(...values)
          : values.reduce((sum, hours) => sum + hours, 0) / values.length;
      result.set(date, roundHours(value));
    }
    return result;
  }

  private buildLine(
    label: string,
    values: SleepHoursByDate,
    dates: string[],
    color: string,
  ): LineChartVisualization["lines"][number] {
    return {
      label,
      points: dates.flatMap((date) => {
        const value = values.get(date);
        return value === undefined ? [] : [{ x: date, y: value }];
      }),
      missingPoints: dates.filter((date) => !values.has(date)),
      color,
    };
  }

  private buildResult(
    lines: LineChartVisualization["lines"],
    dates: string[],
  ): MetricResult {
    const values = lines.flatMap((line) => line.points.map((point) => point.y));
    const value =
      values.length === 0
        ? 0
        : this.aggregation === "minimum"
          ? Math.min(...values)
          : values.reduce((sum, hours) => sum + hours, 0) / values.length;
    const label =
      values.length === 0
        ? "No sleep intervals"
        : this.aggregation === "minimum"
          ? `${value.toFixed(1)} hrs minimum`
          : `${value.toFixed(1)} hrs avg sleep`;

    return {
      value: roundHours(value),
      label,
      data: {
        type: "line_chart",
        lines,
        xOrder: dates,
        xAxisLabel: "Day",
        yAxisLabel: "Sleep (hours)",
      },
    };
  }

  private getColour(
    settings: MetricSettings | undefined,
    key: string,
    index: number,
  ): string {
    return (
      (settings?.colorMap?.[key] as string) ||
      DEFAULT_LINE_COLORS[index % DEFAULT_LINE_COLORS.length]
    );
  }
}

/**
 * Show actual sleep for people and average sleep for capability groups.
 *
 * Sleep is the gap from a person's final assigned task or transfer on one
 * scheduled working day to their first assigned task or transfer on the next
 * working day on which they are scheduled.
 */
export class SleepingHoursMetric extends SleepHoursMetricBase {
  config: MetricConfig = {
    id: "sleeping_hours",
    name: "Sleeping Hours",
    description:
      "Actual sleep for people and average sleep for groups, ending at the first task or transfer",
    category: "fatigue",
    visualization: "line_chart",
    supportsPersonFilter: true,
    supportsCapabilityFilter: true,
    hasTimeAxis: true,
  };

  protected aggregation: SleepAggregation = "average";
}

/**
 * Show the least sleep received by any measurable member of each group.
 *
 * Individual person filters retain their actual sleep line. Group values omit
 * members without both a previous end and a subsequent start boundary.
 */
export class MinimumSleepingHoursMetric extends SleepHoursMetricBase {
  config: MetricConfig = {
    id: "minimum_sleeping_hours",
    name: "Minimum Sleeping Hours",
    description:
      "Least sleep received by a person or group member before the next task or transfer",
    category: "fatigue",
    visualization: "line_chart",
    supportsPersonFilter: true,
    supportsCapabilityFilter: true,
    hasTimeAxis: true,
  };

  protected aggregation: SleepAggregation = "minimum";
}
