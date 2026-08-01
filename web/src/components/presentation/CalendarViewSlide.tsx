"use client";

import React from "react";
import Calendar, {
  type CalendarDensity,
  type CalendarProps,
  type CalendarTask,
} from "@/components/Calendar";

interface CalendarViewSlideProps {
  date: string;
  dayLabel: string;
  tasks: CalendarTask[];
  highlightedTaskId?: number | null;
  density?: CalendarDensity;
  scheduleDayRange?: CalendarProps["scheduleDayRange"];
  scheduleDayBoundary?: CalendarProps["scheduleDayBoundary"];
  onTaskDoubleClick?: (taskId: number) => void;
}

/** Full calendar view slide reusing the Calendar component */
export default function CalendarViewSlide({
  date,
  dayLabel,
  tasks,
  highlightedTaskId,
  density = "comfortable",
  scheduleDayRange,
  scheduleDayBoundary,
  onTaskDoubleClick,
}: CalendarViewSlideProps) {
  const highlighted = highlightedTaskId ? [highlightedTaskId] : [];

  return (
    <div
      className="flex h-full w-full flex-col bg-surface-alt/40 text-foreground select-none"
      data-testid="presentation-calendar-view"
    >
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <Calendar
          tasks={tasks}
          viewType="daily"
          selectedDate={date}
          onTaskEdit={(task) => onTaskDoubleClick?.(task.id)}
          highlightedTaskIds={highlighted}
          scheduleDayRange={scheduleDayRange}
          scheduleDayBoundary={scheduleDayBoundary}
          presentationMode
          density={density}
        />
      </div>
    </div>
  );
}
