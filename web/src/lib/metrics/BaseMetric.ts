import {
  IMetric,
  MetricConfig,
  MetricResult,
  ScheduleData,
  MetricFilters,
  MetricSettings,
} from "./MetricInterface";
import { getMetricTaskDurationHours } from "./metricScheduleData";

export abstract class BaseMetric implements IMetric {
  abstract config: MetricConfig;

  abstract calculate(
    data: ScheduleData,
    filters?: MetricFilters,
    settings?: MetricSettings,
  ): Promise<MetricResult>;

  // Helper: Filter tasks by filters
  protected filterTasks(data: ScheduleData, filters?: MetricFilters) {
    let tasks = data.tasks;

    if (filters?.personIds && filters.personIds.length > 0) {
      tasks = tasks.filter((task) =>
        task.person_ids.some((pid) => filters.personIds!.includes(pid)),
      );
    }

    if (filters?.capabilityIds && filters.capabilityIds.length > 0) {
      tasks = tasks.filter(
        (task) =>
          task.capability_ids?.some((cid) =>
            filters.capabilityIds!.includes(cid),
          ) || filters.capabilityIds!.includes(task.task_type_id),
      );
    }

    if (filters?.timeRange) {
      tasks = tasks.filter((task) => {
        const taskStart = new Date(task.start_time);
        const taskEnd = new Date(task.end_time);
        const rangeStart = new Date(filters.timeRange!.start);
        const rangeEnd = new Date(filters.timeRange!.end);
        return taskStart >= rangeStart && taskEnd <= rangeEnd;
      });
    }

    return tasks;
  }

  // Helper: Calculate task duration in hours
  protected getTaskDuration(task: {
    start_time: string;
    end_time: string;
  }): number {
    return getMetricTaskDurationHours(task);
  }

  /**
   * Get the sorted list of dates for the x-axis.
   * Prefers schedule.eventDates (full event date range) so every day appears
   * even when it has no tasks. Falls back to extracting dates from tasks.
   */
  protected getSortedDates(schedule: ScheduleData): string[] {
    if (schedule.eventDates && schedule.eventDates.length > 0) {
      return schedule.eventDates;
    }
    const dates = new Set<string>();
    for (const task of schedule.tasks) {
      dates.add(
        task.date || new Date(task.start_time).toISOString().split("T")[0],
      );
    }
    return Array.from(dates).sort();
  }
}
