import type { PublishTarget, TaskInstance } from "@/lib/api";
import {
  countManualEdits,
  hasScheduleData,
  type DayPublishStatus,
} from "@/lib/eventStatusSummary";
import { formatStatusTimestamp } from "@/lib/statusTimestamps";

export type PublishPreviewTarget = "google_calendar" | "mp_backend" | "both";
export type PublishPreviewScope = "selected_day" | "all_days";

export type DayPublishPreviewStatus =
  | "ready"
  | "up_to_date"
  | "changes_pending"
  | "not_ready"
  | "no_publishable_tasks"
  | "has_conflicts"
  | "skipped"
  | "failed";

export interface DayPublishPreview {
  dayId: string;
  dayLabel: string;
  status: DayPublishPreviewStatus;
  isPublishable: boolean;
  willPublish: boolean;
  taskCount: number;
  manualEditCount: number;
  conflictCount: number;
  fingerprint?: string;
  lastPublishedAt?: string | null;
  reason?: string;
}

export interface PublishPreview {
  target: PublishPreviewTarget | null;
  targetLabel: string;
  scope: PublishPreviewScope;
  scopeLabel: string;
  selectedDayId?: string;
  totalDays: number;
  publishableDays: number;
  skippedDays: number;
  totalTasksToPublish: number;
  manualEditCount: number;
  conflictCount: number;
  lastPublishedAt?: string | null;
  days: DayPublishPreview[];
  publishDays: DayPublishPreview[];
  canPublish: boolean;
  blockingReasons: string[];
  warnings: string[];
  summary: string;
  explanation: string;
  actionLabel: string;
}

export interface PublishPreviewInput {
  publishTarget: PublishTarget;
  scope: PublishPreviewScope;
  selectedDayId?: string;
  dayStatuses: DayPublishStatus[];
  taskInstances: TaskInstance[];
  allDayIds?: string[];
  getDayLabel?: (dayId: string) => string;
  now?: Date;
}

/** Convert the configured app publish target into the preview target model. */
export function toPublishPreviewTarget(
  target: PublishTarget,
): PublishPreviewTarget | null {
  if (target === "google") return "google_calendar";
  if (target === "mp-backend") return "mp_backend";
  if (target === "both") return "both";
  return null;
}

/** Return a non-sensitive label for the publish destination. */
export function getPublishTargetLabel(
  target: PublishPreviewTarget | null,
): string {
  if (target === "google_calendar") return "Google Calendar";
  if (target === "mp_backend") return "MP-Backend";
  if (target === "both") return "Google Calendar and MP-Backend";
  return "No publish target";
}

/** Build the low-noise confirmation model shown before external publishing. */
export function derivePublishPreview(
  input: PublishPreviewInput,
): PublishPreview {
  const target = toPublishPreviewTarget(input.publishTarget);
  const targetLabel = getPublishTargetLabel(target);
  const dayIds = resolvePreviewDayIds(input);
  const tasksByDay = groupTasksByDay(input.taskInstances);
  const statusByDay = new Map(
    input.dayStatuses.map((status) => [status.dayId, status]),
  );

  const days = dayIds.map((dayId) =>
    buildDayPreview({
      dayId,
      status: statusByDay.get(dayId),
      tasks: tasksByDay.get(dayId) ?? [],
      getDayLabel: input.getDayLabel,
      now: input.now,
    }),
  );

  const publishDays = days.filter((day) => day.willPublish);
  const blockingReasons: string[] = [];
  if (!target) {
    blockingReasons.push("No publish target is configured.");
  }
  if (publishDays.length === 0) {
    blockingReasons.push(
      input.scope === "selected_day"
        ? "The selected day is not ready to publish."
        : "No days are ready to publish.",
    );
  }

  const skippedDays = days.length - publishDays.length;
  const manualEditCount = publishDays.reduce(
    (sum, day) => sum + day.manualEditCount,
    0,
  );
  const conflictCount = days.reduce((sum, day) => sum + day.conflictCount, 0);
  const totalTasksToPublish = publishDays.reduce(
    (sum, day) => sum + day.taskCount,
    0,
  );
  const lastPublishedAt = latestTimestamp(
    publishDays.map((day) => day.lastPublishedAt),
  );
  const warnings = buildWarnings(days, manualEditCount, conflictCount, skippedDays);
  const canPublish = target !== null && publishDays.length > 0;
  const scopeLabel =
    input.scope === "selected_day"
      ? `${days[0]?.dayLabel ?? "Selected day"} only`
      : `All ${days.length} ${pluralise(days.length, "day", "days")}`;

  return {
    target,
    targetLabel,
    scope: input.scope,
    scopeLabel,
    selectedDayId: input.selectedDayId,
    totalDays: days.length,
    publishableDays: publishDays.length,
    skippedDays,
    totalTasksToPublish,
    manualEditCount,
    conflictCount,
    lastPublishedAt,
    days,
    publishDays,
    canPublish,
    blockingReasons,
    warnings,
    summary: buildSummary(input.scope, publishDays, days, targetLabel),
    explanation: target
      ? buildExplanation(input.scope, publishDays, {
          totalTasksToPublish,
          skippedDays,
          manualEditCount,
        })
      : "Configure a publish target before publishing.",
    actionLabel: buildActionLabel(input.scope, publishDays),
  };
}

/** Return day ids which are relevant for the selected publish scope. */
function resolvePreviewDayIds(input: PublishPreviewInput): string[] {
  if (input.scope === "selected_day") {
    return input.selectedDayId ? [input.selectedDayId] : [];
  }

  if (input.allDayIds !== undefined) {
    return Array.from(new Set(input.allDayIds)).sort((left, right) =>
      left.localeCompare(right),
    );
  }

  const knownIds = new Set<string>();
  input.dayStatuses.forEach((status) => knownIds.add(status.dayId));
  input.taskInstances.forEach((task) => {
    if (task.date) knownIds.add(task.date);
  });

  return Array.from(knownIds).sort((left, right) => left.localeCompare(right));
}

function buildDayPreview({
  dayId,
  status,
  tasks,
  getDayLabel,
  now,
}: {
  dayId: string;
  status?: DayPublishStatus;
  tasks: TaskInstance[];
  getDayLabel?: (dayId: string) => string;
  now?: Date;
}): DayPublishPreview {
  const publishableTasks = tasks.filter(hasPublishableTask);
  const taskCount = publishableTasks.length;
  const manualEditCount = countManualEdits(tasks);
  const conflictCount = status?.conflictCount ?? 0;
  const base = {
    dayId,
    dayLabel: getDayLabel?.(dayId) || dayId,
    taskCount,
    manualEditCount,
    conflictCount,
    fingerprint: status?.fingerprint,
    lastPublishedAt: status?.lastPublishedAt,
  };
  const failureMessage = status?.failureMessage?.trim();
  const failureMessageEnd =
    failureMessage && /[.!?]$/.test(failureMessage) ? "" : ".";
  const previousFailureReason = status?.publishFailed
    ? failureMessage
      ? `Previous publish failed: ${failureMessage}${failureMessageEnd} Retrying is allowed.`
      : "Previous publish failed. Retrying is allowed."
    : undefined;

  if (conflictCount > 0) {
    return {
      ...base,
      status: "has_conflicts",
      isPublishable: false,
      willPublish: false,
      reason: `${conflictCount} ${pluralise(
        conflictCount,
        "conflict",
        "conflicts",
      )} found.`,
    };
  }

  if (!status?.isOptimisedOrFinalised || taskCount === 0) {
    return {
      ...base,
      status: taskCount === 0 ? "no_publishable_tasks" : "not_ready",
      isPublishable: false,
      willPublish: false,
      reason:
        taskCount === 0
          ? "No publishable tasks."
          : "The day is not optimised or finalised.",
    };
  }

  if (!status.isPublishable) {
    return {
      ...base,
      status: "not_ready",
      isPublishable: false,
      willPublish: false,
      reason: "The day is not ready to publish.",
    };
  }

  if (status.hasChangesSincePublish) {
    const sinceText = formatStatusTimestamp(status.lastPublishedAt, { now });
    const changesReason = sinceText
      ? `Changes since publish ${sinceText}.`
      : undefined;
    return {
      ...base,
      status: "changes_pending",
      isPublishable: true,
      willPublish: true,
      reason:
        [previousFailureReason, changesReason].filter(Boolean).join(" ") ||
        undefined,
    };
  }

  if (status.isPublished) {
    const publishedText = formatStatusTimestamp(status.lastPublishedAt, { now });
    const publishedReason = publishedText
      ? `Last published ${publishedText}.`
      : "Already published.";
    return {
      ...base,
      status: "up_to_date",
      isPublishable: true,
      willPublish: true,
      reason: [previousFailureReason, publishedReason].filter(Boolean).join(" "),
    };
  }

  return {
    ...base,
    status: "ready",
    isPublishable: true,
    willPublish: true,
    reason: previousFailureReason ?? "Ready to publish.",
  };
}

function groupTasksByDay(tasks: TaskInstance[]): Map<string, TaskInstance[]> {
  const grouped = new Map<string, TaskInstance[]>();
  tasks.forEach((task) => {
    if (!task.date) return;
    grouped.set(task.date, [...(grouped.get(task.date) ?? []), task]);
  });
  return grouped;
}

function hasPublishableTask(task: TaskInstance): boolean {
  return hasScheduleData(task.final) || hasScheduleData(task.optimised);
}

function buildWarnings(
  days: DayPublishPreview[],
  manualEditCount: number,
  conflictCount: number,
  skippedDays: number,
): string[] {
  const warnings: string[] = [];
  if (manualEditCount > 0) {
    warnings.push(
      `Publishing final schedule, including ${manualEditCount} manual ${pluralise(
        manualEditCount,
        "edit",
        "edits",
      )}.`,
    );
  }
  if (conflictCount > 0) {
    warnings.push(
      `${conflictCount} ${pluralise(
        conflictCount,
        "conflict",
        "conflicts",
      )} found. Affected days will be skipped.`,
    );
  }
  if (skippedDays > 0) {
    warnings.push(
      `${skippedDays} ${pluralise(
        skippedDays,
        "day will",
        "days will",
      )} be skipped.`,
    );
  }
  if (days.some((day) => day.status === "up_to_date")) {
    warnings.push("Already published days will be refreshed.");
  }
  return warnings;
}

function buildSummary(
  scope: PublishPreviewScope,
  publishDays: DayPublishPreview[],
  days: DayPublishPreview[],
  targetLabel: string,
): string {
  if (targetLabel === "No publish target") {
    return "No publish target is configured.";
  }
  if (publishDays.length === 0) return "No days are ready to publish.";
  if (scope === "selected_day") {
    return `${publishDays[0].dayLabel} will be published to ${targetLabel}.`;
  }
  if (publishDays.length === days.length) {
    return `${publishDays.length} ${pluralise(
      publishDays.length,
      "day",
      "days",
    )} will be published to ${targetLabel}.`;
  }
  return `${publishDays.length} of ${days.length} ${pluralise(
    days.length,
    "day is",
    "days are",
  )} ready to publish.`;
}

function buildExplanation(
  scope: PublishPreviewScope,
  publishDays: DayPublishPreview[],
  counts: {
    totalTasksToPublish: number;
    skippedDays: number;
    manualEditCount: number;
  },
): string {
  if (publishDays.length === 0) {
    return "Review the day details before trying to publish again.";
  }

  const taskText = `${counts.totalTasksToPublish} ${pluralise(
    counts.totalTasksToPublish,
    "task",
    "tasks",
  )}`;
  const base =
    scope === "selected_day"
      ? `Only ${publishDays[0].dayLabel} will be updated. Other days will remain unchanged.`
      : `This will publish ${taskText} across ${publishDays.length} ready ${pluralise(
          publishDays.length,
          "day",
          "days",
        )}.`;
  const skipped =
    counts.skippedDays > 0
      ? ` ${counts.skippedDays} ${pluralise(
          counts.skippedDays,
          "day is",
          "days are",
        )} not ready and will be skipped.`
      : "";
  const edits =
    counts.manualEditCount > 0
      ? " You are publishing the final schedule, including manual edits."
      : " You are publishing the final schedule.";
  return `${base}${scope === "selected_day" ? "" : skipped}${edits}`;
}

function buildActionLabel(
  scope: PublishPreviewScope,
  publishDays: DayPublishPreview[],
): string {
  if (publishDays.length === 0) return "Publish";
  if (scope === "selected_day") return `Publish ${publishDays[0].dayLabel}`;
  if (publishDays.length === 1) return `Publish 1 day`;
  return `Publish ${publishDays.length} days`;
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  const latest = values
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0];
  return latest ? latest.toISOString() : null;
}

function pluralise(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}
