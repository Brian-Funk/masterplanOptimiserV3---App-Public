"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, EyeOff, PencilLine } from "lucide-react";
import { Tooltip } from "@/components/ui";
import {
  normaliseScheduleDayRange,
  type ScheduleDayRange,
} from "@/lib/scheduleDayRange";
import {
  endToWorkingDayMinutes,
  formatWorkingHourLabel,
  getActualDateForWorkingSlot,
  getWorkingDayForDateTime,
  getScheduleDayBoundaryFromRange,
  hasOvernightTail,
  isTaskInWorkingDay,
  minutesToClockTime,
  normaliseScheduleDayBoundary,
  toWorkingDayMinutes,
  type ScheduleDayBoundary,
} from "@/lib/workingDayBoundary";

/** Task shape rendered by the reusable calendar board. */
type CalendarTask = {
  id: number;
  name: string;
  task_type_id: number;
  task_type_name: string;
  task_type_color: string;
  location_id?: number;
  location_name?: string;
  date?: string; // YYYY-MM-DD - the date this task instance is scheduled for
  time?: string; // HH:MM format
  time_range?: { start: string; end: string }; // HH:MM format
  start_end_time?: { start: string; end: string }; // HH:MM format
  duration?: number; // minutes
  fields: { [key: string]: any }; // All field values
  field_definitions: Array<{
    id: string;
    name: string;
    type: string;
  }>;
  assigned_persons?: number[]; // person IDs assigned to this task
  field_assignments?: { [fieldId: string]: number[] }; // per-field person assignments from optimiser
  field_assignment_exclusions?: {
    [fieldId: string]: Array<{
      person_id: number;
      group_id?: number;
      group_name?: string;
      reason: "unavailable";
      unavailable_from?: string;
      unavailable_to?: string;
    }>;
  };
  resource_info?: string; // formatted person/capability names
  // Masterplan layout overrides (populated from MasterplanLayout)
  _visual_x_offset?: number; // percentage points offset for horizontal position
  _visual_width?: number | null; // percentage points for width (null = auto)
  // Extra fields from description templates (show_on_card = true)
  _extra_card_fields?: Array<{ label: string; value: string }>;
  // Print-only reference derived by the PDF renderer (for example T01).
  _pdf_reference?: string;
  optimised?: Record<string, any>;
  final?: Record<string, any>;
  manualChange?: {
    summaries?: string[];
    details?: string[];
  };
  conflicts?: {
    count: number;
    messages: string[];
    details?: string[];
  };
};

type CalendarBackgroundBlock = {
  id: string | number;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  colour?: string | null;
  location?: string | null;
  audience?: string | null;
  responsible?: string | null;
  visibility?: "public" | "internal" | string;
};

/** Supported calendar display mode. */
type CalendarViewType = "daily";

/** Density options used by presentation mode. */
type CalendarDensity = "comfortable" | "compact";

type TaskRelativeDropPlacement = "before" | "align_start" | "after";

/** Props for the reusable daily calendar board. */
type CalendarProps = {
  tasks: CalendarTask[];
  viewType: CalendarViewType;
  eventStartDate?: string; // YYYY-MM-DD
  eventEndDate?: string; // YYYY-MM-DD
  selectedDate?: string; // YYYY-MM-DD for daily view
  onTaskEdit: (task: CalendarTask) => void;
  onTaskClick?: (task: CalendarTask) => void;
  onTaskShiftClick?: (task: CalendarTask) => void;
  /** Move a task, optionally using a linear working-day minute anchor across midnight. */
  onTaskDrop?: (
    task: CalendarTask,
    newTime: string,
    referenceTask?: CalendarTask,
    selectedWorkingDate?: string,
    newWorkingStartMinutes?: number,
  ) => void;
  /** Enable before, aligned-start, and after drop zones on scheduled task cards. */
  enableTaskRelativeDrop?: boolean;
  selectedTaskIds?: number[];
  highlightedTaskIds?: number[];
  backgroundBlocks?: CalendarBackgroundBlock[];
  scheduleDayRange?: Partial<ScheduleDayRange> | null;
  scheduleDayBoundary?: Partial<ScheduleDayBoundary> | null;
  onSlotDoubleClick?: (slotInfo: {
    date: string;
    time?: string;
    location?: string;
  }) => void;
  infeasibleTaskIds?: Set<number>;
  infeasibleTaskErrors?: Map<number, string[]>;
  ignoredTaskIds?: ReadonlySet<number>;
  persons?: Array<{ id: number; first_name: string; last_name: string }>;
  onPersonRightClick?: (
    taskId: number,
    personId: number,
    x: number,
    y: number,
  ) => void;
  onTaskSelect?: (taskId: number, isSelected: boolean) => void;
  locations?: any[];
  onPrevDay?: () => void;
  onNextDay?: () => void;
  canNavigatePrev?: boolean;
  canNavigateNext?: boolean;
  masterplanMode?: boolean;
  presentationMode?: boolean;
  pdfMode?: boolean;
  density?: CalendarDensity;
  onLayoutChange?: (
    taskId: number,
    changes: {
      visual_height?: number;
      visual_x_offset?: number;
      visual_width?: number;
      custom_color?: string;
      sort_order?: number;
    },
  ) => void;
};

// Helper to convert hex to rgba
const hexToRgba = (hex: string, alpha: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return `rgba(156, 163, 175, ${alpha})`;
  return `rgba(${parseInt(result[1], 16)}, ${parseInt(
    result[2],
    16,
  )}, ${parseInt(result[3], 16)}, ${alpha})`;
};

// Helper to parse time to minutes from midnight
const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

// 16-column grid snap constants
const GRID_COLS = 16;
const SNAP_SIZE = 100 / GRID_COLS; // 6.25%
const snapToGrid = (value: number) => Math.round(value / SNAP_SIZE) * SNAP_SIZE;
const snapToGridFloor = (value: number) =>
  Math.floor(value / SNAP_SIZE) * SNAP_SIZE;

// CalendarCard Component
type CalendarCardProps = {
  task: CalendarTask;
  isBackground?: boolean;
  isTimeRange?: boolean;
  onDoubleClick: () => void;
  onClick?: () => void;
  onShiftClick?: () => void;
  onShiftRightClick?: () => void;
  isSelected?: boolean;
  isHighlighted?: boolean;
  viewType?: CalendarViewType;
  selectedTaskIds?: number[];
  allTasks?: CalendarTask[];
  onDragStart?: (tasks: CalendarTask[], draggedTask: CalendarTask) => void;
  onDragEnd?: () => void;
  onRelativeDrop?: (
    event: React.DragEvent,
    targetTask: CalendarTask,
    placement: TaskRelativeDropPlacement,
  ) => void;
  onRelativeDragOver?: () => void;
  isDragging?: boolean;
  isInfeasible?: boolean;
  isIgnored?: boolean;
  infeasibleErrors?: string[];
  persons?: Array<{ id: number; first_name: string; last_name: string }>;
  onPersonRightClick?: (
    taskId: number,
    personId: number,
    x: number,
    y: number,
  ) => void;
  masterplanMode?: boolean;
  onColorChange?: (taskId: number, color: string) => void;
  onHorizontalDragEnd?: (taskId: number, xOffsetPercent: number) => void;
  onWidthResizeEnd?: (taskId: number, widthPercent: number) => void;
  onMasterplanPreview?: (
    taskId: number,
    preview: {
      left: number;
      width: number;
      isResize?: boolean;
      tiles?: number;
      swapTargetId?: number | null;
    } | null,
  ) => void;
  autoWidthPercent?: number; // the auto-calculated column width in %
  currentXOffset?: number; // current visual_x_offset in %
  currentWidth?: number | null; // current visual_width in % (null = auto)
  columnLeft?: number; // base column left position in % (from overlap layout)
  siblingPositions?: Array<{
    taskId: number;
    left: number;
    width: number;
    columnLeft: number;
  }>; // positions of other tasks in same time slot
  onSwapTasks?: (
    taskId1: number,
    offset1: number,
    width1: number,
    taskId2: number,
    offset2: number,
    width2: number,
  ) => void;
  presentationMode?: boolean;
  density?: CalendarDensity;
};

const CalendarCard: React.FC<CalendarCardProps> = ({
  task,
  isBackground = false,
  isTimeRange = false,
  onDoubleClick,
  onClick,
  onShiftClick,
  onShiftRightClick,
  isSelected = false,
  isHighlighted = false,
  viewType = "daily",
  selectedTaskIds = [],
  allTasks = [],
  onDragStart: onDragStartCallback,
  onDragEnd: onDragEndCallback,
  onRelativeDrop,
  onRelativeDragOver,
  isDragging = false,
  isInfeasible = false,
  isIgnored = false,
  infeasibleErrors,
  persons,
  onPersonRightClick,
  masterplanMode = false,
  onColorChange,
  onHorizontalDragEnd,
  onWidthResizeEnd,
  onMasterplanPreview,
  autoWidthPercent,
  currentXOffset,
  currentWidth,
  columnLeft = 0,
  siblingPositions = [],
  onSwapTasks,
  presentationMode = false,
  density = "comfortable",
}) => {
  const [isHDragging, setIsHDragging] = useState(false);
  const justInteractedRef = React.useRef(false);
  const [hDragDelta, setHDragDelta] = useState(0);
  const [isHResizing, setIsHResizing] = useState(false);
  const [hResizeDelta, setHResizeDelta] = useState(0);
  const [relativeDropPlacement, setRelativeDropPlacement] =
    useState<TaskRelativeDropPlacement | null>(null);

  const cardRef = React.useRef<HTMLDivElement>(null);
  // Time ranges: lighter background, dashed border
  // Scheduled times: normal background, solid border
  // Flow-check issues: keep original colours and use a subtle top-right marker
  const alpha = isTimeRange ? 0.08 : isBackground ? 0.15 : 0.25;
  const borderAlpha = isTimeRange ? 0.4 : isBackground ? 0.25 : 0.5;
  const backgroundColor = hexToRgba(task.task_type_color, alpha);
  const borderColor = hexToRgba(task.task_type_color, borderAlpha);
  const taskTimeLabel = task.time_range
    ? `${task.time_range.start} - ${task.time_range.end}`
    : task.start_end_time
      ? `${task.start_end_time.start} - ${task.start_end_time.end}`
      : task.time || "";
  const manualChangeSummaries = task.manualChange?.summaries ?? [];
  const manualChangeDetails = task.manualChange?.details ?? [];
  const hasManualChange =
    manualChangeSummaries.length > 0 || manualChangeDetails.length > 0;
  const conflictMessages = task.conflicts?.messages ?? [];
  const conflictDetails = task.conflicts?.details ?? [];
  const conflictCount = task.conflicts?.count ?? conflictMessages.length;
  const hasConflict = conflictCount > 0;
  const checkIssueMessages = infeasibleErrors ?? [];
  const hasCheckIssue = !isIgnored && (hasConflict || isInfeasible);

  const renderStatusMarkers = () => (
    <>
      {isIgnored && (
        <span
          aria-label="Ignored by flow checking and optimisation"
          title="Ignored: this task is excluded from flow checking and optimisation."
          className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-slate-500/15 text-slate-700 leading-none ring-1 ring-slate-500/30 dark:text-slate-200"
        >
          <EyeOff className="block h-2.5 w-2.5" />
        </span>
      )}
      {hasManualChange && (
        <span
          aria-label="Edited task"
          title="Manually changed after optimisation."
          className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-amber-500/10 text-amber-700 leading-none ring-1 ring-amber-500/20 dark:text-amber-300"
        >
          <PencilLine className="block h-2.5 w-2.5" />
        </span>
      )}
      {hasCheckIssue && (
        <span
          aria-label={hasConflict ? "Task conflict" : "Task check issue"}
          title={
            hasConflict
              ? conflictCount === 1
                ? conflictMessages[0] || "This task has a conflict."
                : `${conflictCount} conflicts affect this task.`
              : checkIssueMessages[0] ||
                "The flow check found an issue for this task."
          }
          className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-red-500/10 text-red-700 leading-none ring-1 ring-red-500/25 dark:text-red-300"
        >
          <AlertTriangle className="block h-2.5 w-2.5" />
        </span>
      )}
    </>
  );

  const handleClick = (e: React.MouseEvent) => {
    if (justInteractedRef.current) return; // Suppress click after drag/resize
    if (e.shiftKey && onShiftClick) {
      onShiftClick();
    } else if (onClick) {
      onClick();
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (e.shiftKey && onShiftRightClick) {
      e.preventDefault();
      onShiftRightClick();
    }
  };

  // Masterplan mode: horizontal drag handler (move task left/right)
  const handleHorizontalDragStart = (e: React.MouseEvent) => {
    if (!masterplanMode || !onHorizontalDragEnd || !cardRef.current) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setIsHDragging(true);

    const startX = e.clientX;
    // Find the actual grid container (not the card itself which also has class "relative")
    const gridContainer = cardRef.current.closest(
      "[data-calendar-grid]",
    ) as HTMLElement;
    const containerWidth = gridContainer?.clientWidth || 1;
    let latestDeltaX = 0;
    let didMove = false;

    const currentAutoWidth = autoWidthPercent || 100;
    const effWidth = currentWidth != null ? currentWidth : currentAutoWidth;
    const baseOffset = currentXOffset || 0;
    const myOriginalLeft = columnLeft + baseOffset;

    // Helper: check overlap between two intervals
    const intervalsOverlap = (
      l1: number,
      w1: number,
      l2: number,
      w2: number,
    ) => {
      return l1 < l2 + w2 && l2 < l1 + w1;
    };

    // Helper: find sibling that would be collided with at a given left position
    const findCollision = (snappedLeft: number) => {
      for (const sib of siblingPositions) {
        if (intervalsOverlap(snappedLeft, effWidth, sib.left, sib.width)) {
          return sib;
        }
      }
      return null;
    };

    const computeSnappedLeft = (pixelDelta: number) => {
      const deltaPct = (pixelDelta / containerWidth) * 100;
      // Snap the absolute position so it aligns with grid lines
      let snappedLeft = snapToGrid(columnLeft + baseOffset + deltaPct);
      // Clamp: task must stay within [0, 100]
      snappedLeft = Math.max(0, snappedLeft);
      if (snappedLeft + effWidth > 100) {
        snappedLeft = Math.floor((100 - effWidth) / SNAP_SIZE) * SNAP_SIZE;
      }
      return snappedLeft;
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      latestDeltaX = moveEvent.clientX - startX;
      if (Math.abs(latestDeltaX) > 3) didMove = true;
      setHDragDelta(latestDeltaX);
      if (onMasterplanPreview) {
        const snappedLeft = computeSnappedLeft(latestDeltaX);
        const collision = findCollision(snappedLeft);
        onMasterplanPreview(task.id, {
          left: snappedLeft,
          width: effWidth,
          swapTargetId: collision ? collision.taskId : null,
        });
      }
    };

    const handleMouseUp = () => {
      setIsHDragging(false);
      setHDragDelta(0);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      onMasterplanPreview?.(task.id, null);
      if (didMove) {
        justInteractedRef.current = true;
        setTimeout(() => {
          justInteractedRef.current = false;
        }, 200);
        const snappedLeft = computeSnappedLeft(latestDeltaX);
        const collision = findCollision(snappedLeft);

        if (collision && onSwapTasks) {
          // Swap: move this task to the collision target's position, and the target to this task's original position
          // Each offset is relative to the respective task's own column base position
          // Also swap widths so each task takes the other's visual footprint, preventing overlaps
          const newOffset = collision.left - columnLeft;
          const otherNewOffset = myOriginalLeft - collision.columnLeft;

          // Validate: after swap, neither task should collide with any OTHER sibling
          const myNewLeft = columnLeft + newOffset;
          const myNewWidth = collision.width;
          const otherNewLeft = collision.columnLeft + otherNewOffset;
          const otherNewWidth = effWidth;
          const otherSiblings = siblingPositions.filter(
            (s) => s.taskId !== task.id && s.taskId !== collision.taskId,
          );
          const myCollision = otherSiblings.some((s) =>
            intervalsOverlap(myNewLeft, myNewWidth, s.left, s.width),
          );
          const otherCollision = otherSiblings.some((s) =>
            intervalsOverlap(otherNewLeft, otherNewWidth, s.left, s.width),
          );

          if (!myCollision && !otherCollision) {
            onSwapTasks(
              task.id,
              newOffset,
              collision.width,
              collision.taskId,
              otherNewOffset,
              effWidth,
            );
          }
        } else {
          // No collision: just move
          const newOffset = snappedLeft - columnLeft;
          onHorizontalDragEnd(task.id, newOffset);
        }
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // Masterplan mode: horizontal resize handler (change width from right edge)
  const handleHorizontalResizeStart = (e: React.MouseEvent) => {
    if (!masterplanMode || !onWidthResizeEnd || !cardRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    setIsHResizing(true);

    const startX = e.clientX;
    // Find the actual grid container (not the card itself)
    const gridContainer = cardRef.current.closest(
      "[data-calendar-grid]",
    ) as HTMLElement;
    const containerWidth = gridContainer?.clientWidth || 1;
    const currentAutoWidth = autoWidthPercent || 100;
    const startWidthPercent =
      currentWidth != null ? currentWidth : currentAutoWidth;
    const baseOffset = currentXOffset || 0;
    const fixedLeft = columnLeft + baseOffset; // left edge stays fixed during resize
    let latestDeltaX = 0;

    const computeSnappedWidth = (pixelDelta: number) => {
      const deltaPct = (pixelDelta / containerWidth) * 100;
      // Snap the right edge to grid for visual alignment
      const rawRight = fixedLeft + startWidthPercent + deltaPct;
      let snappedRight = snapToGrid(rawRight);
      // Find the nearest sibling to the right to prevent overlap
      let maxRight = 100;
      if (siblingPositions) {
        for (const sib of siblingPositions) {
          const sibLeft = sib.columnLeft + sib.left;
          if (sibLeft > fixedLeft && sibLeft < maxRight) {
            maxRight = sibLeft;
          }
        }
      }
      // Clamp: right <= maxRight (nearest sibling or 100), width >= 1 grid unit
      snappedRight = Math.min(
        maxRight,
        Math.max(fixedLeft + SNAP_SIZE, snappedRight),
      );
      return snappedRight - fixedLeft;
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      latestDeltaX = moveEvent.clientX - startX;
      setHResizeDelta(latestDeltaX);
      if (onMasterplanPreview) {
        const snW = computeSnappedWidth(latestDeltaX);
        const tiles = Math.round(snW / SNAP_SIZE);
        onMasterplanPreview(task.id, {
          left: fixedLeft,
          width: snW,
          isResize: true,
          tiles,
        });
      }
    };

    const handleMouseUp = () => {
      setIsHResizing(false);
      setHResizeDelta(0);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      onMasterplanPreview?.(task.id, null);
      justInteractedRef.current = true;
      setTimeout(() => {
        justInteractedRef.current = false;
      }, 200);
      const snW = computeSnappedWidth(latestDeltaX);
      onWidthResizeEnd(task.id, snW);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleDragStart = (e: React.DragEvent) => {
    // In masterplan mode, disable time-based drag-and-drop
    if (masterplanMode) {
      e.preventDefault();
      return;
    }

    // Only allow dragging for start_end_time tasks (not time_range or background)
    if (isTimeRange || isBackground) {
      e.preventDefault();
      return;
    }

    // If this task is selected and there are other selected tasks, drag all of them
    let tasksToMove: CalendarTask[];
    if (isSelected && selectedTaskIds.length > 1) {
      tasksToMove = allTasks.filter((t) => selectedTaskIds.includes(t.id));
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(
        "application/json",
        JSON.stringify({
          isMulti: true,
          tasks: tasksToMove,
          referenceTask: task, // The task actually being dragged
        }),
      );
    } else {
      // Single task drag
      tasksToMove = [task];
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(
        "application/json",
        JSON.stringify({
          isMulti: false,
          tasks: tasksToMove,
          referenceTask: task, // Same as the task for single drag
        }),
      );
    }

    // Notify parent component about the drag
    if (onDragStartCallback) {
      onDragStartCallback(tasksToMove, task); // Pass the actual task being dragged
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    // Notify parent component that drag has ended
    if (onDragEndCallback) {
      onDragEndCallback();
    }
  };

  useEffect(() => {
    if (!isDragging) setRelativeDropPlacement(null);
  }, [isDragging]);

  const getRelativeDropPlacement = (
    event: React.DragEvent,
  ): TaskRelativeDropPlacement => {
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeY = event.clientY - rect.top;
    if (relativeY < rect.height / 3) return "before";
    if (relativeY < (rect.height * 2) / 3) return "align_start";
    return "after";
  };

  // Calculate event duration in minutes
  let durationMinutes = 60; // default for simple time
  if (task.time_range) {
    const startMinutes = timeToMinutes(task.time_range.start);
    const endMinutes = timeToMinutes(task.time_range.end);
    durationMinutes = endMinutes - startMinutes;
  } else if (task.start_end_time) {
    const startMinutes = timeToMinutes(task.start_end_time.start);
    const endMinutes = timeToMinutes(task.start_end_time.end);
    durationMinutes =
      endMinutes <= startMinutes
        ? endMinutes + 24 * 60 - startMinutes
        : endMinutes - startMinutes;
  }

  // Show compact version for events less than 25 minutes
  const isCompact = durationMinutes < 25;

  // Use resource_info string for displaying persons/capabilities
  // This is set by CMI tab (capabilities) or Optimised tab (persons)
  const resourceInfo = task.resource_info || "";

  // Build individual person elements if person data is available
  // When field_assignments exist, group persons by field name for display
  const fieldGroupedPersonElements: Array<{
    fieldId: string;
    fieldLabel: string;
    persons: Array<{
      personId: number;
      name: string;
      isLast: boolean;
      excluded?: boolean;
      tooltip?: string;
    }>;
  }> | null =
    ((task.field_assignments &&
      Object.keys(task.field_assignments).length > 0) ||
      (task.field_assignment_exclusions &&
        Object.keys(task.field_assignment_exclusions).length > 0)) &&
    persons &&
    persons.length > 0
      ? Array.from(
          new Set([
            ...Object.keys(task.field_assignments || {}),
            ...Object.keys(task.field_assignment_exclusions || {}),
          ]),
        )
          .map((fieldId) => {
            const fieldDef = task.field_definitions?.find(
              (f) => f.id === fieldId,
            );
            const fieldLabel =
              fieldDef?.name ||
              fieldId.replace(/^field_/, "").replace(/_/g, " ");
            const pids = (task.field_assignments?.[fieldId] || []) as number[];
            const excluded = task.field_assignment_exclusions?.[fieldId] || [];
            const activePersons = pids.map((personId) => {
              const person = persons!.find((p) => p.id === personId);
              const name = person
                ? `${person.first_name} ${person.last_name}`
                : `Person ${personId}`;
              return { personId, name };
            });
            const excludedPersons = excluded.map((item) => {
              const person = persons!.find((p) => p.id === item.person_id);
              const name = person
                ? `${person.first_name} ${person.last_name}`
                : `Person ${item.person_id}`;
              const range =
                item.unavailable_from && item.unavailable_to
                  ? ` (${item.unavailable_from} - ${item.unavailable_to})`
                  : "";
              return {
                personId: item.person_id,
                name,
                excluded: true,
                tooltip: `Unavailable during this task${range}`,
              };
            });
            const allPersons = [...activePersons, ...excludedPersons];
            return {
              fieldId,
              fieldLabel,
              persons: allPersons.map((person, idx) => ({
                ...person,
                isLast: idx === allPersons.length - 1,
              })),
            };
          })
          .filter((g) => g.persons.length > 0)
      : null;

  // Guard: empty array is truthy but means no groups survived filtering
  const effectiveFieldGrouped =
    fieldGroupedPersonElements && fieldGroupedPersonElements.length > 0
      ? fieldGroupedPersonElements
      : null;

  const personElements =
    !effectiveFieldGrouped &&
    task.assigned_persons &&
    task.assigned_persons.length > 0 &&
    persons &&
    persons.length > 0
      ? task.assigned_persons.map((personId, idx) => {
          const person = persons.find((p) => p.id === personId);
          const name = person
            ? `${person.first_name} ${person.last_name}`
            : `Person ${personId}`;
          return {
            personId,
            name,
            isLast: idx === task.assigned_persons!.length - 1,
          };
        })
      : null;

  const presentationPersonSummary = (() => {
    if (effectiveFieldGrouped) {
      return effectiveFieldGrouped
        .map((group) => {
          const names = group.persons
            .map((person) =>
              person.excluded ? `${person.name} (unavailable)` : person.name,
            )
            .join(", ");
          return `${group.fieldLabel}: ${names}`;
        })
        .join(" / ");
    }
    if (personElements) {
      return personElements.map((person) => person.name).join(", ");
    }
    return resourceInfo;
  })();

  const isPresentationCompact = presentationMode && density === "compact";

  // Get time display for tooltip
  const getTimeDisplay = () => {
    if (task.time_range) {
      return `${task.time_range.start} - ${task.time_range.end}`;
    } else if (task.start_end_time) {
      return `${task.start_end_time.start} - ${task.start_end_time.end}`;
    } else if (task.time) {
      return task.time;
    }
    return "";
  };

  // Render field values compactly (excluding persons and capabilities as they're shown inline)
  const renderFieldValue = (fieldId: string, value: any, fieldDef: any) => {
    if (!value) return null;

    // Skip persons_list and capabilities_list as they may be shown via resource_info
    if (
      fieldDef.type === "persons_list" ||
      fieldDef.type === "capabilities_list"
    ) {
      return null;
    }

    switch (fieldDef.type) {
      case "duration":
        return (
          <div key={fieldId} className="text-xs">
            {value}min
          </div>
        );

      case "number":
        return (
          <div key={fieldId} className="text-xs">
            {fieldDef.name}: {value}
          </div>
        );

      case "text":
        return (
          <div key={fieldId} className="text-xs truncate">
            {value}
          </div>
        );

      case "link":
        return (
          <div key={fieldId} className="text-xs truncate">
            <a
              href={
                typeof value === "object" && value?.url
                  ? value.url
                  : String(value)
              }
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
              title={
                typeof value === "object" && value?.url
                  ? value.url
                  : String(value)
              }
            >
              {fieldDef.name}
            </a>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div
      ref={cardRef}
      data-task-id={task.id}
      data-solver-ignored={isIgnored ? "true" : undefined}
      aria-label={
        isIgnored
          ? `${task.name}. Ignored by flow checking and optimisation.`
          : undefined
      }
      data-presentation-card={presentationMode ? "true" : undefined}
      className={`rounded-md ${
        presentationMode ? "border" : "border-2"
      } transition-all ${
        presentationMode ? "hover:shadow-md" : "hover:opacity-90"
      } ${
        presentationMode
          ? "cursor-default"
          : masterplanMode
            ? "cursor-grab"
            : "cursor-pointer"
      } ${isHDragging ? "cursor-grabbing opacity-80" : ""} ${
        isBackground
          ? "absolute h-full w-full z-0 hover:z-[100]"
          : "absolute h-full w-full z-10 hover:z-[100]"
      } ${
        presentationMode
          ? isPresentationCompact || isCompact
            ? "p-2"
            : "p-3"
          : isCompact
            ? "p-1"
            : "p-2"
      } ${
        isTimeRange ? "border-dashed" : "border-solid"
      } ${isSelected ? "ring-4 ring-blue-500 ring-opacity-50" : ""} ${
        isHighlighted
          ? "ring-2 ring-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.6)]"
          : ""
      } ${isIgnored ? "opacity-60 saturate-50" : ""} group relative overflow-visible`}
      style={{
        backgroundColor,
        borderColor,
        ...(isIgnored && {
          backgroundImage:
            "repeating-linear-gradient(135deg, transparent 0, transparent 7px, rgba(100,116,139,0.22) 7px, rgba(100,116,139,0.22) 9px)",
          borderStyle: "dashed",
        }),
        ...(isHDragging && {
          transform: `translateX(${hDragDelta}px)`,
          zIndex: 200,
        }),
        ...(isHResizing && {
          width: `calc(100% + ${hResizeDelta}px)`,
          zIndex: 200,
        }),
      }}
      draggable={
        !presentationMode && !isTimeRange && !isBackground && !masterplanMode
      }
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={(event) => {
        if (!onRelativeDrop) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        onRelativeDragOver?.();
        setRelativeDropPlacement(getRelativeDropPlacement(event));
      }}
      onDragLeave={(event) => {
        if (!onRelativeDrop) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX >= rect.right ||
          event.clientY < rect.top ||
          event.clientY >= rect.bottom
        ) {
          setRelativeDropPlacement(null);
        }
      }}
      onDrop={(event) => {
        if (!onRelativeDrop) return;
        event.preventDefault();
        event.stopPropagation();
        const placement = getRelativeDropPlacement(event);
        setRelativeDropPlacement(null);
        onRelativeDrop(event, task, placement);
      }}
      onMouseDown={
        masterplanMode && onHorizontalDragEnd
          ? handleHorizontalDragStart
          : undefined
      }
      onDoubleClick={() => {
        if (!justInteractedRef.current) onDoubleClick();
      }}
      onClick={(e) => {
        handleClick(e);
      }}
      onContextMenu={handleContextMenu}
    >
      {relativeDropPlacement && (
        <div
          aria-hidden="true"
          data-relative-drop-placement={relativeDropPlacement}
          className="pointer-events-none absolute inset-x-0 z-[120] border-2 border-blue-500 bg-blue-500/10"
          style={{
            top:
              relativeDropPlacement === "before"
                ? 0
                : relativeDropPlacement === "align_start"
                  ? "33.333%"
                  : "66.666%",
            height: "33.333%",
          }}
        />
      )}
      {presentationMode ? (
        <div
          className={`h-full min-h-0 overflow-hidden pr-6 ${
            isPresentationCompact ? "space-y-0.5" : "space-y-1"
          }`}
        >
          {(task._pdf_reference || taskTimeLabel) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {task._pdf_reference && (
                <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold leading-none tracking-wide text-white">
                  {task._pdf_reference}
                </span>
              )}
              {taskTimeLabel && (
                <span
                  className={`font-mono font-semibold tracking-normal text-foreground ${
                    isPresentationCompact ? "text-[11px]" : "text-xs"
                  }`}
                >
                  {taskTimeLabel}
                </span>
              )}
            </div>
          )}
          <div
            className={`font-semibold leading-snug ${
              isPresentationCompact ? "text-xs" : "text-sm"
            }`}
            style={{ color: task.task_type_color }}
          >
            <span className="line-clamp-2">{task.name}</span>
          </div>
          {task.location_name && !isCompact && (
            <div className="truncate text-xs text-foreground-muted">
              {task.location_name}
            </div>
          )}
          {presentationPersonSummary && !isPresentationCompact && !isCompact && (
            <div className="line-clamp-2 text-xs text-foreground-secondary">
              {presentationPersonSummary}
            </div>
          )}
        </div>
      ) : isCompact ? (
        // Compact view: only show task name, smaller and truncated
        <div className="flex items-center gap-1 overflow-hidden pr-5">
          <div
            className="text-xs font-medium truncate"
            style={{ color: task.task_type_color }}
          >
            {task.name}
          </div>
          {task.location_name && (
            <span className="text-xs text-foreground-muted italic whitespace-nowrap truncate">
              {task.location_name}
            </span>
          )}
        </div>
      ) : task.time_range ? (
        // Floating task with time_range: show compact format
        <div className="flex items-center gap-1 overflow-hidden pr-5">
          <span
            className="font-semibold text-xs truncate flex-shrink-0"
            style={{ color: task.task_type_color }}
          >
            {task.name}
          </span>
          <span className="text-xs text-foreground-muted whitespace-nowrap flex-shrink-0">
            {task.duration ||
              timeToMinutes(task.time_range.end) -
                timeToMinutes(task.time_range.start)}{" "}
            min
          </span>
          <span className="text-xs text-foreground-muted whitespace-nowrap truncate">
            {task.time_range.start}-{task.time_range.end}
          </span>
        </div>
      ) : (
        // Daily view with full details: show all details
        <div className="overflow-hidden h-full pr-5">
          {/* Task name with location */}
          <div className="flex items-center gap-1 overflow-hidden">
            <span
              className="font-semibold text-sm flex-shrink-0"
              style={{ color: task.task_type_color }}
            >
              {task.name}
            </span>
            {task.location_name && (
              <span className="text-xs text-foreground-muted italic truncate">
                {task.location_name}
              </span>
            )}
          </div>

          {/* Resource info on separate line - per-field grouped persons, flat persons, or resource_info string */}
          {effectiveFieldGrouped ? (
            <div className="text-xs text-foreground-secondary mt-0.5 space-y-0.5 overflow-hidden">
              {effectiveFieldGrouped.map((group) => (
                <div
                  key={group.fieldId}
                  className="flex flex-wrap gap-x-1 truncate"
                >
                  <span className="font-semibold text-foreground-muted flex-shrink-0">
                    {group.fieldLabel}:
                  </span>
                  {group.persons.map(
                    ({ personId, name, isLast, excluded, tooltip }, idx) => {
                      const content = (
                        <span
                          key={`${group.fieldId}-${personId}-${idx}`}
                          className={
                            excluded
                              ? "cursor-default text-red-600 line-through opacity-75 dark:text-red-400"
                              : "cursor-pointer hover:underline hover:text-blue-600"
                          }
                          onContextMenu={(e) => {
                            if (excluded) return;
                            e.preventDefault();
                            e.stopPropagation();
                            onPersonRightClick?.(
                              task.id,
                              personId,
                              e.clientX,
                              e.clientY,
                            );
                          }}
                        >
                          {name}
                          {!isLast ? "," : ""}
                        </span>
                      );
                      return excluded && tooltip ? (
                        <Tooltip
                          key={`${group.fieldId}-${personId}-${idx}-tooltip`}
                          content={tooltip}
                          side="top"
                        >
                          {content}
                        </Tooltip>
                      ) : (
                        content
                      );
                    },
                  )}
                </div>
              ))}
            </div>
          ) : personElements ? (
            <div className="text-xs text-foreground-secondary mt-0.5 flex flex-wrap gap-x-1">
              {personElements.map(({ personId, name, isLast }, idx) => (
                <span
                  key={`${personId}-${idx}`}
                  className="cursor-pointer hover:underline hover:text-blue-600"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onPersonRightClick?.(
                      task.id,
                      personId,
                      e.clientX,
                      e.clientY,
                    );
                  }}
                >
                  {name}
                  {!isLast ? "," : ""}
                </span>
              ))}
            </div>
          ) : resourceInfo ? (
            <div className="text-xs text-foreground-secondary mt-0.5 truncate">
              {resourceInfo}
            </div>
          ) : null}

          {/* Other fields */}
          {task.field_definitions.map((fieldDef) =>
            renderFieldValue(fieldDef.id, task.fields[fieldDef.id], fieldDef),
          )}

          {/* Extra fields from description templates (show_on_card) */}
          {task._extra_card_fields?.map((ef, i) => (
            <div key={`extra-${i}`} className="text-xs font-medium truncate">
              <span className="text-foreground-muted">{ef.label}:</span>{" "}
              <span className="text-foreground">{ef.value}</span>
            </div>
          ))}
        </div>
      )}

      {(isIgnored || hasManualChange || hasCheckIssue) && (
        <div className="absolute top-0.5 right-0.5 z-20 flex items-center gap-1">
          {renderStatusMarkers()}
        </div>
      )}

      {/* Hover tooltip with detailed info - hidden during drag/resize/move */}
      <div
        className={`${
          isDragging || isHDragging || isHResizing
            ? "hidden"
            : "invisible group-hover:visible"
        } absolute z-[200] left-0 top-full mt-1 text-white text-xs rounded-lg shadow-xl p-3 min-w-[200px] max-w-[300px] border-2`}
        style={{
          backgroundColor: task.task_type_color,
          borderColor: task.task_type_color,
        }}
      >
        <div className="space-y-2">
          {isIgnored && (
            <div className="flex items-center gap-1.5 rounded bg-black/20 px-2 py-1 font-semibold">
              <EyeOff className="h-3.5 w-3.5" />
              Ignored for flow checking and optimisation
            </div>
          )}
          {/* Time */}
          {getTimeDisplay() && (
            <div>
              <span className="font-semibold">Time:</span> {getTimeDisplay()}
            </div>
          )}

          {/* Resource info (capabilities or persons) */}
          {resourceInfo && (
            <div>
              <span className="font-semibold">Resources:</span> {resourceInfo}
            </div>
          )}

          {hasManualChange && (
            <div className="border-t border-white/30 pt-1 mt-1">
              <div className="font-semibold">Edited after optimisation</div>
              {manualChangeSummaries.length > 0 ? (
                <div>{manualChangeSummaries.join(", ")}</div>
              ) : (
                <div>This task differs from the optimiser result.</div>
              )}
              {manualChangeDetails.slice(0, 3).map((detail, index) => (
                <div key={`manual-detail-${index}-${detail}`} className="opacity-90">
                  {detail}
                </div>
              ))}
            </div>
          )}

          {hasConflict && (
            <div className="border-t border-white/30 pt-1 mt-1">
              <div className="font-semibold">Conflict</div>
              {(conflictMessages.length > 0
                ? conflictMessages
                : [`${conflictCount} conflicts affect this task.`]
              )
                .slice(0, 3)
                .map((message, index) => (
                  <div key={`conflict-message-${index}-${message}`}>{message}</div>
                ))}
              {conflictDetails.slice(0, 2).map((detail, index) => (
                <div key={`conflict-detail-${index}-${detail}`} className="opacity-90">
                  {detail}
                </div>
              ))}
            </div>
          )}

          {isInfeasible && !hasConflict && (
            <div className="border-t border-white/30 pt-1 mt-1">
              <div className="font-semibold">Flow check issue</div>
              {(checkIssueMessages.length > 0
                ? checkIssueMessages
                : ["The flow check found an issue for this task."]
              )
                .slice(0, 3)
                .map((message, index) => (
                  <div key={`check-issue-${index}-${message}`}>{message}</div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Masterplan mode: resize handle at right edge (horizontal) */}
      {masterplanMode && onWidthResizeEnd && (
        <div
          className="absolute top-0 right-0 bottom-0 w-2 cursor-ew-resize bg-transparent hover:bg-blue-400/30 transition-colors"
          onMouseDown={(e) => {
            e.stopPropagation();
            handleHorizontalResizeStart(e);
          }}
          title="Drag to resize width"
        />
      )}
    </div>
  );
};

// Daily View Component
type DailyViewProps = {
  tasks: CalendarTask[];
  selectedDate: string;
  onTaskEdit: (task: CalendarTask) => void;
  onTaskClick?: (task: CalendarTask) => void;
  onTaskShiftClick?: (task: CalendarTask) => void;
  onTaskDrop?: (
    task: CalendarTask,
    newTime: string,
    referenceTask?: CalendarTask,
    selectedWorkingDate?: string,
    newWorkingStartMinutes?: number,
  ) => void;
  enableTaskRelativeDrop?: boolean;
  selectedTaskIds?: number[];
  highlightedTaskIds?: number[];
  backgroundBlocks?: CalendarBackgroundBlock[];
  scheduleDayRange?: Partial<ScheduleDayRange> | null;
  scheduleDayBoundary?: Partial<ScheduleDayBoundary> | null;
  onSlotDoubleClick?: (slotInfo: {
    date: string;
    time?: string;
    location?: string;
  }) => void;
  infeasibleTaskIds?: Set<number>;
  infeasibleTaskErrors?: Map<number, string[]>;
  ignoredTaskIds?: ReadonlySet<number>;
  persons?: Array<{ id: number; first_name: string; last_name: string }>;
  onPersonRightClick?: (
    taskId: number,
    personId: number,
    x: number,
    y: number,
  ) => void;
  masterplanMode?: boolean;
  presentationMode?: boolean;
  pdfMode?: boolean;
  density?: CalendarDensity;
  onLayoutChange?: (
    taskId: number,
    changes: {
      visual_height?: number;
      visual_x_offset?: number;
      visual_width?: number;
      custom_color?: string;
      sort_order?: number;
    },
  ) => void;
};

const DailyView: React.FC<DailyViewProps> = ({
  tasks,
  selectedDate,
  onTaskEdit,
  onTaskClick,
  onTaskShiftClick,
  onTaskDrop,
  enableTaskRelativeDrop = false,
  selectedTaskIds,
  highlightedTaskIds,
  backgroundBlocks = [],
  scheduleDayRange,
  scheduleDayBoundary,
  onSlotDoubleClick,
  infeasibleTaskIds,
  infeasibleTaskErrors,
  ignoredTaskIds,
  persons,
  onPersonRightClick,
  masterplanMode = false,
  presentationMode = false,
  pdfMode = false,
  density = "comfortable",
  onLayoutChange,
}) => {
  // State for drag and drop feedback
  const [draggedTasks, setDraggedTasks] = useState<CalendarTask[] | null>(null);
  const [draggedReferenceTask, setDraggedReferenceTask] =
    useState<CalendarTask | null>(null);
  const [dropTargetSlot, setDropTargetSlot] = useState<{
    hour: number;
    isHalfHour: boolean;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Masterplan drag/resize preview
  const [masterplanPreview, setMasterplanPreview] = useState<{
    taskId: number;
    left: number;
    width: number;
    isResize?: boolean;
    tiles?: number;
    swapTargetId?: number | null;
  } | null>(null);

  const handleMasterplanPreview = React.useCallback(
    (
      taskId: number,
      preview: {
        left: number;
        width: number;
        isResize?: boolean;
        tiles?: number;
        swapTargetId?: number | null;
      } | null,
    ) => {
      setMasterplanPreview(preview ? { taskId, ...preview } : null);
    },
    [],
  );

  const range = useMemo(
    () => normaliseScheduleDayRange(scheduleDayRange),
    [scheduleDayRange?.startHour, scheduleDayRange?.endHour],
  );
  const dayBoundary = useMemo(
    () =>
      scheduleDayBoundary
        ? normaliseScheduleDayBoundary(scheduleDayBoundary)
        : getScheduleDayBoundaryFromRange(range),
    [scheduleDayBoundary?.offsetHour, range],
  );

  // Filter tasks for the selected working day. With a boundary offset, a task
  // stored on the next actual date before the boundary belongs to this view.
  const tasksForDate = tasks.filter((task) =>
    isTaskInWorkingDay(task, selectedDate, dayBoundary),
  );
  const backgroundBlocksForDate = backgroundBlocks
    .filter((block) => {
      const workingDay = getWorkingDayForDateTime(
        block.date,
        block.start_time,
        dayBoundary,
      );
      return workingDay === selectedDate;
    })
    .flatMap((block) => {
      const start = toWorkingDayMinutes(block.date, block.start_time, selectedDate);
      const end = endToWorkingDayMinutes(
        block.date,
        block.start_time,
        block.end_time,
        selectedDate,
      );
      if (start === null || end === null) return [];
      return [{ block, start, end }];
    });

  // Helper to calculate duration of a task in minutes
  const getTaskDuration = (task: CalendarTask): number => {
    if (task.start_end_time) {
      const startMinutes = timeToMinutes(task.start_end_time.start);
      const endMinutes = timeToMinutes(task.start_end_time.end);
      return endMinutes <= startMinutes
        ? endMinutes + 24 * 60 - startMinutes
        : endMinutes - startMinutes;
    }
    return 60; // Default 1 hour
  };

  const handleRelativeTaskDrop = (
    event: React.DragEvent,
    targetTask: CalendarTask,
    placement: TaskRelativeDropPlacement,
  ) => {
    const taskData = event.dataTransfer.getData("application/json");
    if (!taskData || !onTaskDrop || !targetTask.start_end_time) return;

    try {
      const dragData = JSON.parse(taskData);
      const referenceTask = dragData.referenceTask as CalendarTask | undefined;
      const dragged = dragData.tasks as CalendarTask[] | undefined;
      if (!referenceTask?.start_end_time || !dragged?.length) return;
      if (dragged.some((task) => task.id === targetTask.id)) return;

      const targetStartMinutes = toWorkingDayMinutes(
        targetTask.date,
        targetTask.start_end_time.start,
        selectedDate,
      );
      const targetEndMinutes = endToWorkingDayMinutes(
        targetTask.date,
        targetTask.start_end_time.start,
        targetTask.start_end_time.end,
        selectedDate,
      );
      if (targetStartMinutes === null || targetEndMinutes === null) return;

      const referenceDuration = getTaskDuration(referenceTask);
      const newReferenceStart =
        placement === "before"
          ? targetStartMinutes - referenceDuration
          : placement === "after"
            ? targetEndMinutes
            : targetStartMinutes;
      const newTime = minutesToClockTime(newReferenceStart);

      dragged.forEach((task) => {
        onTaskDrop(
          task,
          newTime,
          task.id === referenceTask.id ? undefined : referenceTask,
          selectedDate,
          newReferenceStart,
        );
      });
    } catch (error) {
      console.error("Could not position dropped task:", error);
    }
  };

  // Get the colour of the first dragged task for the highlight
  const getDraggedTaskColor = (): string => {
    if (draggedTasks && draggedTasks.length > 0) {
      return draggedTasks[0].task_type_color;
    }
    return "#6B7280"; // Default grey
  };

  // Calculate the span from the earliest to latest task in the dragged set
  const getDraggedTasksTimeSpan = (): {
    minStart: number;
    maxEnd: number;
  } | null => {
    if (!draggedTasks || draggedTasks.length === 0) return null;

    let minStart = Infinity;
    let maxEnd = -Infinity;

    draggedTasks.forEach((task) => {
      if (task.start_end_time) {
        const startMinutes =
          toWorkingDayMinutes(
            task.date,
            task.start_end_time.start,
            selectedDate,
          ) ?? timeToMinutes(task.start_end_time.start);
        const endMinutes =
          endToWorkingDayMinutes(
            task.date,
            task.start_end_time.start,
            task.start_end_time.end,
            selectedDate,
          ) ?? timeToMinutes(task.start_end_time.end);
        minStart = Math.min(minStart, startMinutes);
        maxEnd = Math.max(maxEnd, endMinutes);
      }
    });

    if (minStart === Infinity || maxEnd === -Infinity) {
      return null;
    }

    return { minStart, maxEnd };
  };

  const defaultDayRange = range;
  const pdfHourHeight = Math.max(
    32,
    Math.min(
      62,
      520 / Math.max(defaultDayRange.endHour - defaultDayRange.startHour, 1),
    ),
  );
  const hourHeight = pdfMode
    ? pdfHourHeight
    : presentationMode
      ? density === "compact"
        ? 96
        : 132
      : 120;
  const halfHourHeight = hourHeight / 2;
  const [startHour, setStartHour] = useState(defaultDayRange.startHour);
  const [endHour, setEndHour] = useState(defaultDayRange.endHour);
  const backgroundLabelWidth =
    !presentationMode && backgroundBlocksForDate.length > 0 ? 220 : 0;
  const backgroundRailItems = (() => {
    const startOfDay = startHour * 60;
    const items = backgroundBlocksForDate
      .flatMap(({ block, start, end }) => {
        const clippedStart = Math.max(startOfDay, start);
        const clippedEnd = Math.min(endHour * 60, end);
        if (clippedEnd <= clippedStart) return [];
        const top = ((clippedStart - startOfDay) / 60) * hourHeight;
        const rawHeight = ((clippedEnd - clippedStart) / 60) * hourHeight;
        return [
          {
            block,
            start: clippedStart,
            end: clippedEnd,
            top,
            height: Math.max(20, rawHeight),
            columnIndex: 0,
            totalColumns: 1,
          },
        ];
      })
      .sort((a, b) => a.start - b.start || b.end - a.end);

    const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
      a.start < b.end && b.start < a.end;

    const columns: Array<typeof items> = [];
    items.forEach((item) => {
      const columnIndex = columns.findIndex(
        (column) => !column.some((existing) => overlaps(item, existing)),
      );
      const targetColumn = columnIndex === -1 ? columns.length : columnIndex;
      if (!columns[targetColumn]) columns[targetColumn] = [];
      columns[targetColumn].push(item);
      item.columnIndex = targetColumn;
    });

    const parent = new Map<string | number, string | number>();
    items.forEach((item) => parent.set(item.block.id, item.block.id));
    const find = (id: string | number): string | number => {
      while (parent.get(id) !== id) {
        parent.set(id, parent.get(parent.get(id)!)!);
        id = parent.get(id)!;
      }
      return id;
    };
    const union = (a: string | number, b: string | number) => {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent.set(rootA, rootB);
    };

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (overlaps(items[i], items[j])) {
          union(items[i].block.id, items[j].block.id);
        }
      }
    }

    const groupColumns = new Map<string | number, number>();
    items.forEach((item) => {
      const root = find(item.block.id);
      groupColumns.set(
        root,
        Math.max(groupColumns.get(root) ?? 1, item.columnIndex + 1),
      );
    });

    return items.map((item) => ({
      ...item,
      totalColumns: groupColumns.get(find(item.block.id)) ?? 1,
    }));
  })();

  useEffect(() => {
    setStartHour(defaultDayRange.startHour);
    setEndHour(defaultDayRange.endHour);
  }, [defaultDayRange.startHour, defaultDayRange.endHour]);

  const hours = Array.from(
    { length: endHour - startHour },
    (_, i) => i + startHour,
  );

  const handleAutoFit = () => {
    let minMinutes = Infinity;
    let maxMinutes = -Infinity;
    tasksForDate.forEach((task) => {
      if (task.start_end_time) {
        minMinutes = Math.min(
          minMinutes,
          toWorkingDayMinutes(task.date, task.start_end_time.start, selectedDate) ??
            timeToMinutes(task.start_end_time.start),
        );
        maxMinutes = Math.max(
          maxMinutes,
          endToWorkingDayMinutes(
            task.date,
            task.start_end_time.start,
            task.start_end_time.end,
            selectedDate,
          ) ?? timeToMinutes(task.start_end_time.end),
        );
      } else if (task.time) {
        const m =
          toWorkingDayMinutes(task.date, task.time, selectedDate) ??
          timeToMinutes(task.time);
        minMinutes = Math.min(minMinutes, m);
        maxMinutes = Math.max(maxMinutes, m + 60);
      } else if (task.time_range) {
        const start =
          toWorkingDayMinutes(task.date, task.time_range.start, selectedDate) ??
          timeToMinutes(task.time_range.start);
        const end =
          endToWorkingDayMinutes(
            task.date,
            task.time_range.start,
            task.time_range.end,
            selectedDate,
          ) ?? timeToMinutes(task.time_range.end);
        minMinutes = Math.min(minMinutes, start);
        maxMinutes = Math.max(maxMinutes, end);
      }
    });
    if (minMinutes === Infinity) return;
    const newStart = Math.max(0, Math.floor(minMinutes / 60) - 1);
    const newEnd = Math.min(36, Math.ceil(maxMinutes / 60) + 1);
    setStartHour(newStart);
    setEndHour(newEnd);
  };

  const handleResetZoom = () => {
    setStartHour(defaultDayRange.startHour);
    setEndHour(defaultDayRange.endHour);
  };

  const isZoomed =
    startHour !== defaultDayRange.startHour || endHour !== defaultDayRange.endHour;

  const getTaskPosition = (task: CalendarTask) => {
    const MIN_HEIGHT = 24; // Reduced minimum height for compact cards
    const TIME_RANGE_HEIGHT = 60; // Larger height for time_range tasks to fit text

    if (task.time) {
      const minutes =
        toWorkingDayMinutes(task.date, task.time, selectedDate) ??
        timeToMinutes(task.time);
      const startOfDay = startHour * 60;
      const top = ((minutes - startOfDay) / 60) * hourHeight;
      return {
        top: `${top}px`,
        height: `${MIN_HEIGHT}px`,
        start: minutes,
        end: minutes + 60,
      };
    }

    if (task.time_range) {
      // For time_range tasks (floating tasks), show as larger block at start of day
      const startOfDay = startHour * 60;
      const top = 0; // Always at the beginning of the day
      return {
        top: `${top}px`,
        height: `${TIME_RANGE_HEIGHT}px`,
        start: startOfDay,
        end: startOfDay + 1, // Minimal duration to avoid overlap issues
        isFloating: true,
      };
    }

    if (task.start_end_time) {
      const startMinutes =
        toWorkingDayMinutes(
          task.date,
          task.start_end_time.start,
          selectedDate,
        ) ?? timeToMinutes(task.start_end_time.start);
      const endMinutes =
        endToWorkingDayMinutes(
          task.date,
          task.start_end_time.start,
          task.start_end_time.end,
          selectedDate,
        ) ?? timeToMinutes(task.start_end_time.end);
      const startOfDay = startHour * 60;
      const top = ((startMinutes - startOfDay) / 60) * hourHeight;
      const calculatedHeight =
        ((endMinutes - startMinutes) / 60) * hourHeight;
      const height = Math.max(calculatedHeight, MIN_HEIGHT); // Enforce minimum height
      return {
        top: `${top}px`,
        height: `${height}px`,
        start: startMinutes,
        end: endMinutes,
      };
    }

    return null;
  };

  // Helper function to check if two tasks overlap in time
  const tasksOverlap = (task1Pos: any, task2Pos: any) => {
    return task1Pos.start < task2Pos.end && task2Pos.start < task1Pos.end;
  };

  // Calculate layout for overlapping tasks using union-find overlap groups
  const getTaskLayout = () => {
    const tasksWithPositions = tasksForDate
      .map((task) => ({
        task,
        position: getTaskPosition(task),
      }))
      .filter((item) => item.position !== null);

    // Sort by start time, then longest first for ties
    const sorted = [...tasksWithPositions].sort((a, b) => {
      const startDiff = (a.position?.start ?? 0) - (b.position?.start ?? 0);
      if (startDiff !== 0) return startDiff;
      const durA = (a.position?.end ?? 0) - (a.position?.start ?? 0);
      const durB = (b.position?.end ?? 0) - (b.position?.start ?? 0);
      return durB - durA;
    });

    // Greedy column assignment
    const columns: Array<Array<{ task: CalendarTask; position: any }>> = [];
    const taskCol = new Map<number, number>();

    sorted.forEach((item) => {
      for (let c = 0; c < columns.length; c++) {
        if (!columns[c].some((e) => tasksOverlap(item.position, e.position))) {
          columns[c].push(item);
          taskCol.set(item.task.id, c);
          return;
        }
      }
      columns.push([item]);
      taskCol.set(item.task.id, columns.length - 1);
    });

    // Union-Find to build overlap groups (connected components)
    const parent = new Map<number, number>();
    tasksWithPositions.forEach((i) => parent.set(i.task.id, i.task.id));

    const find = (x: number): number => {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)!)!);
        x = parent.get(x)!;
      }
      return x;
    };
    const union = (a: number, b: number) => {
      const ra = find(a),
        rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    for (let i = 0; i < tasksWithPositions.length; i++) {
      for (let j = i + 1; j < tasksWithPositions.length; j++) {
        if (
          tasksOverlap(
            tasksWithPositions[i].position,
            tasksWithPositions[j].position,
          )
        ) {
          union(tasksWithPositions[i].task.id, tasksWithPositions[j].task.id);
        }
      }
    }

    // Each group's total columns = max column index + 1 within that group
    const groupCols = new Map<number, number>();
    tasksWithPositions.forEach((item) => {
      const root = find(item.task.id);
      const col = taskCol.get(item.task.id) ?? 0;
      groupCols.set(root, Math.max(groupCols.get(root) ?? 0, col + 1));
    });

    const layout = new Map<
      number,
      { columnIndex: number; totalColumns: number }
    >();
    tasksWithPositions.forEach((item) => {
      layout.set(item.task.id, {
        columnIndex: taskCol.get(item.task.id) ?? 0,
        totalColumns: groupCols.get(find(item.task.id)) ?? 1,
      });
    });

    return layout;
  };

  return (
    <div
      className={
        presentationMode
          ? "h-full overflow-x-auto rounded-lg border border-bordercl-subtle bg-surface/80"
          : "overflow-x-auto"
      }
      data-presentation-mode={presentationMode ? "true" : undefined}
      data-pdf-mode={pdfMode ? "true" : undefined}
      data-calendar-density={density}
    >
      {/* Auto-fit toolbar */}
      {!presentationMode && (
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-bordercl bg-surface-alt">
          <Tooltip content="Fit timeline to task range" side="bottom">
            <button
              onClick={handleAutoFit}
              disabled={tasksForDate.length === 0}
              className="px-2.5 py-1 text-xs font-medium rounded border border-bordercl-strong bg-surface hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Auto-Fit
            </button>
          </Tooltip>
          {isZoomed && (
            <Tooltip content="Reset to full day view" side="bottom">
              <button
                onClick={handleResetZoom}
                className="px-2.5 py-1 text-xs font-medium rounded border border-bordercl-strong bg-surface hover:bg-surface-hover"
              >
                Reset
              </button>
            </Tooltip>
          )}
          {isZoomed && (
            <span className="text-xs text-foreground-muted">
              {formatWorkingHourLabel(startHour)} -{" "}
              {formatWorkingHourLabel(endHour)}
            </span>
          )}
        </div>
      )}
      <div className="flex min-w-max">
        {/* Time column */}
        <div
          className={`flex-shrink-0 border-r ${
            presentationMode
              ? "w-20 border-bordercl-subtle bg-surface-alt/40"
              : "w-16 border-bordercl"
          }`}
        >
          <div
            className={`h-12 border-b ${
              presentationMode
                ? "border-bordercl-subtle bg-surface-alt/50"
                : "border-bordercl bg-surface-alt"
            }`}
          />
          {hours.map((hour) => (
            <div
              key={hour}
              className={`border-b px-2 py-2 relative ${
                presentationMode
                  ? "border-bordercl-subtle text-[11px] text-foreground-faint"
                  : "border-bordercl text-xs text-foreground-muted"
              }`}
              style={{ height: `${hourHeight}px` }}
            >
              {/* Full hour drop zone (0-30 min) */}
              <div
                className={`absolute inset-x-0 top-0 ${
                  presentationMode
                    ? "cursor-default"
                    : "cursor-pointer hover:bg-blue-50 dark:bg-blue-950/30 dark:hover:bg-blue-950/30"
                }`}
                data-testid={`calendar-time-sidebar-slot-${hour}-00`}
                style={{ height: `${halfHourHeight}px` }}
                onDragOver={(e) => {
                  if (presentationMode) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDropTargetSlot({ hour, isHalfHour: false });
                }}
                onDragLeave={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX;
                  const y = e.clientY;
                  if (
                    x < rect.left ||
                    x >= rect.right ||
                    y < rect.top ||
                    y >= rect.bottom
                  ) {
                    setDropTargetSlot(null);
                  }
                }}
                onDrop={(e) => {
                  if (presentationMode) return;
                  e.preventDefault();
                  const dataStr = e.dataTransfer.getData("application/json");
                  if (dataStr && onTaskDrop) {
                    const data = JSON.parse(dataStr);
                    const newTime = `${hour.toString().padStart(2, "0")}:00`;
                    const referenceTask = data.referenceTask;

                    if (data.tasks && data.tasks.length > 0) {
                      data.tasks.forEach((task: CalendarTask) => {
                        if (task.id === referenceTask.id) {
                          onTaskDrop(task, newTime, undefined, selectedDate);
                        } else {
                          onTaskDrop(task, newTime, referenceTask, selectedDate);
                        }
                      });
                    }
                  }
                  setDropTargetSlot(null);
                  setDraggedTasks(null);
                  setDraggedReferenceTask(null);
                  setIsDragging(false);
                }}
                onDoubleClick={(e) => {
                  if (presentationMode) return;
                  e.stopPropagation();
                  const clockTime = minutesToClockTime(hour * 60);
                  onSlotDoubleClick?.({
                    date: getActualDateForWorkingSlot(
                      selectedDate,
                      clockTime,
                      dayBoundary,
                    ),
                    time: clockTime,
                  });
                }}
              />

              {/* Half hour drop zone (30-60 min) */}
              <div
                className={`absolute inset-x-0 ${
                  presentationMode
                    ? "cursor-default"
                    : "cursor-pointer hover:bg-blue-50 dark:bg-blue-950/30 dark:hover:bg-blue-950/30"
                }`}
                data-testid={`calendar-time-sidebar-slot-${hour}-30`}
                style={{
                  top: `${halfHourHeight}px`,
                  height: `${halfHourHeight}px`,
                }}
                onDragOver={(e) => {
                  if (presentationMode) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDropTargetSlot({ hour, isHalfHour: true });
                }}
                onDragLeave={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX;
                  const y = e.clientY;
                  if (
                    x < rect.left ||
                    x >= rect.right ||
                    y < rect.top ||
                    y >= rect.bottom
                  ) {
                    setDropTargetSlot(null);
                  }
                }}
                onDrop={(e) => {
                  if (presentationMode) return;
                  e.preventDefault();
                  const dataStr = e.dataTransfer.getData("application/json");
                  if (dataStr && onTaskDrop) {
                    const data = JSON.parse(dataStr);
                    const newTime = `${hour.toString().padStart(2, "0")}:30`;
                    const referenceTask = data.referenceTask;

                    if (data.tasks && data.tasks.length > 0) {
                      data.tasks.forEach((task: CalendarTask) => {
                        if (task.id === referenceTask.id) {
                          onTaskDrop(task, newTime, undefined, selectedDate);
                        } else {
                          onTaskDrop(task, newTime, referenceTask, selectedDate);
                        }
                      });
                    }
                  }
                  setDropTargetSlot(null);
                  setDraggedTasks(null);
                  setDraggedReferenceTask(null);
                  setIsDragging(false);
                }}
                onDoubleClick={(e) => {
                  if (presentationMode) return;
                  e.stopPropagation();
                  const clockTime = minutesToClockTime(hour * 60 + 30);
                  onSlotDoubleClick?.({
                    date: getActualDateForWorkingSlot(
                      selectedDate,
                      clockTime,
                      dayBoundary,
                    ),
                    time: clockTime,
                  });
                }}
              />

              <span className="relative z-10">
                {formatWorkingHourLabel(hour)}
              </span>
            </div>
          ))}
        </div>

        {/* Single task column */}
        <div
          className={`flex-1 border-r ${
            presentationMode
              ? "min-w-[360px] border-bordercl-subtle"
              : "min-w-[200px] border-bordercl"
          }`}
        >
          {/* Header */}
          <div
            className={`h-12 border-b px-4 py-2 font-semibold text-sm ${
              presentationMode
                ? "border-bordercl-subtle bg-surface-alt/50 text-foreground-secondary"
                : "border-bordercl bg-surface-alt"
            }`}
          >
            {presentationMode ? "Schedule" : "Tasks"}
          </div>

          {/* Time grid */}
          <div
            className="relative overflow-hidden"
            data-calendar-grid
            style={{ height: `${hours.length * hourHeight}px` }}
          >
            {/* Hour lines with 30-minute subdivisions */}
            {hours.map((hour, index) => (
              <React.Fragment key={index}>
                {/* Full hour slot (0-30 min) */}
                <div
                  className={`absolute w-full border-b border-bordercl-subtle ${
                    presentationMode
                      ? "cursor-default"
                      : isDragging
                        ? "hover:bg-surface-hover cursor-pointer"
                        : "cursor-pointer"
                  }`}
                  data-testid={`calendar-grid-slot-${hour}-00`}
                  style={{
                    top: `${index * hourHeight}px`,
                    height: `${halfHourHeight}px`,
                  }}
                  onDragOver={(e) => {
                    if (presentationMode) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDropTargetSlot({ hour, isHalfHour: false });
                  }}
                  onDragLeave={(e) => {
                    // Only clear if we're actually leaving the element
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX;
                    const y = e.clientY;
                    if (
                      x < rect.left ||
                      x >= rect.right ||
                      y < rect.top ||
                      y >= rect.bottom
                    ) {
                      setDropTargetSlot(null);
                    }
                  }}
                  onDrop={(e) => {
                    if (presentationMode) return;
                    e.preventDefault();
                    setDropTargetSlot(null);
                    setDraggedTasks(null);
                    const taskData = e.dataTransfer.getData("application/json");
                    if (taskData && onTaskDrop) {
                      const dragData = JSON.parse(taskData);
                      const newTime = `${hour.toString().padStart(2, "0")}:00`;

                      // Use the reference task (the one actually being dragged) for positioning
                      const referenceTask = dragData.referenceTask;

                      if (dragData.tasks && dragData.tasks.length > 0) {
                        dragData.tasks.forEach((task: CalendarTask) => {
                          // For the reference task itself, drop at exact position (no offset)
                          // For other tasks, use the reference task to maintain relative position
                          if (task.id === referenceTask.id) {
                            onTaskDrop(task, newTime, undefined, selectedDate);
                          } else {
                            onTaskDrop(task, newTime, referenceTask, selectedDate);
                          }
                        });
                      }
                    }
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (onSlotDoubleClick) {
                      const clockTime = minutesToClockTime(hour * 60);
                      onSlotDoubleClick({
                        date: getActualDateForWorkingSlot(
                          selectedDate,
                          clockTime,
                          dayBoundary,
                        ),
                        time: clockTime,
                      });
                    }
                  }}
                ></div>
                {/* Half hour slot (30-60 min) */}
                <div
                  className={`absolute w-full border-b border-bordercl-subtle ${
                    presentationMode
                      ? "cursor-default"
                      : isDragging
                        ? "hover:bg-surface-hover cursor-pointer"
                        : "cursor-pointer"
                  }`}
                  data-testid={`calendar-grid-slot-${hour}-30`}
                  style={{
                    top: `${index * hourHeight + halfHourHeight}px`,
                    height: `${halfHourHeight}px`,
                  }}
                  onDragOver={(e) => {
                    if (presentationMode) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDropTargetSlot({ hour, isHalfHour: true });
                  }}
                  onDragLeave={(e) => {
                    // Only clear if we're actually leaving the element
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX;
                    const y = e.clientY;
                    if (
                      x < rect.left ||
                      x >= rect.right ||
                      y < rect.top ||
                      y >= rect.bottom
                    ) {
                      setDropTargetSlot(null);
                    }
                  }}
                  onDrop={(e) => {
                    if (presentationMode) return;
                    e.preventDefault();
                    setDropTargetSlot(null);
                    setDraggedTasks(null);
                    const taskData = e.dataTransfer.getData("application/json");
                    if (taskData && onTaskDrop) {
                      const dragData = JSON.parse(taskData);
                      const newTime = `${hour.toString().padStart(2, "0")}:30`;

                      // Use the reference task (the one actually being dragged) for positioning
                      const referenceTask = dragData.referenceTask;

                      if (dragData.tasks && dragData.tasks.length > 0) {
                        dragData.tasks.forEach((task: CalendarTask) => {
                          // For the reference task itself, drop at exact position (no offset)
                          // For other tasks, use the reference task to maintain relative position
                          if (task.id === referenceTask.id) {
                            onTaskDrop(task, newTime, undefined, selectedDate);
                          } else {
                            onTaskDrop(task, newTime, referenceTask, selectedDate);
                          }
                        });
                      }
                    }
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (onSlotDoubleClick) {
                      const clockTime = minutesToClockTime(hour * 60 + 30);
                      onSlotDoubleClick({
                        date: getActualDateForWorkingSlot(
                          selectedDate,
                          clockTime,
                          dayBoundary,
                        ),
                        time: clockTime,
                      });
                    }
                  }}
                ></div>
              </React.Fragment>
            ))}

            {/* Drop zone preview - rendered at grid level */}
            {draggedTasks && draggedReferenceTask && dropTargetSlot && (
              <div className="absolute inset-0 pointer-events-none">
                {draggedTasks.map((task, idx) => {
                  if (!task.start_end_time) return null;

                  // Calculate the drop time in minutes
                  const dropTimeMinutes =
                    dropTargetSlot.hour * 60 +
                    (dropTargetSlot.isHalfHour ? 30 : 0);

                  // Get the original start time of the reference task (the one being dragged)
                  const referenceTaskStartMinutes =
                    toWorkingDayMinutes(
                      draggedReferenceTask.date,
                      draggedReferenceTask.start_end_time!.start,
                      selectedDate,
                    ) ??
                    timeToMinutes(draggedReferenceTask.start_end_time!.start);

                  // Calculate offset for this task relative to the reference task
                  const taskStartMinutes =
                    toWorkingDayMinutes(
                      task.date,
                      task.start_end_time.start,
                      selectedDate,
                    ) ?? timeToMinutes(task.start_end_time.start);
                  const taskEndMinutes =
                    endToWorkingDayMinutes(
                      task.date,
                      task.start_end_time.start,
                      task.start_end_time.end,
                      selectedDate,
                    ) ?? timeToMinutes(task.start_end_time.end);
                  const offsetFromReference =
                    taskStartMinutes - referenceTaskStartMinutes;

                  // Calculate new position for this task
                  const newStartMinutes = dropTimeMinutes + offsetFromReference;
                  const duration = taskEndMinutes - taskStartMinutes;

                  // Convert to pixels (relative to the start of day)
                  const startOfDay = startHour * 60;
                  const topPx =
                    ((newStartMinutes - startOfDay) / 60) * hourHeight;
                  const heightPx = (duration / 60) * hourHeight;

                  return (
                    <div
                      key={`preview-${task.id}-${idx}`}
                      className="absolute border-2 border-dashed rounded"
                      style={{
                        top: `${topPx}px`,
                        height: `${heightPx}px`,
                        left: 0,
                        right: 0,
                        backgroundColor: hexToRgba(task.task_type_color, 0.15),
                        borderColor: task.task_type_color,
                      }}
                    >
                      <div
                        className="text-xs font-semibold p-1 truncate"
                        style={{ color: task.task_type_color }}
                      >
                        {task.name}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {backgroundRailItems.map(({ block, top, height, columnIndex, totalColumns }) => {
              const widthPercent = 100 / totalColumns;
              const leftPercent = columnIndex * widthPercent;
              const laneGap = totalColumns > 1 ? 4 : 0;
              const colour = block.colour || "#64748b";
              const accentColour = hexToRgba(colour, 0.72);
              const guideColour = hexToRgba(colour, 0.18);
              const details = [block.location, block.audience, block.responsible]
                .filter(Boolean)
                .join(" - ");
              const title = [
                `${block.start_time}-${block.end_time}`,
                block.title,
                details,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <div
                  key={`background-${block.id}`}
                  className="group pointer-events-none absolute left-0 right-0 z-[1]"
                  style={{
                    top,
                    height,
                  }}
                  aria-hidden="true"
                >
                  <div
                    className="pointer-events-auto relative z-[3] h-full pr-2"
                    style={{
                      width: `${backgroundLabelWidth}px`,
                    }}
                  >
                    <div
                      className="absolute inset-y-0 overflow-hidden rounded-md border bg-surface/95 px-2 py-0.5 shadow-sm"
                      style={{
                        left:
                          totalColumns > 1
                            ? `calc(${leftPercent}% + ${laneGap / 2}px)`
                            : 0,
                        width:
                          totalColumns > 1
                            ? `calc(${widthPercent}% - ${laneGap}px)`
                            : "calc(100% - 0px)",
                        borderColor: accentColour,
                        borderLeft: `3px solid ${accentColour}`,
                      }}
                      title={title}
                    >
                      <div className="h-full overflow-hidden break-words text-[10px] leading-[1.1]">
                        <span className="font-mono text-foreground-muted">
                          {block.start_time}-{block.end_time}
                        </span>
                        <span className="px-1 text-[11px] font-semibold text-foreground">
                          {block.title}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div
                    className="absolute top-0 bottom-0 z-[1] opacity-0 transition-opacity group-hover:opacity-100"
                    style={{
                      left: `${backgroundLabelWidth}px`,
                      right: 0,
                      borderTop: `1px solid ${guideColour}`,
                      borderBottom: `1px solid ${guideColour}`,
                    }}
                  />
                </div>
              );
            })}

            {/* Masterplan mode: 16-column grid guide lines */}
            {masterplanMode && masterplanPreview && (
              <div className="absolute inset-0 pointer-events-none z-[50]">
                {Array.from({ length: GRID_COLS + 1 }, (_, i) => (
                  <div
                    key={`grid-${i}`}
                    className="absolute top-0 bottom-0"
                    style={{
                      left: `${i * SNAP_SIZE}%`,
                      width: "1px",
                      backgroundColor:
                        i === 0 || i === GRID_COLS
                          ? "rgba(156,163,175,0.4)"
                          : "rgba(156,163,175,0.2)",
                    }}
                  />
                ))}
              </div>
            )}

            {/* Masterplan mode: snap preview (red tint at target position) */}
            {masterplanMode &&
              masterplanPreview &&
              (() => {
                const previewTask = tasksForDate.find(
                  (t) => t.id === masterplanPreview.taskId,
                );
                if (!previewTask) return null;
                const pos = getTaskPosition(previewTask);
                if (!pos) return null;
                const isSwap = !!masterplanPreview.swapTargetId;
                const isResize = !!masterplanPreview.isResize;
                return (
                  <>
                    {/* Main preview outline */}
                    <div
                      className={`absolute pointer-events-none z-[49] rounded border-2 border-dashed ${
                        isSwap ? "border-blue-500" : "border-red-400"
                      }`}
                      style={{
                        top: pos.top,
                        height: pos.height,
                        left: `${masterplanPreview.left}%`,
                        width: `${masterplanPreview.width}%`,
                        backgroundColor: isSwap
                          ? "rgba(59, 130, 246, 0.12)"
                          : "rgba(239, 68, 68, 0.10)",
                      }}
                    >
                      {/* Resize: show tile count above arrow, arrow with fixed-size tips */}
                      {isResize && masterplanPreview.tiles != null && (
                        <div className="absolute bottom-1 left-0 right-0 pointer-events-none">
                          {/* Tile count above arrow */}
                          <div className="flex items-center justify-center mb-0.5">
                            <span className="text-[10px] font-semibold text-black dark:text-white leading-none bg-white/70 dark:bg-gray-800/70 rounded px-0.5">
                              {masterplanPreview.tiles}
                            </span>
                          </div>
                          {/* Arrow with fixed-size tips */}
                          <div
                            className="relative flex items-center mx-1"
                            style={{ height: "10px" }}
                          >
                            <svg
                              width="6"
                              height="10"
                              viewBox="0 0 6 10"
                              className="flex-shrink-0"
                            >
                              <path
                                d="M0 5L5 2M0 5L5 8"
                                stroke="black"
                                strokeWidth="1.2"
                                fill="none"
                              />
                            </svg>
                            <div className="flex-1 h-px bg-black" />
                            <svg
                              width="6"
                              height="10"
                              viewBox="0 0 6 10"
                              className="flex-shrink-0"
                            >
                              <path
                                d="M6 5L1 2M6 5L1 8"
                                stroke="black"
                                strokeWidth="1.2"
                                fill="none"
                              />
                            </svg>
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Swap: highlight the target task that will be swapped */}
                    {isSwap &&
                      (() => {
                        const swapTask = tasksForDate.find(
                          (t) => t.id === masterplanPreview.swapTargetId,
                        );
                        if (!swapTask) return null;
                        const swapPos = getTaskPosition(swapTask);
                        if (!swapPos) return null;
                        // Show where the swap target will move to (the dragged task's original position)
                        const layout = getTaskLayout();
                        const draggedLayout = layout.get(previewTask.id);
                        const draggedColIndex = draggedLayout?.columnIndex ?? 0;
                        const draggedTotalCols =
                          draggedLayout?.totalColumns ?? 1;
                        const draggedAutoWidth = 100 / draggedTotalCols;
                        const draggedBaseLeft =
                          draggedColIndex * draggedAutoWidth;
                        const draggedOrigLeft =
                          draggedBaseLeft + (previewTask._visual_x_offset || 0);
                        const draggedOrigWidth =
                          previewTask._visual_width != null
                            ? previewTask._visual_width
                            : draggedAutoWidth;
                        return (
                          <div
                            className="absolute pointer-events-none z-[48] rounded border-2 border-dashed border-blue-400"
                            style={{
                              top: swapPos.top,
                              height: swapPos.height,
                              left: `${draggedOrigLeft}%`,
                              width: `${draggedOrigWidth}%`,
                              backgroundColor: "rgba(59, 130, 246, 0.08)",
                            }}
                          />
                        );
                      })()}
                  </>
                );
              })()}

            {/* Tasks */}
            <div
              className="pointer-events-none absolute inset-y-0 right-0 z-10"
              style={{ left: `${backgroundLabelWidth}px` }}
            >
              {(() => {
              const layout = getTaskLayout(); // Calculate layout once for all tasks

              // Pre-compute all tasks' absolute positions for sibling collision detection
              const taskAbsolutePositions = tasksForDate.map((t) => {
                const pos = getTaskPosition(t);
                const li = layout.get(t.id);
                const colIdx = li?.columnIndex ?? 0;
                const totalCols = li?.totalColumns ?? 1;
                const rawWp = 100 / totalCols;
                // In masterplan mode, snap auto width to grid (floor) so non-divisor counts align
                const wp = masterplanMode
                  ? Math.max(SNAP_SIZE, snapToGridFloor(rawWp))
                  : rawWp;
                const lp = masterplanMode ? colIdx * wp : colIdx * rawWp;
                const xOff = t._visual_x_offset || 0;
                const ew = t._visual_width != null ? t._visual_width : wp;
                const absLeft = Math.max(0, lp + xOff);
                return {
                  taskId: t.id,
                  left: absLeft,
                  width: Math.min(ew, 100 - absLeft),
                  columnLeft: lp,
                  start: pos?.start ?? 0,
                  end: pos?.end ?? 0,
                };
              });

              return tasksForDate.map((task) => {
                const position = getTaskPosition(task);
                if (!position) return null;

                const layoutInfo = layout.get(task.id);
                const columnIndex = layoutInfo?.columnIndex ?? 0;
                const totalColumns = layoutInfo?.totalColumns ?? 1;

                const rawWidthPercent = 100 / totalColumns;
                // In masterplan mode, snap auto width to grid (floor) so non-divisor counts align
                const widthPercent = masterplanMode
                  ? Math.max(SNAP_SIZE, snapToGridFloor(rawWidthPercent))
                  : rawWidthPercent;
                const leftPercent = masterplanMode
                  ? columnIndex * widthPercent
                  : columnIndex * rawWidthPercent;

                // Apply masterplan layout overrides
                const xOffset = task._visual_x_offset || 0;
                const effectiveWidth =
                  task._visual_width != null
                    ? task._visual_width
                    : widthPercent;
                const rawLeft = leftPercent + xOffset;

                // Clamp to prevent tasks from extending beyond calendar bounds
                const clampedLeft = Math.max(0, rawLeft);
                const clampedWidth = Math.min(
                  effectiveWidth,
                  100 - clampedLeft,
                );

                // start_end_time tasks are foreground tasks (draggable)
                // time_range tasks were previously background, but now treated normally
                const isBackground = false; // All tasks are foreground now
                const isTimeRange = false; // No longer using this distinction

                // Build sibling positions: other tasks overlapping in time with this task
                const myPos = taskAbsolutePositions.find(
                  (tp) => tp.taskId === task.id,
                );
                const siblings = masterplanMode
                  ? taskAbsolutePositions.filter(
                      (tp) =>
                        tp.taskId !== task.id &&
                        myPos &&
                        tp.start < myPos.end &&
                        myPos.start < tp.end,
                    )
                  : [];

                return (
                  <div
                    key={task.id}
                    className="pointer-events-auto absolute"
                    style={{
                      top: position.top,
                      height: position.height,
                      left: `${clampedLeft}%`,
                      width: `${clampedWidth}%`,
                      paddingLeft:
                        columnIndex === 0 && xOffset === 0 ? "4px" : "2px",
                      paddingRight:
                        columnIndex === totalColumns - 1 ? "4px" : "2px",
                    }}
                  >
                    <CalendarCard
                      task={task}
                      isBackground={isBackground}
                      isTimeRange={isTimeRange}
                      onDoubleClick={() => onTaskEdit(task)}
                      onClick={() => onTaskClick?.(task)}
                      onShiftClick={() => {
                        onTaskShiftClick?.(task);
                      }}
                      isSelected={selectedTaskIds?.includes(task.id)}
                      isHighlighted={highlightedTaskIds?.includes(task.id)}
                      viewType="daily"
                      selectedTaskIds={selectedTaskIds}
                      allTasks={tasks}
                      isInfeasible={infeasibleTaskIds?.has(Math.floor(task.id))}
                      isIgnored={ignoredTaskIds?.has(Math.floor(task.id))}
                      infeasibleErrors={infeasibleTaskErrors?.get(
                        Math.floor(task.id),
                      )}
                      persons={persons}
                      onPersonRightClick={onPersonRightClick}
                      masterplanMode={masterplanMode}
                      onColorChange={
                        onLayoutChange
                          ? (taskId, color) =>
                              onLayoutChange(taskId, { custom_color: color })
                          : undefined
                      }
                      onHorizontalDragEnd={
                        onLayoutChange
                          ? (taskId, newXOffset) =>
                              onLayoutChange(taskId, {
                                visual_x_offset: newXOffset,
                              })
                          : undefined
                      }
                      onWidthResizeEnd={
                        onLayoutChange
                          ? (taskId, newWidth) =>
                              onLayoutChange(taskId, { visual_width: newWidth })
                          : undefined
                      }
                      autoWidthPercent={widthPercent}
                      currentXOffset={xOffset}
                      currentWidth={task._visual_width}
                      columnLeft={leftPercent}
                      siblingPositions={siblings}
                      onSwapTasks={
                        onLayoutChange
                          ? (id1, off1, w1, id2, off2, w2) => {
                              onLayoutChange(id1, {
                                visual_x_offset: off1,
                                visual_width: w1,
                              });
                              onLayoutChange(id2, {
                                visual_x_offset: off2,
                                visual_width: w2,
                              });
                            }
                          : undefined
                      }
                      onMasterplanPreview={handleMasterplanPreview}
                      presentationMode={presentationMode}
                      density={density}
                      onDragStart={(tasks, draggedTask) => {
                        setDraggedTasks(tasks);
                        setDraggedReferenceTask(draggedTask);
                        setIsDragging(true);
                      }}
                      onDragEnd={() => {
                        setDraggedTasks(null);
                        setDraggedReferenceTask(null);
                        setDropTargetSlot(null);
                        setIsDragging(false);
                      }}
                      onRelativeDrop={
                        enableTaskRelativeDrop &&
                        onTaskDrop &&
                        !draggedTasks?.some(
                          (draggedTask) => draggedTask.id === task.id,
                        )
                          ? handleRelativeTaskDrop
                          : undefined
                      }
                      onRelativeDragOver={() => setDropTargetSlot(null)}
                      isDragging={isDragging}
                    />
                  </div>
                );
              });
            })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Render the daily calendar board used by schedule, optimisation, and presentation views. */
const Calendar: React.FC<CalendarProps> = ({
  tasks,
  viewType,
  eventStartDate,
  eventEndDate,
  selectedDate,
  onTaskEdit,
  onTaskClick,
  onTaskShiftClick,
  onTaskDrop,
  enableTaskRelativeDrop,
  selectedTaskIds,
  highlightedTaskIds,
  backgroundBlocks,
  scheduleDayRange,
  scheduleDayBoundary,
  onSlotDoubleClick,
  infeasibleTaskIds,
  infeasibleTaskErrors,
  ignoredTaskIds,
  persons,
  onPersonRightClick,
  masterplanMode,
  presentationMode,
  pdfMode,
  density = "comfortable",
  onLayoutChange,
}) => {
  return (
    <DailyView
      tasks={tasks}
      selectedDate={
        selectedDate ||
        (() => {
          const n = new Date();
          return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
        })()
      }
      onTaskEdit={onTaskEdit}
      onTaskClick={onTaskClick}
      onTaskShiftClick={onTaskShiftClick}
      onTaskDrop={onTaskDrop}
      enableTaskRelativeDrop={enableTaskRelativeDrop}
      selectedTaskIds={selectedTaskIds}
      highlightedTaskIds={highlightedTaskIds}
      backgroundBlocks={backgroundBlocks}
      scheduleDayRange={scheduleDayRange}
      scheduleDayBoundary={scheduleDayBoundary}
      onSlotDoubleClick={onSlotDoubleClick}
      infeasibleTaskIds={infeasibleTaskIds}
      infeasibleTaskErrors={infeasibleTaskErrors}
      ignoredTaskIds={ignoredTaskIds}
      persons={persons}
      onPersonRightClick={onPersonRightClick}
      masterplanMode={masterplanMode}
      presentationMode={presentationMode}
      pdfMode={pdfMode}
      density={density}
      onLayoutChange={onLayoutChange}
    />
  );
};

export default Calendar;
export type {
  CalendarBackgroundBlock,
  CalendarDensity,
  CalendarProps,
  CalendarTask,
  CalendarViewType,
};
