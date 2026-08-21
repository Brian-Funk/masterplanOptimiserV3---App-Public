import {
  getWorkingDayForDateTime,
  lineariseTaskTimesForWorkingDay,
  normaliseScheduleDayBoundary,
  type ScheduleDayBoundary,
} from "@/lib/workingDayBoundary";

interface SolverTemplate {
  id: number;
  is_floating?: boolean;
  is_transfer?: boolean;
  fields?: Array<{ id: number | string; type: string }>;
}

interface SolverTaskType {
  id: number;
  counts_towards_work_time?: boolean;
}

interface PrepareSolverTasksParams {
  eventId: number;
  selectedDate: string;
  templates: SolverTemplate[];
  taskTypes?: SolverTaskType[];
  taskInstances: any[];
  ignoredTaskIds?: ReadonlySet<number>;
  scheduleDayBoundary?: Partial<ScheduleDayBoundary> | null;
  skipFloating?: boolean;
}

export interface PreparedSolverTasks {
  allTaskInstances: any[];
  activeTaskInstances: any[];
  solverTasks: any[];
  ignoredCount: number;
}

/** Mixed selections converge to ignored; an all-ignored selection is restored. */
export function shouldIgnoreSelectedTasks(
  selectedTaskIds: number[],
  ignoredTaskIds: ReadonlySet<number>,
): boolean {
  return selectedTaskIds.some((taskId) => !ignoredTaskIds.has(taskId));
}

function getInstanceStartClock(
  instance: any,
  templates: SolverTemplate[],
): string | null {
  const template = templates.find((candidate) => candidate.id === instance.template_id);
  if (!template?.fields || !instance.field_values) return null;
  for (const field of template.fields) {
    const value = instance.field_values[field.id];
    if (field.type === "start_end_time" && value?.start) return value.start;
    if (field.type === "time_range" && value?.start) return value.start;
    if (field.type === "time" && typeof value === "string") return value;
  }
  return null;
}

/** Build the one authoritative task scope shared by flow checking and optimisation. */
export function prepareSolverTasksForWorkingDay({
  eventId,
  selectedDate,
  templates,
  taskTypes = [],
  taskInstances,
  ignoredTaskIds = new Set<number>(),
  scheduleDayBoundary,
  skipFloating = false,
}: PrepareSolverTasksParams): PreparedSolverTasks {
  const boundary = normaliseScheduleDayBoundary(scheduleDayBoundary);
  const allTaskInstances = taskInstances.filter(
    (instance: any) =>
      instance.event_id === eventId &&
      getWorkingDayForDateTime(
        instance.date,
        getInstanceStartClock(instance, templates),
        boundary,
      ) === selectedDate,
  );
  const activeTaskInstances = allTaskInstances.filter(
    (instance: any) => !ignoredTaskIds.has(Math.floor(instance.id)),
  );

  const solverTasks = activeTaskInstances
    .map((task: any) => {
      const template = templates.find(
        (candidate) => candidate.id === task.template_id,
      );
      const taskType = taskTypes.find(
        (candidate) => candidate.id === task.task_type_id,
      );
      const isFloating = template?.is_floating || false;
      const isTransfer = template?.is_transfer || false;
      let locationId = null;

      if (template?.fields && task.field_values) {
        const locationField = template.fields.find(
          (field) =>
            field.type === "location" || field.type === "start_location",
        );
        if (locationField) {
          const value = task.field_values[locationField.id];
          locationId =
            value === null
              ? null
              : typeof value === "number"
                ? value
                : value?.value;
        }
      }

      return {
        ...task,
        id: Math.floor(task.id),
        location_id: locationId,
        is_floating: isFloating,
        is_transfer: isTransfer,
        counts_towards_work_time:
          taskType?.counts_towards_work_time !== false,
      };
    })
    .filter(
      (task: any) =>
        task.location_id !== undefined && (!skipFloating || !task.is_floating),
    )
    .map((task: any) =>
      lineariseTaskTimesForWorkingDay(task, selectedDate, boundary),
    );

  return {
    allTaskInstances,
    activeTaskInstances,
    solverTasks,
    ignoredCount: allTaskInstances.length - activeTaskInstances.length,
  };
}
