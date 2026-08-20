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
  calculatePersonHoursByDay,
  findMaxHoursViolations,
  findWorstMaxHoursViolation,
  countsTowardsWorkTime,
  personCountsTowardsWorkTime,
  workingPersonIds,
} from "../metricScheduleData";

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

function getDefaultLineColor(index: number): string {
  return DEFAULT_LINE_COLORS[index % DEFAULT_LINE_COLORS.length];
}

function formatPersonName(person: ScheduleData["people"][number]): string {
  return (
    [person.first_name, person.last_name].filter(Boolean).join(" ").trim() ||
    person.name ||
    `Person ${person.id}`
  );
}

function roundHours(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * Average Working Hours Metric - calculates the average working hours per person per day.
 * For capabilities, averages over all persons who hold that capability.
 * For the overall view, averages over all persons in the schedule.
 * Individual person lines show their actual hours (comparable to group averages).
 */
export class AverageWorkingHoursMetric extends BaseMetric {
  config: MetricConfig = {
    id: "average_working_hours",
    name: "Working Hours (average)",
    description:
      "Average working hours per person per day for selected persons/capabilities",
    category: "workload",
    visualization: "line_chart",
    supportsPersonFilter: true,
    supportsCapabilityFilter: true,
    hasTimeAxis: true,
  };

  async calculate(
    schedule: ScheduleData,
    filters?: MetricFilters,
    settings?: MetricSettings,
  ): Promise<MetricResult> {
    // Use personIds and capabilityIds from settings (not filters)
    const personIds = settings?.personIds || [];
    const capabilityIds = settings?.capabilityIds || [];

    // If no filters specified, show overall hours
    if (personIds.length === 0 && capabilityIds.length === 0) {
      return this.calculateOverall(schedule);
    }

    // Calculate separate lines for each person/capability
    const lines: LineChartVisualization["lines"] = [];

    // Process each person
    if (personIds.length > 0) {
      personIds.forEach((personId) => {
        const person = schedule.people.find((p) => p.id === personId);
        if (!person) return;

        const personTasks = schedule.tasks.filter((task) =>
          personCountsTowardsWorkTime(task, personId),
        );

        const hoursByDay = this.groupTasksByDay(personTasks);
        const sortedDates = this.getSortedDates(schedule);
        const points = sortedDates.map((date) => ({
          x: date,
          y: hoursByDay.get(date) || 0,
        }));

        // Check for colour in colorMap with person-${id} key
        const colorKey = `person-${personId}`;
        const color =
          (settings?.colorMap?.[colorKey] as string) ||
          this.getDefaultColor(lines.length);

        lines.push({
          label: `${person.first_name} ${person.last_name}`,
          points,
          color,
        });
      });
    }

    // Process each capability - use average per person so it's comparable to individual lines
    if (capabilityIds.length > 0) {
      capabilityIds.forEach((capabilityId) => {
        const capability = schedule.capabilities.find(
          (c) => c.id === capabilityId,
        );
        if (!capability) return;

        // Count ALL persons who hold this capability (not just assigned ones)
        // so that unassigned members pull the average down correctly
        const membersOfCapability = schedule.people.filter((p) =>
          p.capabilities.includes(capability.machine_name),
        );
        const memberIds = new Set(membersOfCapability.map((p) => p.id));
        const personCount = Math.max(1, membersOfCapability.length);

        const personHoursByDay = this.groupPersonHoursByDay(
          schedule.tasks,
          memberIds,
        );
        const sortedDates = this.getSortedDates(schedule);
        const points = sortedDates.map((date) => ({
          x: date,
          y: Number(
            ((personHoursByDay.get(date) || 0) / personCount).toFixed(2),
          ),
        }));

        // Check for colour in colorMap with capability-${id} key
        const colorKey = `capability-${capabilityId}`;
        const color =
          (settings?.colorMap?.[colorKey] as string) ||
          this.getDefaultColor(lines.length);

        const label =
          personCount > 1
            ? `${capability.name} (avg, ${personCount}p)`
            : capability.name;

        lines.push({
          label,
          points,
          color,
        });
      });
    }

    // Calculate total hours across all lines
    const totalHours = lines.reduce((sum, line) => {
      return sum + line.points.reduce((lineSum, point) => lineSum + point.y, 0);
    }, 0);

    const chartData: LineChartVisualization = {
      type: "line_chart",
      lines,
      xAxisLabel: "Date",
      yAxisLabel: "Hours",
    };

    return {
      value: totalHours,
      label: this.withLimitLabel(schedule, `${totalHours.toFixed(1)} hours total`),
      data: chartData,
    };
  }

  private calculateOverall(schedule: ScheduleData): Promise<MetricResult> {
    // Sum person-hours: each task's duration × number of assigned persons
    const personHoursByDay = this.groupPersonHoursByDay(schedule.tasks);

    // Use ALL people in the schedule as the denominator - people with
    // zero hours still count toward the average
    const personCount = Math.max(1, schedule.people.length);

    // Sort dates and create points - average when multiple people
    const sortedDates = this.getSortedDates(schedule);
    const points = sortedDates.map((date) => ({
      x: date,
      y: Number(((personHoursByDay.get(date) || 0) / personCount).toFixed(2)),
    }));

    // Calculate average total for the label
    const totalPersonHours = Array.from(personHoursByDay.values()).reduce(
      (sum, hours) => sum + hours,
      0,
    );
    const avgTotal = totalPersonHours / personCount;

    const label =
      personCount > 1 ? `Avg Hours/Person (${personCount}p)` : "Total Hours";

    const chartData: LineChartVisualization = {
      type: "line_chart",
      lines: [
        {
          label,
          points: points,
          color: "#3b82f6",
        },
      ],
      xAxisLabel: "Date",
      yAxisLabel: "Hours",
    };

    return Promise.resolve({
      value: avgTotal,
      label:
        this.withLimitLabel(
          schedule,
          personCount > 1
            ? `${avgTotal.toFixed(1)} avg hrs/person`
            : `${totalPersonHours.toFixed(1)} hours total`,
        ),
      data: chartData,
    });
  }

  private groupTasksByDay(tasks: ScheduleData["tasks"]): Map<string, number> {
    const hoursByDay = new Map<string, number>();

    tasks.forEach((task) => {
      if (!countsTowardsWorkTime(task)) return;
      // Use the explicit date field (YYYY-MM-DD) - no Date parsing needed
      const date =
        task.date || new Date(task.start_time).toISOString().split("T")[0];
      const duration = this.getTaskDuration(task);
      if (duration > 0) {
        hoursByDay.set(date, (hoursByDay.get(date) || 0) + duration);
      }
    });

    return hoursByDay;
  }

  /**
   * Like groupTasksByDay but weights each task by the number of assigned persons.
   * A 2h task with 3 persons = 6 person-hours.
   */
  private groupPersonHoursByDay(
    tasks: ScheduleData["tasks"],
    personFilter?: Set<number>,
  ): Map<string, number> {
    const hoursByDay = new Map<string, number>();

    tasks.forEach((task) => {
      if (!countsTowardsWorkTime(task)) return;
      const date =
        task.date || new Date(task.start_time).toISOString().split("T")[0];
      const duration = this.getTaskDuration(task);
      const workingIds = workingPersonIds(task);
      const personWeight = personFilter
        ? workingIds.filter((id) => personFilter.has(id)).length
        : workingIds.length;
      if (duration > 0) {
        hoursByDay.set(
          date,
          (hoursByDay.get(date) || 0) + duration * personWeight,
        );
      }
    });

    return hoursByDay;
  }

  private withLimitLabel(schedule: ScheduleData, label: string): string {
    const violations = findMaxHoursViolations(schedule);
    if (violations.length === 0) return label;
    return `${label} - ${violations.length} over limit`;
  }

  private getDefaultColor(index: number): string {
    const colors = [
      "#3b82f6", // blue
      "#ef4444", // red
      "#10b981", // green
      "#f59e0b", // amber
      "#8b5cf6", // purple
      "#ec4899", // pink
      "#06b6d4", // cyan
      "#84cc16", // lime
    ];
    return colors[index % colors.length];
  }
}

/**
 * Absolute Working Hours Metric - shows the raw sum of hours per day
 * with no averaging. Each person's line is their total; capabilities show
 * the sum across all persons with that capability; overall shows the grand total.
 */
export class AbsoluteWorkingHoursMetric extends BaseMetric {
  config: MetricConfig = {
    id: "absolute_working_hours",
    name: "Working Hours (absolute)",
    description:
      "Total sum of working hours per day for selected persons/capabilities (no averaging)",
    category: "workload",
    visualization: "line_chart",
    supportsPersonFilter: true,
    supportsCapabilityFilter: true,
    hasTimeAxis: true,
  };

  async calculate(
    schedule: ScheduleData,
    filters?: MetricFilters,
    settings?: MetricSettings,
  ): Promise<MetricResult> {
    const personIds = settings?.personIds || [];
    const capabilityIds = settings?.capabilityIds || [];

    if (personIds.length === 0 && capabilityIds.length === 0) {
      return this.calculateOverall(schedule);
    }

    const lines: LineChartVisualization["lines"] = [];

    // Process each person - show their actual hours
    if (personIds.length > 0) {
      personIds.forEach((personId) => {
        const person = schedule.people.find((p) => p.id === personId);
        if (!person) return;

        const personTasks = schedule.tasks.filter((task) =>
          personCountsTowardsWorkTime(task, personId),
        );

        const hoursByDay = this.groupTasksByDay(personTasks);
        const sortedDates = this.getSortedDates(schedule);
        const points = sortedDates.map((date) => ({
          x: date,
          y: hoursByDay.get(date) || 0,
        }));

        const colorKey = `person-${personId}`;
        const color =
          (settings?.colorMap?.[colorKey] as string) ||
          this.getDefaultColor(lines.length);

        lines.push({
          label: `${person.first_name} ${person.last_name}`,
          points,
          color,
        });
      });
    }

    // Process each capability - sum of person-hours (no averaging)
    if (capabilityIds.length > 0) {
      capabilityIds.forEach((capabilityId) => {
        const capability = schedule.capabilities.find(
          (c) => c.id === capabilityId,
        );
        if (!capability) return;

        const membersOfCapability = schedule.people.filter((p) =>
          p.capabilities.includes(capability.machine_name),
        );
        const memberIds = new Set(membersOfCapability.map((p) => p.id));
        const personHoursByDay = this.groupPersonHoursByDay(
          schedule.tasks,
          memberIds,
        );
        const sortedDates = this.getSortedDates(schedule);
        const points = sortedDates.map((date) => ({
          x: date,
          y: Number((personHoursByDay.get(date) || 0).toFixed(2)),
        }));

        const colorKey = `capability-${capabilityId}`;
        const color =
          (settings?.colorMap?.[colorKey] as string) ||
          this.getDefaultColor(lines.length);

        lines.push({
          label: `${capability.name} (total)`,
          points,
          color,
        });
      });
    }

    const totalHours = lines.reduce((sum, line) => {
      return sum + line.points.reduce((s, p) => s + p.y, 0);
    }, 0);

    return {
      value: totalHours,
      label: this.withLimitLabel(schedule, `${totalHours.toFixed(1)} hours total`),
      data: {
        type: "line_chart",
        lines,
        xAxisLabel: "Date",
        yAxisLabel: "Hours",
      } as LineChartVisualization,
    };
  }

  private calculateOverall(schedule: ScheduleData): Promise<MetricResult> {
    const personHoursByDay = this.groupPersonHoursByDay(schedule.tasks);

    const sortedDates = this.getSortedDates(schedule);
    const points = sortedDates.map((date) => ({
      x: date,
      y: Number((personHoursByDay.get(date) || 0).toFixed(2)),
    }));

    const totalPersonHours = Array.from(personHoursByDay.values()).reduce(
      (sum, hours) => sum + hours,
      0,
    );

    return Promise.resolve({
      value: totalPersonHours,
      label: this.withLimitLabel(
        schedule,
        `${totalPersonHours.toFixed(1)} hours total`,
      ),
      data: {
        type: "line_chart",
        lines: [
          {
            label: "Total Hours",
            points,
            color: "#3b82f6",
          },
        ],
        xAxisLabel: "Date",
        yAxisLabel: "Hours",
      } as LineChartVisualization,
    });
  }

  private groupTasksByDay(tasks: ScheduleData["tasks"]): Map<string, number> {
    const hoursByDay = new Map<string, number>();
    tasks.forEach((task) => {
      if (!countsTowardsWorkTime(task)) return;
      const date =
        task.date || new Date(task.start_time).toISOString().split("T")[0];
      const duration = this.getTaskDuration(task);
      if (duration > 0) {
        hoursByDay.set(date, (hoursByDay.get(date) || 0) + duration);
      }
    });
    return hoursByDay;
  }

  private groupPersonHoursByDay(
    tasks: ScheduleData["tasks"],
    personFilter?: Set<number>,
  ): Map<string, number> {
    const hoursByDay = new Map<string, number>();
    tasks.forEach((task) => {
      if (!countsTowardsWorkTime(task)) return;
      const date =
        task.date || new Date(task.start_time).toISOString().split("T")[0];
      const duration = this.getTaskDuration(task);
      const workingIds = workingPersonIds(task);
      const personWeight = personFilter
        ? workingIds.filter((id) => personFilter.has(id)).length
        : workingIds.length;
      if (duration > 0) {
        hoursByDay.set(
          date,
          (hoursByDay.get(date) || 0) + duration * personWeight,
        );
      }
    });
    return hoursByDay;
  }

  private withLimitLabel(schedule: ScheduleData, label: string): string {
    const violations = findMaxHoursViolations(schedule);
    if (violations.length === 0) return label;
    return `${label} - ${violations.length} over limit`;
  }

  private getDefaultColor(index: number): string {
    const colors = [
      "#3b82f6",
      "#ef4444",
      "#10b981",
      "#f59e0b",
      "#8b5cf6",
      "#ec4899",
      "#06b6d4",
      "#84cc16",
    ];
    return colors[index % colors.length];
  }
}

/**
 * Max Working Hours Metric - shows the highest actual scheduled hours against
 * configured max-hours limits. This is a per-person limit diagnostic, so
 * capability filters use the maximum member workload rather than total group
 * person-hours.
 */
export class MaxWorkingHoursMetric extends BaseMetric {
  config: MetricConfig = {
    id: "max_working_hours",
    name: "Max Working Hours",
    description:
      "Actual scheduled hours against configured max-hours limits, day by day",
    category: "workload",
    visualization: "line_chart",
    supportsPersonFilter: true,
    supportsCapabilityFilter: true,
    hasTimeAxis: true,
  };

  async calculate(
    schedule: ScheduleData,
    _filters?: MetricFilters,
    settings?: MetricSettings,
  ): Promise<MetricResult> {
    const personIds = settings?.personIds || [];
    const capabilityIds = settings?.capabilityIds || [];
    const dates = this.getSortedDates(schedule);
    const hoursByDay = calculatePersonHoursByDay(schedule);
    const lines: LineChartVisualization["lines"] = [];

    if (personIds.length === 0 && capabilityIds.length === 0) {
      this.addDailyMaxLines(schedule, dates, hoursByDay, lines, settings);
    } else {
      personIds.forEach((personId) => {
        const person = schedule.people.find((p) => p.id === personId);
        if (person) {
          this.addPersonLines(person, dates, hoursByDay, lines, settings);
        }
      });

      capabilityIds.forEach((capabilityId) => {
        const capability = schedule.capabilities.find(
          (cap) => cap.id === capabilityId,
        );
        if (!capability) return;
        const members = schedule.people.filter((person) =>
          person.capabilities.includes(capability.machine_name),
        );
        this.addGroupMaxLines(
          capability.name,
          members,
          dates,
          hoursByDay,
          lines,
          settings,
          `capability-${capabilityId}`,
        );
      });
    }

    const worstViolation = findWorstMaxHoursViolation(schedule);
    const peak = this.findPeak(schedule, dates, hoursByDay);
    const label = worstViolation
      ? `${worstViolation.personName} ${worstViolation.hours}h on ${
          schedule.dayAliases[worstViolation.date] || worstViolation.date
        } - limit ${worstViolation.maxHours}h`
      : peak
        ? `${peak.personName} ${peak.hours}h on ${
            schedule.dayAliases[peak.date] || peak.date
          }`
        : "No scheduled hours";

    return {
      value: worstViolation?.hours ?? peak?.hours ?? 0,
      label,
      data: {
        type: "line_chart",
        lines,
        xAxisLabel: "Date",
        yAxisLabel: "Hours",
      } as LineChartVisualization,
    };
  }

  private addDailyMaxLines(
    schedule: ScheduleData,
    dates: string[],
    hoursByDay: Map<string, Map<number, number>>,
    lines: LineChartVisualization["lines"],
    settings?: MetricSettings,
  ) {
    const actualPoints: Array<{ x: string; y: number }> = [];
    const limitPoints: Array<{ x: string; y: number }> = [];

    for (const date of dates) {
      const peak = this.findPeakForPeople(
        schedule.people,
        date,
        hoursByDay.get(date),
      );
      actualPoints.push({ x: date, y: peak?.hours ?? 0 });
      if (peak?.person.max_hours_per_day != null) {
        limitPoints.push({ x: date, y: peak.person.max_hours_per_day });
      }
    }

    lines.push({
      label: "Daily max",
      points: actualPoints,
      color: "#3b82f6",
    });
    if (limitPoints.length > 0) {
      lines.push({
        label: "Limit for daily max",
        points: limitPoints,
        color:
          (settings?.colorMap?.["daily-max-limit"] as string) || "#64748b",
        style: "dashed",
      });
    }
  }

  private addPersonLines(
    person: ScheduleData["people"][number],
    dates: string[],
    hoursByDay: Map<string, Map<number, number>>,
    lines: LineChartVisualization["lines"],
    settings?: MetricSettings,
  ) {
    const colorKey = `person-${person.id}`;
    const color =
      (settings?.colorMap?.[colorKey] as string) ||
      getDefaultLineColor(lines.length);
    const name = formatPersonName(person);
    lines.push({
      label: name,
      points: dates.map((date) => ({
        x: date,
        y: roundHours(hoursByDay.get(date)?.get(person.id) || 0),
      })),
      color,
    });

    if (person.max_hours_per_day != null) {
      lines.push({
        label: `${name} limit`,
        points: dates.map((date) => ({ x: date, y: person.max_hours_per_day! })),
        color,
        style: "dashed",
      });
    }
  }

  private addGroupMaxLines(
    label: string,
    people: ScheduleData["people"],
    dates: string[],
    hoursByDay: Map<string, Map<number, number>>,
    lines: LineChartVisualization["lines"],
    settings: MetricSettings | undefined,
    colorKey: string,
  ) {
    const color =
      (settings?.colorMap?.[colorKey] as string) ||
      getDefaultLineColor(lines.length);
    const actualPoints: Array<{ x: string; y: number }> = [];
    const limitPoints: Array<{ x: string; y: number }> = [];

    for (const date of dates) {
      const peak = this.findPeakForPeople(people, date, hoursByDay.get(date));
      actualPoints.push({ x: date, y: peak?.hours ?? 0 });
      if (peak?.person.max_hours_per_day != null) {
        limitPoints.push({ x: date, y: peak.person.max_hours_per_day });
      }
    }

    lines.push({
      label: `${label} max`,
      points: actualPoints,
      color,
    });
    if (limitPoints.length > 0) {
      lines.push({
        label: `${label} limit`,
        points: limitPoints,
        color,
        style: "dashed",
      });
    }
  }

  private findPeak(
    schedule: ScheduleData,
    dates: string[],
    hoursByDay: Map<string, Map<number, number>>,
  ): { personName: string; date: string; hours: number } | null {
    let peak: { personName: string; date: string; hours: number } | null = null;
    for (const date of dates) {
      const dayPeak = this.findPeakForPeople(
        schedule.people,
        date,
        hoursByDay.get(date),
      );
      if (!dayPeak || dayPeak.hours <= 0) continue;
      if (!peak || dayPeak.hours > peak.hours) {
        peak = {
          personName: formatPersonName(dayPeak.person),
          date,
          hours: dayPeak.hours,
        };
      }
    }
    return peak;
  }

  private findPeakForPeople(
    people: ScheduleData["people"],
    _date: string,
    dayHours?: Map<number, number>,
  ): { person: ScheduleData["people"][number]; hours: number } | null {
    let peak: { person: ScheduleData["people"][number]; hours: number } | null =
      null;
    for (const person of people) {
      const hours = roundHours(dayHours?.get(person.id) || 0);
      if (!peak || hours > peak.hours) {
        peak = { person, hours };
      }
    }
    return peak;
  }
}
