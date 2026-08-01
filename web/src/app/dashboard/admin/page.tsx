"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { OptimizationProvider } from "@/contexts/OptimizationContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { useEvent } from "@/contexts/EventContext";
import { useTaskInstances } from "@/contexts/TaskInstanceContext";
import {
  appSettingsApi,
  locationsApi,
  type Person,
  personsApi,
  publishStateApi,
  type PublishTarget,
} from "@/lib/api";
import { optimizationApi } from "@/lib/optimizationApi";
import type { JobSummary } from "@/types/optimization";
import {
  deriveEventStatusSummary,
  getScheduleFingerprint,
  type PublishedDayRecords,
} from "@/lib/eventStatusSummary";
import { MainTab, InputSection, TasksSection } from "./types/tabs";
import { TaskBuilderTab } from "./tabs/TaskBuilderTab";
import { PersonManagementTab } from "./tabs/UserManagementTab";
import LocationsContent from "./tabs/LocationsContent";
import GroupsContent from "./tabs/GroupsContent";
import { AudienceTeamsContent } from "./tabs/AudienceTeamsContent";
import { CMITab } from "./tabs/CMITab";
import { GeneralScheduleTab } from "./tabs/GeneralScheduleTab";
import { OptimisedTab } from "./tabs/optimised/OptimisedTab";
import {
  EventStatusBar,
  type EventStatusBarActions,
} from "./components/EventStatusBar";

export default function AdminPage() {
  const router = useRouter();
  const [mainTab, setMainTab] = useState<MainTab>("input");
  const [inputSection, setInputSection] = useState<InputSection>("users");
  const [tasksSection, setTasksSection] =
    useState<TasksSection>("task-builder");
  const [generalScheduleInitialDate, setGeneralScheduleInitialDate] =
    useState<string>("");
  const [personCount, setPersonCount] = useState<number | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [locationCount, setLocationCount] = useState<number | null>(null);
  const [publishTarget, setPublishTarget] = useState<PublishTarget>("none");
  const [optimisationJobs, setOptimisationJobs] = useState<JobSummary[]>([]);
  const [publishedScheduleFingerprint, setPublishedScheduleFingerprint] =
    useState<string | null>(null);
  const [publishedScheduleScope, setPublishedScheduleScope] = useState<
    "all" | "partial" | null
  >(null);
  const [publishedDayRecords, setPublishedDayRecords] =
    useState<PublishedDayRecords>({});
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [publishFailedAt, setPublishFailedAt] = useState<string | null>(null);
  const [conflictFocusToken, setConflictFocusToken] = useState(0);
  const [manualChangeFocusToken, setManualChangeFocusToken] = useState(0);

  const { selectedEventId, availableEvents } = useEvent();
  const { instances } = useTaskInstances();
  const selectedEvent =
    availableEvents.find((e) => e.id === selectedEventId) || null;
  const eventInstances = useMemo(
    () =>
      selectedEvent
        ? instances.filter((instance) => instance.event_id === selectedEvent.id)
        : [],
    [instances, selectedEvent],
  );

  useEffect(() => {
    let cancelled = false;

    if (!selectedEvent?.id) {
      setPersonCount(null);
      setPeople([]);
      setLocationCount(null);
      setPublishTarget("none");
      setOptimisationJobs([]);
      setPublishedScheduleFingerprint(null);
      setPublishedScheduleScope(null);
      setPublishedDayRecords({});
      setPublishedAt(null);
      setPublishFailedAt(null);
      return;
    }

    setPersonCount(null);
    setPeople([]);
    setLocationCount(null);
    setOptimisationJobs([]);
    setPublishedScheduleFingerprint(null);
    setPublishedScheduleScope(null);
    setPublishedDayRecords({});
    setPublishedAt(null);
    setPublishFailedAt(null);

    Promise.allSettled([
      personsApi.getAll(selectedEvent.id),
      locationsApi.getAll(selectedEvent.id),
      appSettingsApi.getPublishTarget(),
      optimizationApi.getJobsForEvent(selectedEvent.id),
      publishStateApi.get(selectedEvent.id),
    ]).then(([peopleResult, locationsResult, publishResult, jobsResult, publishStateResult]) => {
      if (cancelled) return;

      setPersonCount(
        peopleResult.status === "fulfilled" ? peopleResult.value.length : null,
      );
      setPeople(
        peopleResult.status === "fulfilled" ? peopleResult.value : [],
      );
      setLocationCount(
        locationsResult.status === "fulfilled"
          ? locationsResult.value.length
          : null,
      );
      setPublishTarget(
        publishResult.status === "fulfilled"
          ? publishResult.value.target
          : "none",
      );
      setOptimisationJobs(
        jobsResult.status === "fulfilled" ? jobsResult.value.jobs : [],
      );
      if (publishStateResult.status === "fulfilled") {
        const publishState = publishStateResult.value;
        setPublishedScheduleFingerprint(
          publishState.published_schedule_fingerprint || null,
        );
        setPublishedScheduleScope(
          publishState.published_schedule_scope === "all" ||
            publishState.published_schedule_scope === "partial"
            ? publishState.published_schedule_scope
            : null,
        );
        setPublishedDayRecords(publishState.day_records || {});
        setPublishedAt(publishState.published_at || null);
        setPublishFailedAt(publishState.publish_failed_at || null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedEvent?.id]);

  useEffect(() => {
    if (!selectedEvent?.id || typeof window === "undefined") return;

    const handlePublishedScheduleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{
        eventId?: number;
        fingerprint?: string | null;
        scope?: "all" | "partial" | null;
        publishedAt?: string | null;
        dayRecords?: PublishedDayRecords | null;
      }>).detail;
      if (detail?.eventId !== selectedEvent.id) return;
      setPublishedScheduleFingerprint(detail.fingerprint || null);
      setPublishedScheduleScope(detail.scope || null);
      if (detail.dayRecords) setPublishedDayRecords(detail.dayRecords);
      setPublishedAt(detail.publishedAt || null);
      setPublishFailedAt(null);
    };

    const handlePublishStatusUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{
        eventId?: number;
        publishFailedAt?: string | null;
        dayRecords?: PublishedDayRecords | null;
      }>).detail;
      if (detail?.eventId !== selectedEvent.id) return;
      setPublishFailedAt(detail.publishFailedAt || null);
      if (detail.dayRecords) setPublishedDayRecords(detail.dayRecords);
    };

    window.addEventListener(
      "published-schedule-updated",
      handlePublishedScheduleUpdate,
    );
    window.addEventListener("publish-status-updated", handlePublishStatusUpdate);
    return () => {
      window.removeEventListener(
        "published-schedule-updated",
        handlePublishedScheduleUpdate,
      );
      window.removeEventListener(
        "publish-status-updated",
        handlePublishStatusUpdate,
      );
    };
  }, [selectedEvent?.id]);

  const currentScheduleFingerprint = useMemo(
    () => getScheduleFingerprint(eventInstances),
    [eventInstances],
  );

  const eventStatusSummary = useMemo(
    () =>
      deriveEventStatusSummary({
        eventStatus: selectedEvent?.status,
        personCount,
        people,
        locationCount,
        taskInstances: eventInstances,
        publishTarget,
        jobs: optimisationJobs,
        currentScheduleFingerprint,
        publishedScheduleFingerprint,
        publishedScheduleScope,
        publishedDayRecords,
        publishedAt,
        publishFailedAt,
      }),
    [
      currentScheduleFingerprint,
      eventInstances,
      locationCount,
      optimisationJobs,
      people,
      personCount,
      publishTarget,
      publishedAt,
      publishedDayRecords,
      publishFailedAt,
      publishedScheduleFingerprint,
      publishedScheduleScope,
      selectedEvent?.status,
    ],
  );
  const statusBarActions = useMemo<EventStatusBarActions>(() => {
    const itemById = new Map(
      eventStatusSummary.items.map((item) => [item.id, item]),
    );
    const actions: EventStatusBarActions = {};

    if (itemById.get("setup")?.level !== "ready") {
      actions.setup = {
        label: "Continue setup",
        onClick: () => {
          setMainTab("input");
          setInputSection("users");
        },
      };
    }

    if (itemById.get("optimisation")?.level !== "ready") {
      actions.optimisation = {
        label: "Open CMI",
        onClick: () => {
          setMainTab("tasks");
          setTasksSection("cmi");
        },
      };
    }

    if (itemById.get("manualChanges")?.level === "review") {
      actions.manualChanges = {
        label: "Review",
        onClick: () => {
          setMainTab("optimisation");
          setManualChangeFocusToken((token) => token + 1);
        },
      };
    }

    if (itemById.get("conflicts")?.level !== "ready") {
      actions.conflicts = {
        label: "View",
        onClick: () => {
          setMainTab("optimisation");
          setConflictFocusToken((token) => token + 1);
        },
      };
    }

    if (itemById.get("publishing")?.level !== "ready") {
      actions.publishing = {
        label: publishTarget === "none" ? "Configure" : "Open schedule",
        onClick: () => {
          if (publishTarget === "none") {
            router.push("/dashboard/settings?section=publish-target");
            return;
          }
          setMainTab("optimisation");
        },
      };
    }

    return actions;
  }, [eventStatusSummary.items, publishTarget, router]);

  const workflowCopy: Record<MainTab, { title: string; description: string }> = {
    input: {
      title: "Event setup",
      description: "Manage the people, locations and groups used throughout the masterplan.",
    },
    "general-schedule": {
      title: "General Schedule",
      description: "Maintain the public programme separately from internal organiser tasks.",
    },
    tasks: {
      title: "Task planning",
      description: "Build task templates and place operational tasks in the CMI calendar.",
    },
    optimisation: {
      title: "Optimisation",
      description: "Review feasibility, resolve conflicts and prepare a publishable schedule.",
    },
    masterplan: {
      title: "Masterplan",
      description: "Review the current operational plan and its published state.",
    },
  };

  return (
    <OptimizationProvider>
      <div className="space-y-5">
        {/* Page Header */}
        <PageHeader
          eyebrow={selectedEvent?.name || "Loading..."}
          title={workflowCopy[mainTab].title}
          description={workflowCopy[mainTab].description}
        />

        {/* Tab Navigation */}
        <div className="border-b border-bordercl">
          <nav className="-mb-px flex gap-7" aria-label="Planning workflow">
            <button
              onClick={() => setMainTab("input")}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                mainTab === "input"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-foreground-muted hover:text-foreground-secondary hover:border-bordercl-strong"
              }`}
            >
              Input
            </button>
            <button
              onClick={() => setMainTab("general-schedule")}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                mainTab === "general-schedule"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-foreground-muted hover:text-foreground-secondary hover:border-bordercl-strong"
              }`}
            >
              General Schedule
            </button>
            <button
              onClick={() => setMainTab("tasks")}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                mainTab === "tasks"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-foreground-muted hover:text-foreground-secondary hover:border-bordercl-strong"
              }`}
            >
              Tasks
            </button>
            <button
              onClick={() => setMainTab("optimisation")}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                mainTab === "optimisation"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-foreground-muted hover:text-foreground-secondary hover:border-bordercl-strong"
              }`}
            >
              Optimisation
            </button>
          </nav>
        </div>

        {selectedEvent && (
          <EventStatusBar
            summary={eventStatusSummary}
            actions={statusBarActions}
          />
        )}

        {/* Tab Content */}
        <div className="workspace-section overflow-hidden">
          {mainTab === "input" && (
            <div className="flex">
              {/* Input Sidebar */}
              <div className="min-h-[600px] w-52 border-r border-bordercl bg-surface-alt/60">
                <nav className="p-4 space-y-1">
                  {/* Required Section */}
                  <div className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-2 px-3">
                    Required
                  </div>

                  <button
                    onClick={() => setInputSection("users")}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      inputSection === "users"
                        ? "bg-blue-100 text-blue-700"
                        : "text-foreground-secondary hover:bg-surface-hover"
                    }`}
                  >
                    Person Management
                  </button>

                  <button
                    onClick={() => setInputSection("locations")}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      inputSection === "locations"
                        ? "bg-blue-100 text-blue-700"
                        : "text-foreground-secondary hover:bg-surface-hover"
                    }`}
                  >
                    Location
                  </button>

                  {/* Additional Section */}
                  <div className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-2 px-3 mt-6">
                    Additional
                  </div>

                  <button
                    onClick={() => setInputSection("groups")}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      inputSection === "groups"
                        ? "bg-blue-100 text-blue-700"
                        : "text-foreground-secondary hover:bg-surface-hover"
                    }`}
                  >
                    Groups
                  </button>

                  <button
                    onClick={() => setInputSection("audience-teams")}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      inputSection === "audience-teams"
                        ? "bg-blue-100 text-blue-700"
                        : "text-foreground-secondary hover:bg-surface-hover"
                    }`}
                  >
                    Audience Teams
                  </button>
                </nav>
              </div>

              {/* Input Content */}
              <div className="flex-1">
                {inputSection === "users" && (
                  <PersonManagementTab selectedEvent={selectedEvent} />
                )}
                {inputSection === "locations" && (
                  <LocationsContent selectedEvent={selectedEvent} />
                )}
                {inputSection === "groups" && (
                  <GroupsContent selectedEvent={selectedEvent} />
                )}
                {inputSection === "audience-teams" && (
                  <AudienceTeamsContent selectedEvent={selectedEvent} />
                )}
              </div>
            </div>
          )}

          {mainTab === "tasks" && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bordercl bg-surface-subtle px-6 py-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Tasks</h3>
                  <p className="text-xs text-foreground-muted">
                    Build task templates, then place concrete tasks in CMI.
                  </p>
                </div>
                <nav className="inline-flex rounded-lg border border-bordercl bg-surface p-1 shadow-sm">
                  <button
                    onClick={() => setTasksSection("task-builder")}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      tasksSection === "task-builder"
                        ? "bg-blue-50 text-blue-700 shadow-sm dark:bg-blue-950/40 dark:text-blue-200"
                        : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"
                    }`}
                  >
                    Task Builder
                  </button>
                  <button
                    onClick={() => setTasksSection("cmi")}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      tasksSection === "cmi"
                        ? "bg-blue-50 text-blue-700 shadow-sm dark:bg-blue-950/40 dark:text-blue-200"
                        : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"
                    }`}
                  >
                    CMI Calendar
                  </button>
                </nav>
              </div>
              <div>
                {tasksSection === "task-builder" && (
                  <TaskBuilderTab selectedEvent={selectedEvent} />
                )}
                {tasksSection === "cmi" && (
                  <CMITab
                    selectedEvent={selectedEvent}
                    onOpenGeneralSchedule={(date) => {
                      setGeneralScheduleInitialDate(date);
                      setMainTab("general-schedule");
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {mainTab === "general-schedule" && selectedEvent && (
            <GeneralScheduleTab
              selectedEvent={selectedEvent}
              initialSelectedDate={generalScheduleInitialDate}
              onManageAudienceTeams={() => {
                setInputSection("audience-teams");
                setMainTab("input");
              }}
            />
          )}

          {mainTab === "optimisation" && (
            <div className="p-6">
              {!selectedEvent ? (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                  <p className="text-sm text-amber-800 dark:text-amber-300">
                    Please select an event to view optimisation options.
                  </p>
                </div>
              ) : (
                <OptimisedTab
                  selectedEvent={selectedEvent}
                  conflictFocusToken={conflictFocusToken}
                  manualChangeFocusToken={manualChangeFocusToken}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </OptimizationProvider>
  );
}
