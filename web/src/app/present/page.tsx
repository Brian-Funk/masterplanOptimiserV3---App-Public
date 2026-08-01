"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { EventProvider, useEvent } from "@/contexts/EventContext";
import {
  TaskInstanceProvider,
  useTaskInstances,
} from "@/contexts/TaskInstanceContext";
import {
  locationsApi,
  groupsApi,
  personsApi,
  taskTypesApi,
  taskTemplatesApi,
} from "@/lib/api";
import type { Group, Person, Location, TaskType, TaskTemplate } from "@/lib/api";
import type { CalendarDensity, CalendarTask } from "@/components/Calendar";
import Calendar from "@/components/Calendar";
import { toCalendarTask } from "@/lib/calendarTaskUtils";
import { formatDateWithWeekday } from "@/lib/dateFormat";
import PresentSlide from "@/components/presentation/PresentSlide";
import PresentSidebar from "@/components/presentation/PresentSidebar";
import CalendarViewSlide from "@/components/presentation/CalendarViewSlide";
import { useShortcuts } from "@/contexts/ShortcutContext";
import { isEditableTarget } from "@/lib/shortcuts";
import {
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  LayoutList,
  Maximize,
  Minimize,
} from "lucide-react";
import { getScheduleDayBoundaryFromRange } from "@/lib/workingDayBoundary";
import {
  getPresentationFullscreenState,
  togglePresentationFullscreen,
} from "@/lib/presentationFullscreen";

// ----- Types -----

type ViewMode = "overview" | "detail";

// ----- Main inner component (needs context) -----

function PresentInner() {
  const { availableEvents, selectedEventId, setSelectedEventId } = useEvent();
  const { instances } = useTaskInstances();
  const { matchesShortcut } = useShortcuts();

  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Current date (synced from OptimisedTab)
  const [currentDate, setCurrentDate] = useState<string>("");
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [density, setDensity] = useState<CalendarDensity>("comfortable");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(288);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Animation direction for carousel
  const [slideDirection, setSlideDirection] = useState<"left" | "right" | null>(
    null,
  );

  const channelRef = useRef<BroadcastChannel | null>(null);
  const expectedEventIdRef = useRef<number | null>(null);
  const rightCalRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);

  // Drag-resize handler for right sidebar
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;
      const startX = e.clientX;
      const startWidth = rightSidebarWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isResizingRef.current) return;
        const delta = startX - ev.clientX;
        const newWidth = Math.min(600, Math.max(200, startWidth + delta));
        setRightSidebarWidth(newWidth);
      };

      const onMouseUp = () => {
        isResizingRef.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [rightSidebarWidth],
  );

  // Parse event id + date from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const eventIdStr = params.get("event");
    const dateStr = params.get("date");
    if (eventIdStr) {
      const eid = parseInt(eventIdStr, 10);
      expectedEventIdRef.current = Number.isNaN(eid) ? null : eid;
      if (!isNaN(eid) && eid !== selectedEventId) {
        setSelectedEventId(eid);
      }
    }
    if (dateStr) {
      setCurrentDate(dateStr);
    }
  }, []);

  useEffect(() => {
    if (selectedEventId != null) {
      expectedEventIdRef.current = selectedEventId;
    }
  }, [selectedEventId]);

  const selectedEvent = useMemo(
    () => availableEvents.find((e) => e.id === selectedEventId) || null,
    [availableEvents, selectedEventId],
  );
  const scheduleDayRange = selectedEvent?.meta_data?.schedule_day_range;
  const scheduleDayBoundary = getScheduleDayBoundaryFromRange(scheduleDayRange);

  // Default date to event start if not set
  useEffect(() => {
    if (selectedEvent && !currentDate) {
      setCurrentDate(selectedEvent.start_date);
    }
  }, [selectedEvent, currentDate]);

  // Fetch reference data
  useEffect(() => {
    if (!selectedEvent) return;
    let cancelled = false;

    (async () => {
      const [types, pers, locs, tmpls, groupRows] = await Promise.all([
        taskTypesApi.getAll(),
        personsApi.getAll(selectedEvent.id),
        locationsApi.getAll(selectedEvent.id),
        taskTemplatesApi.getAll(),
        groupsApi.getAll(selectedEvent.id),
      ]);
      if (cancelled) return;
      setTaskTypes(types);
      setPersons(pers);
      setLocations(locs);
      setTemplates(tmpls);
      setGroups(groupRows);
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedEvent?.id]);

  // Convert instances to CalendarTasks
  const allCalendarTasks = useMemo(() => {
    if (!selectedEvent || !loaded) return [];
    return instances
      .filter(
        (inst: any) =>
          inst.event_id === selectedEvent.id && (inst.optimised || inst.final),
      )
      .map((inst: any) =>
        toCalendarTask(
          inst,
          templates,
          taskTypes,
          persons,
          locations,
          groups,
          scheduleDayBoundary.offsetHour,
        ),
      );
  }, [
    instances,
    selectedEvent,
    loaded,
    templates,
    taskTypes,
    persons,
    locations,
    groups,
    scheduleDayBoundary.offsetHour,
  ]);

  // Tasks for current day only, sorted by start time
  const dayTasks = useMemo(() => {
    if (!currentDate) return [];
    return allCalendarTasks
      .filter((t) => t.date === currentDate)
      .sort((a, b) => {
        const aStart = a.start_end_time?.start || "99:99";
        const bStart = b.start_end_time?.start || "99:99";
        return aStart.localeCompare(bStart);
      });
  }, [allCalendarTasks, currentDate]);

  // Day label
  const daySummary = useMemo(() => {
    if (!selectedEvent || !currentDate) {
      return { title: "", dateText: "", label: "" };
    }
    const alias = selectedEvent.meta_data?.day_aliases?.[currentDate];
    const start = new Date(selectedEvent.start_date + "T00:00:00");
    const current = new Date(currentDate + "T00:00:00");
    const dayNum =
      Math.floor(
        (current.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
      ) + 1;
    const formatted = formatDateWithWeekday(currentDate);
    const title = alias || `Day ${dayNum}`;
    const label = alias
      ? `${alias} (Day ${dayNum}) - ${formatted}`
      : `Day ${dayNum} - ${formatted}`;
    return { title, dateText: formatted, label };
  }, [selectedEvent, currentDate]);

  const dayLabel = daySummary.label;

  // All dates that have tasks
  const availableDates = useMemo(() => {
    const dates = new Set<string>();
    allCalendarTasks.forEach((t) => {
      if (t.date) dates.add(t.date);
    });
    return [...dates].sort();
  }, [allCalendarTasks]);

  // Clamp task index
  useEffect(() => {
    if (currentTaskIndex >= dayTasks.length && dayTasks.length > 0) {
      setCurrentTaskIndex(dayTasks.length - 1);
    }
  }, [dayTasks.length]);

  const currentTask = dayTasks[currentTaskIndex] || null;

  // Auto-scroll right mini-calendar to keep highlighted task visible
  useEffect(() => {
    if (!currentTask || rightSidebarCollapsed) return;
    const container = rightCalRef.current;
    if (!container) return;
    // Calendar cards have data-task-id attribute
    const el = container.querySelector(`[data-task-id="${currentTask.id}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [currentTask?.id, rightSidebarCollapsed]);

  // Navigation
  const goToTask = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(dayTasks.length - 1, index));
      if (clamped > currentTaskIndex) {
        setSlideDirection("left");
      } else if (clamped < currentTaskIndex) {
        setSlideDirection("right");
      }
      setCurrentTaskIndex(clamped);
      setTimeout(() => setSlideDirection(null), 350);
    },
    [dayTasks.length, currentTaskIndex],
  );

  const goNext = useCallback(
    () => goToTask(currentTaskIndex + 1),
    [currentTaskIndex, goToTask],
  );
  const goPrev = useCallback(
    () => goToTask(currentTaskIndex - 1),
    [currentTaskIndex, goToTask],
  );

  // Day navigation
  const goToDay = useCallback((date: string) => {
    setCurrentDate(date);
    setCurrentTaskIndex(0);
    setSlideDirection(null);
  }, []);

  const goNextDay = useCallback(() => {
    const idx = availableDates.indexOf(currentDate);
    if (idx >= 0 && idx < availableDates.length - 1) {
      goToDay(availableDates[idx + 1]);
    }
  }, [availableDates, currentDate, goToDay]);

  const goPrevDay = useCallback(() => {
    const idx = availableDates.indexOf(currentDate);
    if (idx > 0) {
      goToDay(availableDates[idx - 1]);
    }
  }, [availableDates, currentDate, goToDay]);

  // Select task by id (from sidebar click or calendar double-click)
  const selectTask = useCallback(
    (taskId: number) => {
      const idx = dayTasks.findIndex((t) => t.id === taskId);
      if (idx >= 0) {
        goToTask(idx);
        setViewMode("detail");
      }
    },
    [dayTasks, goToTask],
  );

  // BroadcastChannel for syncing with OptimisedTab
  useEffect(() => {
    try {
      const ch = new BroadcastChannel("presentation-sync");
      channelRef.current = ch;

      ch.onmessage = (e) => {
        const { action, date, eventId, source } = e.data || {};
        const expectedEventId = expectedEventIdRef.current;
        if (typeof eventId !== "number" || eventId !== expectedEventId) {
          return;
        }

        if (
          action === "date-change" &&
          source === "optimised" &&
          typeof date === "string"
        ) {
          setCurrentDate(date);
          setCurrentTaskIndex(0);
          setViewMode("overview");
        } else if (action === "goto-task") {
          selectTask(e.data.taskId);
        }
      };

      return () => ch.close();
    } catch {
      return;
    }
  }, [selectTask]);

  // Broadcast current state back
  useEffect(() => {
    try {
      channelRef.current?.postMessage({
        action: "slide-changed",
        taskId: currentTask?.id || null,
        date: currentDate,
        viewMode,
      });
    } catch {}
  }, [currentTaskIndex, currentTask, currentDate, viewMode]);

  const refreshFullscreenState = useCallback(async () => {
    setIsFullscreen(await getPresentationFullscreenState());
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    const result = await togglePresentationFullscreen();
    setIsFullscreen(result.isFullscreen);
  }, []);

  // Track browser and native Electron fullscreen state.
  useEffect(() => {
    const handler = () => {
      void refreshFullscreenState();
    };
    const unsubscribeNative =
      window.electron?.onWindowFullscreenChange?.((fullscreen) => {
        setIsFullscreen(fullscreen);
      }) || (() => {});

    document.addEventListener("fullscreenchange", handler);
    void refreshFullscreenState();

    return () => {
      document.removeEventListener("fullscreenchange", handler);
      unsubscribeNative();
    };
  }, [refreshFullscreenState]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      if (matchesShortcut(e, "presentation.nextTask")) {
        e.preventDefault();
        if (viewMode === "detail") goNext();
        return;
      }
      if (matchesShortcut(e, "presentation.previousTask")) {
        e.preventDefault();
        if (viewMode === "detail") goPrev();
        return;
      }
      if (matchesShortcut(e, "presentation.nextDay")) {
        e.preventDefault();
        goNextDay();
        return;
      }
      if (matchesShortcut(e, "presentation.previousDay")) {
        e.preventDefault();
        goPrevDay();
        return;
      }
      if (matchesShortcut(e, "presentation.toggleTaskList")) {
        e.preventDefault();
        setSidebarCollapsed((v) => !v);
        return;
      }
      if (matchesShortcut(e, "presentation.toggleCalendarSidebar")) {
        e.preventDefault();
        setRightSidebarCollapsed((v) => !v);
        return;
      }
      if (matchesShortcut(e, "presentation.toggleView")) {
        e.preventDefault();
        setViewMode((v) => (v === "overview" ? "detail" : "overview"));
        return;
      }
      if (matchesShortcut(e, "presentation.backOrClose")) {
        e.preventDefault();
        if (viewMode === "detail") {
          setViewMode("overview");
        } else {
          window.close();
        }
        return;
      }
      if (matchesShortcut(e, "presentation.toggleFullscreen")) {
        e.preventDefault();
        void handleToggleFullscreen();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    goNext,
    goPrev,
    goNextDay,
    goPrevDay,
    handleToggleFullscreen,
    matchesShortcut,
    viewMode,
  ]);

  // Loading state
  if (!selectedEvent || !loaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-alt/40 text-foreground">
        <div className="w-full max-w-sm rounded-xl border border-bordercl-subtle bg-surface px-6 py-7 text-center shadow-sm">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
          <p className="text-sm font-medium text-foreground">
            Loading presentation...
          </p>
          <p className="mt-1 text-sm text-foreground-muted">
            Preparing the schedule view.
          </p>
        </div>
      </div>
    );
  }

  if (dayTasks.length === 0 && currentDate) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-alt/40 px-6 text-foreground">
        <div className="w-full max-w-xl rounded-xl border border-bordercl-subtle bg-surface px-8 py-7 text-center shadow-sm">
          <p className="text-xl font-semibold text-foreground">
            No tasks scheduled for this day.
          </p>
          <p className="mt-2 text-sm text-foreground-muted">
            {dayLabel || currentDate}
          </p>
          <p className="mt-4 text-sm text-foreground-muted">
            This day has not been optimised yet. Change day or run optimisation
            from the desktop app.
          </p>
        </div>
      </div>
    );
  }

  // Sidebar day groups (current day only)
  const sidebarDayGroups = [
    { date: currentDate, label: dayLabel, tasks: dayTasks },
  ];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface">
      {/* Sidebar */}
      <PresentSidebar
        dayGroups={sidebarDayGroups}
        currentTaskId={viewMode === "detail" ? (currentTask?.id ?? null) : null}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
        onSelectTask={selectTask}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div
          className="flex items-center justify-between border-b border-bordercl-subtle bg-surface px-6 py-3"
          data-testid="presentation-header"
        >
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="truncate text-sm font-semibold text-foreground">
                {selectedEvent.name}
              </h2>
              <span className="text-foreground-faint">/</span>
              <span className="truncate text-sm font-medium text-foreground-secondary">
                {daySummary.title}
              </span>
              <span className="text-foreground-faint">/</span>
              <span className="text-sm text-foreground-muted">
                Final schedule
              </span>
            </div>
            <p className="mt-0.5 text-xs text-foreground-faint">
              {daySummary.dateText} / {dayTasks.length} task
              {dayTasks.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={goPrevDay}
              disabled={availableDates.indexOf(currentDate) <= 0}
              className="rounded p-1.5 text-foreground-muted transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-30"
              title="Previous day"
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={goNextDay}
              disabled={
                availableDates.indexOf(currentDate) < 0 ||
                availableDates.indexOf(currentDate) >= availableDates.length - 1
              }
              className="rounded p-1.5 text-foreground-muted transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-30"
              title="Next day"
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="mx-1 h-5 w-px bg-bordercl-subtle" />
            {/* View mode toggle */}
            <button
              onClick={() => setViewMode("overview")}
              className={`rounded p-1.5 transition-colors ${
                viewMode === "overview"
                  ? "bg-primary-500/10 text-primary-700 dark:text-primary-300"
                  : "text-foreground-muted hover:bg-surface-hover"
              }`}
              title="Calendar overview (C)"
              aria-label="Calendar overview"
            >
              <CalendarIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("detail")}
              className={`rounded p-1.5 transition-colors ${
                viewMode === "detail"
                  ? "bg-primary-500/10 text-primary-700 dark:text-primary-300"
                  : "text-foreground-muted hover:bg-surface-hover"
              }`}
              title="Task detail view (C)"
              aria-label="Task detail view"
            >
              <LayoutList className="w-4 h-4" />
            </button>
            <div className="mx-1 flex rounded-md border border-bordercl-subtle bg-surface-alt/50 p-0.5">
              <button
                onClick={() => setDensity("comfortable")}
                aria-label="Comfortable density"
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  density === "comfortable"
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                Comfortable
              </button>
              <button
                onClick={() => setDensity("compact")}
                aria-label="Compact density"
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  density === "compact"
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                Compact
              </button>
            </div>
            <div className="w-px h-5 bg-bordercl-subtle mx-1" />
            {/* Fullscreen toggle */}
            <button
              onClick={() => void handleToggleFullscreen()}
              className="rounded p-1.5 text-foreground-muted transition-colors hover:bg-surface-hover"
              title="Toggle fullscreen (F)"
              aria-label="Toggle fullscreen"
            >
              {isFullscreen ? (
                <Minimize className="w-4 h-4" />
              ) : (
                <Maximize className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 relative overflow-hidden">
          {viewMode === "overview" ? (
            <CalendarViewSlide
              date={currentDate}
              dayLabel={dayLabel}
              tasks={dayTasks}
              density={density}
              scheduleDayRange={scheduleDayRange}
              scheduleDayBoundary={scheduleDayBoundary}
              onTaskDoubleClick={selectTask}
            />
          ) : (
            /* Detail view: task detail + right mini-calendar sidebar */
            <div className="flex h-full select-none bg-surface-alt/40">
              {/* Task detail - scrollable center */}
              <div className="flex-1 overflow-y-auto p-8">
                <div
                  className={`mx-auto max-w-5xl ${
                    slideDirection === "left"
                      ? "animate-slide-in-right-present"
                      : slideDirection === "right"
                        ? "animate-slide-in-left"
                        : ""
                  }`}
                  key={currentTask?.id}
                >
                  {currentTask && (
                    <PresentSlide
                      task={currentTask}
                      slideIndex={currentTaskIndex}
                      totalSlides={dayTasks.length}
                      persons={persons}
                      templates={templates}
                      onBack={() => setViewMode("overview")}
                    />
                  )}
                </div>
              </div>

              {/* Right sidebar - resizable mini calendar */}
              {rightSidebarCollapsed ? (
                <button
                  onClick={() => setRightSidebarCollapsed(false)}
                  className="absolute right-0 top-1/2 z-30 -translate-y-1/2 rounded-l-lg border border-bordercl-subtle bg-surface px-1.5 py-4 shadow-sm transition-colors hover:bg-surface-hover"
                  title="Show calendar (R)"
                  aria-label="Show calendar"
                >
                  <ChevronLeft className="w-4 h-4 text-foreground-muted" />
                </button>
              ) : (
                <div
                  className="relative z-20 flex flex-shrink-0 flex-col overflow-hidden border-l border-bordercl-subtle bg-surface"
                  style={{ width: rightSidebarWidth }}
                >
                  {/* Drag handle */}
                  <div
                    onMouseDown={startResize}
                    className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary-400/30 active:bg-primary-400/50 transition-colors z-10"
                  />
                  {/* Collapse button */}
                  <button
                    onClick={() => setRightSidebarCollapsed(true)}
                    className="absolute top-2 right-2 z-10 p-0.5 hover:bg-surface-hover rounded transition-colors"
                    title="Hide calendar (R)"
                    aria-label="Hide calendar"
                  >
                    <ChevronRight className="w-3.5 h-3.5 text-foreground-faint" />
                  </button>
                  <div
                    ref={rightCalRef}
                    className="flex-1 overflow-y-auto present-mini-cal"
                  >
                    <Calendar
                      tasks={dayTasks}
                      viewType="daily"
                      selectedDate={currentDate}
                      onTaskEdit={(task) => selectTask(task.id)}
                      highlightedTaskIds={currentTask ? [currentTask.id] : []}
                      scheduleDayRange={scheduleDayRange}
                      scheduleDayBoundary={scheduleDayBoundary}
                      presentationMode
                      density="compact"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom nav for detail view */}
        {viewMode === "detail" && (
          <div className="flex items-center justify-center gap-4 border-t border-bordercl-subtle bg-surface px-6 py-3">
            <button
              onClick={goPrev}
              disabled={currentTaskIndex === 0}
              className="rounded border border-bordercl-subtle px-3 py-1 text-xs text-foreground-secondary transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-30"
            >
              Previous
            </button>
            <span className="text-xs text-foreground-muted">
              {currentTaskIndex + 1} / {dayTasks.length}
            </span>
            <button
              onClick={goNext}
              disabled={currentTaskIndex >= dayTasks.length - 1}
              className="rounded border border-bordercl-subtle px-3 py-1 text-xs text-foreground-secondary transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-30"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ----- Page wrapper with providers -----

export default function PresentPage() {
  return (
    <EventProvider>
      <TaskInstanceProvider>
        <PresentInner />
      </TaskInstanceProvider>
    </EventProvider>
  );
}
