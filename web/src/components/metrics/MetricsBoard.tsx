"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { Responsive, WidthProvider, Layout } from "react-grid-layout";
import { Plus, ChevronDown } from "lucide-react";
import { MetricRegistry } from "@/lib/metrics/MetricRegistry";
import {
  ScheduleData,
  MetricSettings,
  MetricBoxConfig,
} from "@/lib/metrics/MetricInterface";
import {
  personsApi,
  capabilitiesApi,
  eventsApi,
  taskTypesApi,
  taskTemplatesApi,
  Person,
  Capability,
  TaskType,
  TaskTemplate,
} from "@/lib/api";
import {
  METRICS_HIGHLIGHT_CHANNEL,
  postMetricHighlightClear,
} from "@/lib/metricsHighlightChannel";
import {
  buildMetricScheduleData,
  findWorstMaxHoursViolation,
} from "@/lib/metrics/metricScheduleData";
import { getScheduleDayBoundaryFromRange } from "@/lib/workingDayBoundary";
import MetricCard from "./MetricCard";
import { useTaskInstances } from "@/contexts/TaskInstanceContext";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const ResponsiveGridLayout = WidthProvider(Responsive);

const STORAGE_KEY = "metricsBoard";
const GRID_COLS = 12;
const ROW_HEIGHT = 80;
const DEFAULT_CARD_W = 6;
const DEFAULT_CARD_H = 4;

interface BoardState {
  cards: MetricBoxConfig[];
}

function loadBoardState(): BoardState {
  if (typeof window === "undefined") return { cards: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error("Failed to load metrics board state:", e);
  }
  return { cards: [] };
}

function saveBoardState(state: BoardState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to save metrics board state:", e);
  }
}

interface MetricsBoardProps {
  eventId?: number;
}

const MetricsBoard: React.FC<MetricsBoardProps> = ({ eventId }) => {
  const { instances: contextInstances } = useTaskInstances();
  const [boardState, setBoardState] = useState<BoardState>({ cards: [] });
  const [snapshot, setSnapshot] = useState<ScheduleData | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<ScheduleData | null>(
    null,
  );
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentDay, setCurrentDay] = useState<string | null>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const highlightChannelRef = useRef<BroadcastChannel | null>(null);

  // Refs for API data - needed to build preview snapshots on demand
  const apiPersonsRef = useRef<Person[]>([]);
  const apiCapabilitiesRef = useRef<Capability[]>([]);
  const apiTaskTypesRef = useRef<TaskType[]>([]);
  const apiTaskTemplatesRef = useRef<TaskTemplate[]>([]);
  const dayAliasesRef = useRef<Record<string, string>>({});
  const eventDatesRef = useRef<string[]>([]);
  const eventDayBoundariesRef = useRef<Record<number, ReturnType<typeof getScheduleDayBoundaryFromRange>>>({});

  const registry = useMemo(() => MetricRegistry.getInstance(), []);
  const allMetrics = useMemo(() => registry.getAll(), [registry]);
  const clearScheduleHighlights = useCallback(() => {
    postMetricHighlightClear(highlightChannelRef.current);
  }, []);

  // Create BroadcastChannel for cross-window communication
  useEffect(() => {
    try {
      highlightChannelRef.current = new BroadcastChannel(METRICS_HIGHLIGHT_CHANNEL);
      // Listen for preview-delta messages from edit modal / replacement menu
      highlightChannelRef.current.onmessage = (event) => {
        const msg = event.data;
        if (msg.action === "preview-delta") {
          try {
            const modified = contextInstances.map((t: any) => {
              if (t.id !== msg.taskId) return t;
              const schedule = t.final || t.optimised || {};
              let persons = [...(schedule.assigned_persons || [])];
              for (const id of msg.removePersonIds || []) {
                persons = persons.filter((pid: number) => pid !== id);
              }
              for (const id of msg.addPersonIds || []) {
                if (!persons.includes(id)) persons.push(id);
              }
              return {
                ...t,
                final: { ...schedule, assigned_persons: persons },
              };
            });
            const preview = buildMetricScheduleData(
              modified,
              apiPersonsRef.current,
              apiCapabilitiesRef.current,
              dayAliasesRef.current,
              apiTaskTypesRef.current,
              eventDatesRef.current,
              apiTaskTemplatesRef.current,
              eventDayBoundariesRef.current,
            );
            setPreviewSnapshot(preview.data);
          } catch (e) {
            console.error("Failed to build preview snapshot:", e);
            setPreviewSnapshot(null);
          }
        } else if (msg.action === "clear-preview") {
          setPreviewSnapshot(null);
        } else if (msg.action === "day-change" && msg.date) {
          setCurrentDay(msg.date);
        }
      };
    } catch (e) {
      // BroadcastChannel not supported in some environments
    }
    window.addEventListener("beforeunload", clearScheduleHighlights);
    return () => {
      window.removeEventListener("beforeunload", clearScheduleHighlights);
      clearScheduleHighlights();
      highlightChannelRef.current?.postMessage({ action: "clear-preview" });
      highlightChannelRef.current?.close();
    };
  }, [clearScheduleHighlights, contextInstances]);

  // Hover handlers for resource pills → broadcast to other windows
  const handleResourceHover = useCallback(
    (type: "person" | "capability", id: number) => {
      highlightChannelRef.current?.postMessage({
        action: "hover",
        type,
        id,
      });
    },
    [],
  );

  const handleResourceHoverEnd = useCallback(() => {
    highlightChannelRef.current?.postMessage({ action: "clear" });
  }, []);

  // Load board state from localStorage
  useEffect(() => {
    const stored = loadBoardState();
    setBoardState(stored);
  }, []);

  // Build schedule data from localStorage + API
  const refreshData = useCallback(async () => {
    setIsLoading(true);
    try {
      const taskInstances = contextInstances;

      // Determine event IDs from stored tasks (or use the provided eventId)
      const eventIds = new Set<number>();
      if (eventId) {
        eventIds.add(eventId);
      } else {
        for (const t of taskInstances) {
          if (t.event_id) eventIds.add(t.event_id);
        }
      }

      // Fetch persons for all relevant events + fetch events for day aliases
      const personPromises = Array.from(eventIds).map((eid) =>
        personsApi.getAll(eid).catch(() => [] as Person[]),
      );
      const [personArrays, allEvents, capabilities, taskTypes, taskTemplates] =
        await Promise.all([
          Promise.all(personPromises),
          eventsApi.getAll().catch(() => []),
          capabilitiesApi.getAll().catch(() => [] as Capability[]),
          taskTypesApi.getAll().catch(() => [] as TaskType[]),
          taskTemplatesApi.getAll().catch(() => [] as TaskTemplate[]),
        ]);

      // Deduplicate persons by id
      const personMap = new Map<number, Person>();
      for (const arr of personArrays) {
        for (const p of arr) {
          personMap.set(p.id, p);
        }
      }
      const persons = Array.from(personMap.values());

      // Merge day_aliases from all relevant events
      const dayAliases: Record<string, string> = {};
      const eventDayBoundaries: Record<number, ReturnType<typeof getScheduleDayBoundaryFromRange>> = {};
      for (const ev of allEvents) {
        if (eventIds.has(ev.id) && ev.meta_data?.day_aliases) {
          Object.assign(dayAliases, ev.meta_data.day_aliases);
        }
        if (eventIds.has(ev.id)) {
          eventDayBoundaries[ev.id] = getScheduleDayBoundaryFromRange(
            ev.meta_data?.schedule_day_range,
          );
        }
      }

      // Build sorted array of all event dates from start_date to end_date
      // Use UTC dates to avoid local-timezone offset shifting the day
      const eventDates: string[] = [];
      for (const ev of allEvents) {
        if (eventIds.has(ev.id) && ev.start_date && ev.end_date) {
          const start = new Date(ev.start_date + "T12:00:00Z");
          const end = new Date(ev.end_date + "T12:00:00Z");
          for (
            let d = new Date(start);
            d <= end;
            d.setUTCDate(d.getUTCDate() + 1)
          ) {
            const iso = d.toISOString().split("T")[0];
            if (!eventDates.includes(iso)) eventDates.push(iso);
          }
        }
      }
      eventDates.sort();

      // Store in refs for preview snapshot building
      apiPersonsRef.current = persons;
      apiCapabilitiesRef.current = capabilities;
      apiTaskTypesRef.current = taskTypes;
      apiTaskTemplatesRef.current = taskTemplates;
      dayAliasesRef.current = dayAliases;
      eventDatesRef.current = eventDates;
      eventDayBoundariesRef.current = eventDayBoundaries;

      const { data, diagnostics } = buildMetricScheduleData(
        taskInstances,
        persons,
        capabilities,
        dayAliases,
        taskTypes,
        eventDates,
        taskTemplates,
        eventDayBoundaries,
      );
      if (
        process.env.NODE_ENV !== "production" &&
        (diagnostics.skippedMissingTimes > 0 ||
          diagnostics.skippedInvalidDuration > 0 ||
          diagnostics.missingPersonReferences > 0)
      ) {
        console.warn("[MetricsBoard] Schedule data diagnostics", diagnostics);
      }
      if (process.env.NODE_ENV !== "production") {
        const worstViolation = findWorstMaxHoursViolation(data);
        if (worstViolation) {
          console.warn("[MetricsBoard] Max working-hours violation", {
            person: worstViolation.personName,
            date: worstViolation.date,
            hours: worstViolation.hours,
            maxHours: worstViolation.maxHours,
            overBy: Number(
              (worstViolation.hours - worstViolation.maxHours).toFixed(2),
            ),
            tasks: worstViolation.tasks.map((task) => ({
              name: task.taskName,
              source: task.source,
              durationHours: task.durationHours,
              assignmentSource: task.assignmentSource,
              startTime: task.startTime,
              endTime: task.endTime,
            })),
          });
        }
      }
      setSnapshot(data);
    } catch (err) {
      console.error("Failed to build schedule data:", err);
      setSnapshot({
        tasks: [],
        people: [],
        capabilities: [],
        taskTypes: [],
        dayAliases: {},
      });
    } finally {
      setIsLoading(false);
    }
  }, [eventId, contextInstances]);

  // Initial data load
  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Close add menu on outside click
  // Use requestAnimationFrame to defer state updates so the browser's native
  // focus assignment to the clicked element completes before the re-render.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        addMenuRef.current &&
        !addMenuRef.current.contains(e.target as Node)
      ) {
        requestAnimationFrame(() => {
          setShowAddMenu(false);
        });
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Persist state on change
  const persistState = useCallback((newState: BoardState) => {
    setBoardState(newState);
    saveBoardState(newState);
  }, []);

  // Handle layout change from grid
  const handleLayoutChange = useCallback((layout: Layout[]) => {
    setBoardState((prev) => {
      const updatedCards = prev.cards.map((card) => {
        const layoutItem = layout.find((l) => l.i === card.i);
        if (layoutItem) {
          return {
            ...card,
            x: layoutItem.x,
            y: layoutItem.y,
            w: layoutItem.w,
            h: layoutItem.h,
          };
        }
        return card;
      });
      const newState = { cards: updatedCards };
      saveBoardState(newState);
      return newState;
    });
  }, []);

  // Handle settings change for a card
  const handleSettingsChange = useCallback(
    (cardId: string, newSettings: MetricSettings) => {
      setBoardState((prev) => {
        const updatedCards = prev.cards.map((card) =>
          card.i === cardId ? { ...card, settings: newSettings } : card,
        );
        const newState = { cards: updatedCards };
        saveBoardState(newState);
        return newState;
      });
    },
    [],
  );

  // Add a new metric card
  const handleAddMetric = useCallback(
    (metricId: string) => {
      const cardId = `${metricId}-${Date.now()}`;

      // Find the bottom of the current grid
      const maxY = boardState.cards.reduce(
        (max, card) => Math.max(max, card.y + card.h),
        0,
      );

      const newCard: MetricBoxConfig = {
        i: cardId,
        x: 0,
        y: maxY,
        w: DEFAULT_CARD_W,
        h: DEFAULT_CARD_H,
        metricId,
        settings: {
          personIds: [],
          capabilityIds: [],
          colorMap: {},
        },
      };

      const newState = { cards: [...boardState.cards, newCard] };
      persistState(newState);
      setShowAddMenu(false);
    },
    [boardState, persistState],
  );

  // Remove a metric card
  const handleRemoveCard = useCallback(
    (cardId: string) => {
      clearScheduleHighlights();
      const newState = {
        cards: boardState.cards.filter((c) => c.i !== cardId),
      };
      persistState(newState);
    },
    [boardState, clearScheduleHighlights, persistState],
  );

  // Build layout array for react-grid-layout
  const layout: Layout[] = useMemo(
    () =>
      boardState.cards.map((card) => ({
        i: card.i,
        x: card.x,
        y: card.y,
        w: card.w,
        h: card.h,
        minW: 3,
        minH: 3,
      })),
    [boardState.cards],
  );

  return (
    <div className="min-h-screen bg-surface-alt p-4">
      <div className="max-w-full mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-foreground">Metrics Board</h1>
          </div>

          {/* Add Metric button */}
          <div className="relative" ref={addMenuRef}>
            <button
              onClick={() => setShowAddMenu(!showAddMenu)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Plus size={16} />
              Add Metric
              <ChevronDown
                size={14}
                className={`transition-transform ${showAddMenu ? "rotate-180" : ""}`}
              />
            </button>

            {showAddMenu && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-surface border border-bordercl rounded-lg shadow-xl z-50 overflow-hidden">
                <div className="p-2 border-b border-bordercl-subtle">
                  <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">
                    Available Metrics
                  </span>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {allMetrics.length === 0 ? (
                    <div className="p-4 text-sm text-foreground-faint text-center">
                      No metrics registered
                    </div>
                  ) : (
                    allMetrics.map((metric) => (
                      <button
                        key={metric.config.id}
                        onClick={() => handleAddMetric(metric.config.id)}
                        className="w-full text-left px-3 py-2.5 hover:bg-blue-50 dark:bg-blue-950/30 dark:hover:bg-blue-950/30 transition-colors border-b border-bordercl-subtle last:border-b-0"
                      >
                        <div className="text-sm font-medium text-foreground">
                          {metric.config.name}
                        </div>
                        <div className="text-xs text-foreground-muted mt-0.5">
                          {metric.config.description}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-3 border-blue-500 border-t-transparent rounded-full" />
            <span className="ml-3 text-sm text-foreground-muted">
              Loading data...
            </span>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && boardState.cards.length === 0 && (
          <div className="bg-surface rounded-xl border border-bordercl p-12 text-center">
            <h2 className="text-lg font-semibold text-foreground-secondary mb-2">
              No metrics added yet
            </h2>
            <p className="text-sm text-foreground-muted mb-4">
              Click &quot;Add Metric&quot; to start building your dashboard
            </p>
          </div>
        )}

        {/* Grid */}
        {!isLoading && boardState.cards.length > 0 && (
          <ResponsiveGridLayout
            className="layout"
            layouts={{ lg: layout }}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={{ lg: GRID_COLS, md: 10, sm: 6, xs: 4, xxs: 2 }}
            rowHeight={ROW_HEIGHT}
            onLayoutChange={handleLayoutChange}
            draggableHandle=".metric-drag-handle"
            compactType="vertical"
            isResizable={true}
            isDraggable={true}
            margin={[12, 12]}
            containerPadding={[0, 0]}
          >
            {boardState.cards.map((card) => (
              <div key={card.i} className="metric-card-wrapper">
                <MetricCard
                  cardId={card.i}
                  metricId={card.metricId}
                  snapshot={snapshot}
                  previewSnapshot={previewSnapshot}
                  settings={card.settings}
                  currentDay={currentDay}
                  onSettingsChange={handleSettingsChange}
                  onRemove={handleRemoveCard}
                  onResourceHover={handleResourceHover}
                  onResourceHoverEnd={handleResourceHoverEnd}
                />
              </div>
            ))}
          </ResponsiveGridLayout>
        )}
      </div>
    </div>
  );
};

export default MetricsBoard;
