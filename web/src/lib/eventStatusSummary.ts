import type { PublishTarget, TaskInstance } from "@/lib/api";
import type { JobSummary } from "@/types/optimization";
import type { ConfidenceLevel } from "@/lib/confidence";
import {
  compareStatusTimestamps,
  formatStatusTimestamp,
  latestStatusTimestamp,
  type StatusTimestampInput,
} from "@/lib/statusTimestamps";

export type EventStatusItemId =
  | "setup"
  | "optimisation"
  | "manualChanges"
  | "conflicts"
  | "publishing";

export interface EventStatusItem {
  id: EventStatusItemId;
  label: string;
  status: string;
  level: ConfidenceLevel;
  description: string;
  summary?: string;
}

export interface EventStatusSummary {
  headline: string;
  level: ConfidenceLevel;
  primary: EventPrimaryStatus;
  items: EventStatusItem[];
}

export interface EventPrimaryStatus {
  level: ConfidenceLevel;
  title: string;
  description: string;
  actionId?: EventStatusItemId;
}

export interface EventStatusSummaryInput {
  eventStatus?: string | null;
  personCount?: number | null;
  people?: Array<{
    id: number;
    first_name?: string;
    last_name?: string;
    name?: string;
  }> | null;
  locationCount?: number | null;
  taskInstances?: ScheduleStatusTask[] | null;
  publishTarget?: PublishTarget | null;
  jobs?: JobSummary[] | null;
  currentScheduleFingerprint?: string | null;
  publishedScheduleFingerprint?: string | null;
  publishedScheduleScope?: "all" | "partial" | null;
  publishedDayRecords?: PublishedDayRecords | null;
  publishedAt?: StatusTimestampInput;
  publishFailedAt?: StatusTimestampInput;
  now?: Date;
}

export type ScheduleStatusTask = Pick<
  TaskInstance,
  "id" | "name" | "date" | "optimised" | "final" | "created_at" | "updated_at"
>;

export type ScheduleConflict = {
  id: string;
  type: "double_booking";
  severity: "error";
  taskIds: number[];
  personIds: number[];
  message: string;
  details?: string;
};

export type PublishedDayRecord = {
  fingerprint?: string | null;
  publishedAt?: string | null;
  failedAt?: string | null;
  failureMessage?: string | null;
};

export type PublishedDayRecords = Record<string, PublishedDayRecord>;

export type DayPublishStatus = {
  dayId: string;
  label: string;
  fingerprint: string;
  isPublishable: boolean;
  isPublished: boolean;
  lastPublishedAt?: string | null;
  hasChangesSincePublish: boolean;
  publishFailed: boolean;
  failureMessage?: string | null;
  isOptimisedOrFinalised: boolean;
  conflictCount: number;
};

export type EventPublishStatus = {
  state:
    | "not_published"
    | "partially_published"
    | "fully_published"
    | "changes_pending"
    | "publish_incomplete"
    | "publish_failed"
    | "not_ready";
  totalDays: number;
  publishableDays: number;
  publishedDays: number;
  upToDateDays: number;
  changedDays: number;
  failedDays: number;
  notReadyDays: number;
  message: string;
};

/** Return true when a schedule JSON object contains usable schedule data. */
export function hasScheduleData(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value as Record<string, unknown>).length > 0,
  );
}

/** Count task instances whose editable final schedule differs from the optimiser output. */
export function countManualEdits(
  taskInstances: Array<Pick<TaskInstance, "optimised" | "final">> = [],
): number {
  return taskInstances.filter((task) =>
    isTaskManuallyChanged(task.optimised, task.final),
  ).length;
}

/** Return the newest timestamp available for tasks manually edited after optimisation. */
export function getLastManualEditAt(
  taskInstances: Array<
    Pick<TaskInstance, "optimised" | "final"> &
      Partial<Pick<TaskInstance, "created_at" | "updated_at">>
  > = [],
): string | null {
  return latestStatusTimestamp(
    taskInstances
      .filter((task) => isTaskManuallyChanged(task.optimised, task.final))
      .map((task) => task.updated_at ?? task.created_at ?? null),
  );
}

/** Return the newest successful optimisation completion timestamp. */
export function getLatestSuccessfulOptimisationAt(
  jobs: JobSummary[] = [],
): string | null {
  return latestStatusTimestamp(
    jobs
      .filter((job) => !job.is_test_run && job.status === "completed")
      .map((job) => job.completed_at ?? job.created_at),
  );
}

/** Return whether reliable final schedule fields differ from the optimiser output. */
export function isTaskManuallyChanged(
  optimised: unknown,
  final: unknown,
): boolean {
  return getTaskChangeSummary(optimised, final).length > 0;
}

/** Return concise labels for reliable fields changed after optimisation. */
export function getTaskChangeSummary(
  optimised: unknown,
  final: unknown,
): string[] {
  if (!hasScheduleData(optimised) || !hasScheduleData(final)) return [];

  const original = normaliseScheduleForComparison(optimised);
  const current = normaliseScheduleForComparison(final);
  const changes: string[] = [];

  if (
    original.startTime !== current.startTime ||
    original.endTime !== current.endTime
  ) {
    changes.push("Time changed");
  }
  if (original.locationKey !== current.locationKey) {
    changes.push("Location changed");
  }
  if (original.assignmentKey !== current.assignmentKey) {
    changes.push("Assignments changed");
  }

  return changes;
}

/** Detect person double-booking conflicts in the current final schedule. */
export function detectScheduleConflicts(
  taskInstances: ScheduleStatusTask[] = [],
  people: Array<{
    id: number;
    first_name?: string;
    last_name?: string;
    name?: string;
  }> = [],
): ScheduleConflict[] {
  const personNames = new Map(
    people.map((person) => [
      person.id,
      person.name ||
        [person.first_name, person.last_name].filter(Boolean).join(" ") ||
        `Person ${person.id}`,
    ]),
  );
  const concreteTasks = taskInstances
    .map((task) => {
      const schedule = getCurrentScheduleValue(task.optimised, task.final);
      if (!hasScheduleData(schedule)) return null;
      const normalised = normaliseScheduleForComparison(schedule);
      if (
        task.id == null ||
        !task.date ||
        normalised.startTime == null ||
        normalised.endTime == null ||
        normalised.endTime <= normalised.startTime ||
        normalised.assignedPersonIds.length === 0
      ) {
        return null;
      }

      return {
        id: task.id,
        name: task.name || `Task ${task.id}`,
        date: task.date,
        start: normalised.startTime,
        end: normalised.endTime,
        assignedPersonIds: normalised.assignedPersonIds,
      };
    })
    .filter((task): task is NonNullable<typeof task> => task !== null);

  const conflicts: ScheduleConflict[] = [];
  for (let i = 0; i < concreteTasks.length; i += 1) {
    for (let j = i + 1; j < concreteTasks.length; j += 1) {
      const first = concreteTasks[i];
      const second = concreteTasks[j];
      if (first.date !== second.date) continue;
      if (!(first.start < second.end && second.start < first.end)) continue;

      const sharedPeople = first.assignedPersonIds.filter((personId) =>
        second.assignedPersonIds.includes(personId),
      );
      for (const personId of sharedPeople) {
        const personName = personNames.get(personId) || `Person ${personId}`;
        conflicts.push({
          id: `double-booking-${personId}-${first.id}-${second.id}`,
          type: "double_booking",
          severity: "error",
          taskIds: [first.id, second.id],
          personIds: [personId],
          message: `${personName} is double-booked.`,
          details: `${first.name} overlaps with ${second.name}.`,
        });
      }
    }
  }

  return conflicts;
}

/** Create a stable fingerprint for the current final schedule state. */
export function getScheduleFingerprint(
  taskInstances: ScheduleStatusTask[] = [],
): string {
  return stableStringify(
    taskInstances
      .map((task) => {
        const schedule = getCurrentScheduleValue(task.optimised, task.final);
        if (!hasScheduleData(schedule)) return null;
        return {
          id: task.id,
          date: task.date,
          schedule: normaliseScheduleForComparison(schedule),
        };
      })
      .filter((task): task is NonNullable<typeof task> => task !== null)
      .sort((a, b) => Number(a.id) - Number(b.id)),
  );
}

/** Derive publish state for each day with task instances. */
export function deriveDayPublishStatuses(
  input: Pick<EventStatusSummaryInput, "taskInstances" | "people" | "publishedDayRecords">,
): DayPublishStatus[] {
  const records = input.publishedDayRecords ?? {};
  const tasksByDay = new Map<string, ScheduleStatusTask[]>();
  for (const task of input.taskInstances ?? []) {
    if (!task.date) continue;
    const existing = tasksByDay.get(task.date) ?? [];
    existing.push(task);
    tasksByDay.set(task.date, existing);
  }

  return Array.from(tasksByDay.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dayId, dayTasks]) => {
      const fingerprint = getScheduleFingerprint(dayTasks);
      const hasPublishableSchedule = fingerprint !== stableStringify([]);
      const conflicts = detectScheduleConflicts(dayTasks, input.people ?? []);
      const record = records[dayId] ?? {};
      const publishFailed =
        Boolean(record.failedAt) &&
        compareStatusTimestamps(record.failedAt, record.publishedAt) > 0;
      const isPublishable = hasPublishableSchedule && conflicts.length === 0;
      const isPublished =
        isPublishable &&
        !publishFailed &&
        Boolean(record.fingerprint) &&
        record.fingerprint === fingerprint;

      return {
        dayId,
        label: dayId,
        fingerprint,
        isPublishable,
        isPublished,
        lastPublishedAt: record.publishedAt ?? null,
        hasChangesSincePublish:
          isPublishable &&
          Boolean(record.fingerprint) &&
          record.fingerprint !== fingerprint,
        publishFailed,
        failureMessage: record.failureMessage ?? null,
        isOptimisedOrFinalised: hasPublishableSchedule,
        conflictCount: conflicts.length,
      };
    });
}

/** Aggregate day-level publish states into one event-level publishing summary. */
export function deriveEventPublishStatus(
  dayStatuses: DayPublishStatus[] = [],
  options: { now?: Date } = {},
): EventPublishStatus {
  const totalDays = dayStatuses.length;
  const publishableDays = dayStatuses.filter((day) => day.isPublishable).length;
  const publishedDays = dayStatuses.filter((day) => day.isPublished).length;
  const upToDateDays = publishedDays;
  const changedDayStatuses = dayStatuses.filter(
    (day) => day.hasChangesSincePublish,
  );
  const changedDays = changedDayStatuses.length;
  const failedDays = dayStatuses.filter((day) => day.publishFailed).length;
  const notReadyDays = dayStatuses.filter((day) => !day.isPublishable).length;

  const counts = {
    totalDays,
    publishableDays,
    publishedDays,
    upToDateDays,
    changedDays,
    failedDays,
    notReadyDays,
  };

  if (totalDays === 0) {
    return {
      state: "not_published",
      ...counts,
      message: "Event not published - no schedule is ready yet.",
    };
  }

  if (failedDays > 0 && (publishedDays > 0 || notReadyDays > 0)) {
    return {
      state: "publish_incomplete",
      ...counts,
      message: `Event publish incomplete - ${formatPublishIssueCounts(
        failedDays,
        notReadyDays,
      )}.`,
    };
  }

  if (failedDays > 0) {
    return {
      state: "publish_failed",
      ...counts,
      message: `Event publish failed - ${failedDays} ${pluralise(
        failedDays,
        "day",
        "days",
      )} failed.`,
    };
  }

  if (notReadyDays > 0 && publishedDays > 0) {
    return {
      state: "publish_incomplete",
      ...counts,
      message: `Event publish incomplete - ${publishedDays} of ${totalDays} ${pluralise(
        totalDays,
        "day is",
        "days are",
      )} up to date, ${notReadyDays} ${pluralise(
        notReadyDays,
        "day is",
        "days are",
      )} not ready.`,
    };
  }

  if (notReadyDays > 0) {
    return {
      state: "not_ready",
      ...counts,
      message: `Event not ready to publish - ${notReadyDays} ${pluralise(
        notReadyDays,
        "day is",
        "days are",
      )} not ready.`,
    };
  }

  if (changedDays > 0) {
    const changedSinceText =
      changedDays === 1
        ? formatStatusTimestamp(changedDayStatuses[0].lastPublishedAt, {
            now: options.now,
          })
        : null;
    return {
      state: "changes_pending",
      ...counts,
      message: `Event changes pending - ${changedDays} ${pluralise(
        changedDays,
        "day has",
        "days have",
      )} changes since publishing${changedSinceText ? ` ${changedSinceText}` : ""}.`,
    };
  }

  if (publishedDays > 0 && publishedDays < publishableDays) {
    return {
      state: "partially_published",
      ...counts,
      message: `Event partially published - ${publishedDays} of ${totalDays} ${pluralise(
        totalDays,
        "day is",
        "days are",
      )} up to date.`,
    };
  }

  if (publishableDays > 0 && publishedDays === publishableDays) {
    return {
      state: "fully_published",
      ...counts,
      message: `Event fully published - all ${totalDays} ${pluralise(
        totalDays,
        "day is",
        "days are",
      )} up to date.`,
    };
  }

  return {
    state: "not_published",
    ...counts,
    message: "Event not published - no days have been published yet.",
  };
}

/** Derive whether the event contains the minimum setup data needed to continue. */
export function deriveSetupItem(input: EventStatusSummaryInput): EventStatusItem {
  const personCount = input.personCount ?? null;
  const locationCount = input.locationCount ?? null;
  const taskCount = input.taskInstances?.length ?? null;

  if (personCount === null || locationCount === null || taskCount === null) {
    return {
      id: "setup",
      label: "Setup",
      status: "Unknown",
      level: "unknown",
      description: "Setup data is still loading.",
    };
  }

  if (personCount === 0 && locationCount === 0 && taskCount === 0) {
    return {
      id: "setup",
      label: "Setup",
      status: "Not started",
      level: "unknown",
      description:
        "Add people, locations, and tasks before running the optimiser.",
    };
  }

  const missing: string[] = [];
  if (personCount === 0) missing.push("people");
  if (locationCount === 0) missing.push("locations");
  if (taskCount === 0) missing.push("tasks");

  if (missing.length > 0) {
    return {
      id: "setup",
      label: "Setup",
      status: "Incomplete",
      level: "review",
      description: `Add missing ${missing.join(", ")} before optimisation.`,
    };
  }

  return {
    id: "setup",
    label: "Setup",
    status: "Ready",
    level: "ready",
    description: "People, locations, and tasks exist for this event.",
  };
}

/** Derive the event-level optimisation state from saved schedules and recent jobs. */
export function deriveOptimisationItem(
  input: EventStatusSummaryInput,
): EventStatusItem {
  const taskInstances = input.taskInstances ?? [];
  const latestJob = getLatestJob(input.jobs ?? []);
  const latestSuccessfulAt = getLatestSuccessfulOptimisationAt(input.jobs ?? []);
  const latestSuccessfulText = formatStatusTimestamp(latestSuccessfulAt, {
    now: input.now,
  });
  const hasOptimised = taskInstances.some((task) =>
    hasScheduleData(task.optimised),
  );

  if (latestJob?.status === "failed" && !hasOptimised) {
    const failedText = formatStatusTimestamp(
      latestJob.completed_at ?? latestJob.created_at,
      { now: input.now },
    );
    return {
      id: "optimisation",
      label: "Optimisation",
      status: "Failed",
      level: "blocked",
      description: failedText
        ? `The latest optimisation failed ${failedText}. Review the error and run it again.`
        : "The latest optimisation failed. Review the error and run it again.",
    };
  }

  if (latestJob?.status === "running" || latestJob?.status === "pending") {
    return {
      id: "optimisation",
      label: "Optimisation",
      status: latestJob.status === "running" ? "Running" : "Queued",
      level: "review",
      description: "An optimisation job is currently in progress.",
    };
  }

  if (hasOptimised) {
    return {
      id: "optimisation",
      label: "Optimisation",
      status: "Ready",
      level: "ready",
      description: latestSuccessfulText
        ? `Last optimised ${latestSuccessfulText}.`
        : "An optimisation result exists for this event.",
      summary: latestSuccessfulText
        ? `Last optimised ${latestSuccessfulText}.`
        : undefined,
    };
  }

  return {
    id: "optimisation",
    label: "Optimisation",
    status: "Not run",
    level: "unknown",
    description: "Run the optimiser after setup is complete.",
  };
}

/** Derive whether the final schedule differs from the optimiser output. */
export function deriveManualChangesItem(
  taskInstances: Array<
    Pick<TaskInstance, "optimised" | "final"> &
      Partial<Pick<TaskInstance, "created_at" | "updated_at">>
  > = [],
  options: { lastOptimisedAt?: StatusTimestampInput; now?: Date } = {},
): EventStatusItem {
  const editCount = countManualEdits(taskInstances);
  const hasOptimised = taskInstances.some((task) =>
    hasScheduleData(task.optimised),
  );
  const lastOptimisedText = formatStatusTimestamp(options.lastOptimisedAt, {
    now: options.now,
  });
  const lastManualEditText = formatStatusTimestamp(
    getLastManualEditAt(taskInstances),
    { now: options.now },
  );

  if (!hasOptimised) {
    return {
      id: "manualChanges",
      label: "Manual Changes",
      status: "None",
      level: "unknown",
      description: "No optimiser result exists yet, so no manual changes can be compared.",
    };
  }

  if (editCount === 0) {
    return {
      id: "manualChanges",
      label: "Manual Changes",
      status: "None",
      level: "ready",
      description: "The final schedule matches the optimiser output.",
    };
  }

  return {
    id: "manualChanges",
    label: "Manual Changes",
    status: `${editCount} ${editCount === 1 ? "edit" : "edits"}`,
    level: "review",
    description: buildManualEditDescription(
      editCount,
      lastOptimisedText,
      lastManualEditText,
    ),
    summary: buildManualEditSummary(
      editCount,
      lastOptimisedText,
      lastManualEditText,
    ),
  };
}

/** Derive conflict confidence from the current final schedule. */
export function deriveConflictsItem(
  input: Pick<EventStatusSummaryInput, "taskInstances"> & {
    people?: Array<{
      id: number;
      first_name?: string;
      last_name?: string;
      name?: string;
    }> | null;
    now?: Date;
  },
): EventStatusItem {
  const taskInstances = input.taskInstances ?? [];
  const hasFinalSchedule = taskInstances.some((task) =>
    hasScheduleData(task.final) || hasScheduleData(task.optimised),
  );

  if (!hasFinalSchedule) {
    return {
      id: "conflicts",
      label: "Conflicts",
      status: "Not checked",
      level: "unknown",
      description: "No final schedule exists yet. Run optimisation before checking conflicts.",
    };
  }

  const conflicts = detectScheduleConflicts(taskInstances, input.people ?? []);
  if (conflicts.length > 0) {
    const lastManualEditText = formatStatusTimestamp(
      getLastManualEditAt(taskInstances),
      { now: input.now },
    );
    const afterEditText = lastManualEditText
      ? ` after edits ${lastManualEditText}`
      : "";
    return {
      id: "conflicts",
      label: "Conflicts",
      status: `${conflicts.length} found`,
      level: "blocked",
      description: `${conflicts.length} double-booking ${
        conflicts.length === 1 ? "conflict" : "conflicts"
      } found across the full schedule${afterEditText}.`,
      summary: `${conflicts.length} ${
        conflicts.length === 1 ? "conflict" : "conflicts"
      } found${afterEditText}.`,
    };
  }

  return {
    id: "conflicts",
    label: "Conflicts",
    status: "None",
    level: "ready",
    description:
      "No person double-booking conflicts were detected across the full schedule.",
  };
}

/** Derive publish confidence from publish target, event status, and local edits. */
export function derivePublishingItem(
  input: EventStatusSummaryInput,
): EventStatusItem {
  const publishTarget = input.publishTarget ?? "none";
  const taskInstances = input.taskInstances ?? [];
  const failedText = formatStatusTimestamp(input.publishFailedAt, {
    now: input.now,
  });

  if (publishTarget === "none") {
    return {
      id: "publishing",
      label: "Publishing",
      status: "No target",
      level: "blocked",
      description: "Configure a publish target before publishing.",
    };
  }

  const failedAfterPublished =
    Boolean(input.publishFailedAt) &&
    compareStatusTimestamps(input.publishFailedAt, input.publishedAt) > 0;

  if (failedAfterPublished) {
    return {
      id: "publishing",
      label: "Publishing",
      status: "Publish failed",
      level: "blocked",
      description: failedText
        ? `Publish failed ${failedText}. Review the error and try again.`
        : "The latest publish failed. Review the error and try again.",
      summary: failedText ? `Publish failed ${failedText}.` : undefined,
    };
  }

  const dayStatuses = deriveDayPublishStatuses(input);
  const eventPublishStatus = deriveEventPublishStatus(dayStatuses, {
    now: input.now,
  });
  const level = getEventPublishConfidenceLevel(eventPublishStatus.state);

  return {
    id: "publishing",
    label: "Publishing",
    status: getEventPublishStatusLabel(eventPublishStatus.state),
    level,
    description: eventPublishStatus.message,
    summary: eventPublishStatus.message,
  };
}

/** Build the compact event confidence summary shown near the top of the dashboard. */
export function deriveEventStatusSummary(
  input: EventStatusSummaryInput,
): EventStatusSummary {
  const latestSuccessfulOptimisationAt = getLatestSuccessfulOptimisationAt(
    input.jobs ?? [],
  );
  const items = [
    deriveSetupItem(input),
    deriveOptimisationItem(input),
    deriveManualChangesItem(input.taskInstances ?? [], {
      lastOptimisedAt: latestSuccessfulOptimisationAt,
      now: input.now,
    }),
    deriveConflictsItem(input),
    derivePublishingItem(input),
  ];

  const level = deriveOverallLevel(items);

  return {
    level,
    headline: deriveHeadline(level, items),
    primary: derivePrimaryStatus(items),
    items,
  };
}

function deriveOverallLevel(items: EventStatusItem[]): ConfidenceLevel {
  if (items.some((item) => item.level === "blocked")) return "blocked";
  if (items.some((item) => item.level === "review")) return "review";
  if (items.every((item) => item.level === "ready")) return "ready";
  return "unknown";
}

function deriveHeadline(
  level: ConfidenceLevel,
  items: EventStatusItem[],
): string {
  if (level === "blocked") return "Action needed";
  if (level === "review") return "Review before publishing";

  const setup = items.find((item) => item.id === "setup");
  const optimisation = items.find((item) => item.id === "optimisation");
  if (level === "ready") return "Ready to publish";
  if (setup?.status === "Not started") return "Setup not started";
  if (optimisation?.status === "Not run") return "Optimisation not run";
  return "Status unknown";
}

/** Choose the one status message that should be visible in the compact global bar. */
export function derivePrimaryStatus(items: EventStatusItem[]): EventPrimaryStatus {
  const item = (id: EventStatusItemId) =>
    items.find((candidate) => candidate.id === id);
  const setup = item("setup");
  const optimisation = item("optimisation");
  const manualChanges = item("manualChanges");
  const conflicts = item("conflicts");
  const publishing = item("publishing");

  if (
    setup &&
    setup.level !== "ready" &&
    optimisation?.status === "Not run"
  ) {
    return {
      level: setup.level === "blocked" ? "blocked" : "review",
      title:
        setup.status === "Not started"
          ? "Event setup not started"
          : "Event setup incomplete",
      description: setup.description,
      actionId: "setup",
    };
  }

  if (conflicts?.level === "blocked") {
    return {
      level: "blocked",
      title: "Event action needed",
      description: conflicts.summary ?? conflicts.description,
      actionId: "conflicts",
    };
  }

  if (publishing?.status === "Publish failed") {
    return {
      level: "blocked",
      title: "Event publishing failed",
      description: publishing.summary ?? publishing.description,
      actionId: "publishing",
    };
  }

  if (publishing?.status === "No target" && optimisation?.level === "ready") {
    return {
      level: "blocked",
      title: "Event publishing not configured",
      description: "Choose where schedules should be published.",
      actionId: "publishing",
    };
  }

  if (publishing?.status === "Not published" && optimisation?.level === "ready") {
    return {
      level: "unknown",
      title: "Event not published",
      description: publishing.summary ?? publishing.description,
      actionId: "publishing",
    };
  }

  if (publishing?.status === "Changes pending") {
    return {
      level: "review",
      title: "Event changes pending",
      description:
        publishing.summary ?? manualChanges?.summary ?? eventManualEditSentence(manualChanges),
      actionId: manualChanges?.level === "review" ? "manualChanges" : "publishing",
    };
  }

  if (publishing?.status === "Publish incomplete") {
    return {
      level: "review",
      title: "Event publish incomplete",
      description: publishing.summary ?? publishing.description,
      actionId: "publishing",
    };
  }

  if (publishing?.status === "Partially published") {
    return {
      level: "review",
      title: "Event partially published",
      description: publishing.summary ?? publishing.description,
      actionId: "publishing",
    };
  }

  if (publishing?.status === "Not ready to publish") {
    return {
      level: "review",
      title: "Event not ready to publish",
      description: publishing.summary ?? publishing.description,
      actionId: "publishing",
    };
  }

  if (publishing?.status === "Fully published") {
    return {
      level: "ready",
      title: "Event fully published",
      description: publishing.summary ?? "Full schedule is up to date.",
      actionId: "publishing",
    };
  }

  if (manualChanges?.level === "review") {
    return {
      level: "review",
      title: "Event review needed",
      description: manualChanges.summary ?? eventManualEditSentence(manualChanges),
      actionId: "manualChanges",
    };
  }

  if (optimisation?.level === "ready") {
    return {
      level: "ready",
      title: "Event ready to publish",
      description:
        optimisation.summary ?? "Full schedule is ready for review and publishing.",
      actionId: "publishing",
    };
  }

  if (optimisation?.status === "Failed") {
    return {
      level: "blocked",
      title: "Event optimisation failed",
      description: optimisation.description,
      actionId: "optimisation",
    };
  }

  if (optimisation?.status === "Running" || optimisation?.status === "Queued") {
    return {
      level: "review",
      title: "Event optimisation in progress",
      description: optimisation.description,
      actionId: "optimisation",
    };
  }

  if (optimisation?.status === "Not run") {
    return {
      level: "unknown",
      title: "Event optimisation not run",
      description: "Run optimisation when setup is ready.",
      actionId: "optimisation",
    };
  }

  return {
    level: "unknown",
    title: "Status unknown",
    description: "Some event status data is still loading.",
  };
}

function eventManualEditSentence(item?: EventStatusItem): string {
  if (!item || item.status === "None") {
    return "Review the full schedule before publishing.";
  }

  const match = item.status.match(/^(\d+)\s+edits?$/);
  if (!match) {
    return "Manual edits across the full schedule should be checked before publishing.";
  }

  const count = Number(match[1]);
  return `${count} manual ${count === 1 ? "edit" : "edits"} across the full schedule.`;
}

function buildManualEditSummary(
  editCount: number,
  lastOptimisedText: string | null,
  lastManualEditText: string | null,
): string {
  const countText = `${editCount} manual ${
    editCount === 1 ? "edit" : "edits"
  }`;
  const sinceText = lastOptimisedText
    ? ` since last optimisation ${lastOptimisedText}`
    : " since last optimisation";
  const editText = lastManualEditText
    ? `, last edited ${lastManualEditText}`
    : "";
  return `${countText}${sinceText}${editText}.`;
}

function buildManualEditDescription(
  editCount: number,
  lastOptimisedText: string | null,
  lastManualEditText: string | null,
): string {
  const summary = buildManualEditSummary(
    editCount,
    lastOptimisedText,
    lastManualEditText,
  );
  return `The final schedule contains ${summary.replace(/\.$/, "")}. Review ${
    editCount === 1 ? "it" : "them"
  } before publishing.`;
}

function getEventPublishStatusLabel(
  state: EventPublishStatus["state"],
): string {
  switch (state) {
    case "fully_published":
      return "Fully published";
    case "partially_published":
      return "Partially published";
    case "changes_pending":
      return "Changes pending";
    case "publish_incomplete":
      return "Publish incomplete";
    case "publish_failed":
      return "Publish failed";
    case "not_ready":
      return "Not ready to publish";
    case "not_published":
    default:
      return "Not published";
  }
}

function getEventPublishConfidenceLevel(
  state: EventPublishStatus["state"],
): ConfidenceLevel {
  if (state === "fully_published") return "ready";
  if (state === "publish_failed") return "blocked";
  if (state === "not_published") return "unknown";
  return "review";
}

function formatPublishIssueCounts(
  failedDays: number,
  notReadyDays: number,
): string {
  const parts: string[] = [];
  if (failedDays > 0) {
    parts.push(`${failedDays} ${pluralise(failedDays, "day failed", "days failed")}`);
  }
  if (notReadyDays > 0) {
    parts.push(
      `${notReadyDays} ${pluralise(
        notReadyDays,
        "day is not ready",
        "days are not ready",
      )}`,
    );
  }
  return parts.join(", ");
}

function pluralise(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function getLatestJob(jobs: JobSummary[]): JobSummary | null {
  return [...jobs]
    .filter((job) => !job.is_test_run)
    .sort((a, b) => {
      const aTime = Date.parse(b.created_at || "") || 0;
      const bTime = Date.parse(a.created_at || "") || 0;
      return aTime - bTime;
    })[0] ?? null;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortJsonValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return value;
}

function getCurrentScheduleValue(optimised: unknown, final: unknown): unknown {
  return hasScheduleData(final) ? final : optimised;
}

function normaliseScheduleForComparison(value: unknown): {
  startTime: number | null;
  endTime: number | null;
  locationKey: string;
  assignmentKey: string;
  assignedPersonIds: number[];
} {
  const schedule =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const assignedPersonIds = collectAssignedPersonIds(schedule);
  return {
    startTime: normaliseTime(schedule.start_time),
    endTime: normaliseTime(schedule.end_time),
    locationKey: [
      normaliseId(schedule.location ?? schedule.location_id),
      normaliseId(schedule.start_location ?? schedule.start_location_id),
      normaliseId(schedule.end_location ?? schedule.end_location_id),
      normaliseId(schedule.destination_location_id),
    ].join("|"),
    assignedPersonIds,
    assignmentKey: assignedPersonIds.join("|"),
  };
}

function collectAssignedPersonIds(schedule: Record<string, unknown>): number[] {
  const ids = new Set<number>();
  const direct = Array.isArray(schedule.assigned_persons)
    ? schedule.assigned_persons
    : [];
  for (const personId of direct) {
    const numeric = Number(personId);
    if (Number.isFinite(numeric)) ids.add(numeric);
  }

  const fieldAssignments = schedule.field_assignments;
  if (fieldAssignments && typeof fieldAssignments === "object") {
    for (const value of Object.values(
      fieldAssignments as Record<string, unknown>,
    )) {
      if (!Array.isArray(value)) continue;
      for (const personId of value) {
        const numeric = Number(personId);
        if (Number.isFinite(numeric)) ids.add(numeric);
      }
    }
  }

  return Array.from(ids).sort((a, b) => a - b);
}

function normaliseTime(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    if (value.includes(":")) {
      const [hours, minutes] = value.split(":").map(Number);
      if (Number.isFinite(hours) && Number.isFinite(minutes)) {
        return hours * 60 + minutes;
      }
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function normaliseId(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : String(value);
}
