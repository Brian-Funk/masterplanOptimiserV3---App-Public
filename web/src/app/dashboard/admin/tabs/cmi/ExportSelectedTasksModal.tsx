"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { TaskInstance } from "@/lib/api";
import { Button, Modal } from "@/components/ui";
import { formatDateWithWeekday } from "@/lib/dateFormat";

type EventDay = {
  date: string;
  label: string;
};

interface ExportSelectedTasksModalProps {
  open: boolean;
  selectedTasks: TaskInstance[];
  sourceDate: string;
  eventStartDate: string;
  eventEndDate: string;
  dayAliases?: Record<string, string>;
  isExporting?: boolean;
  onCancel: () => void;
  onExport: (targetDates: string[]) => Promise<void> | void;
}

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T00:00:00`);
  parsed.setDate(parsed.getDate() + amount);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function getEventDays(
  startDate: string,
  endDate: string,
  dayAliases: Record<string, string> = {},
): EventDay[] {
  if (!startDate || !endDate) return [];
  const days: EventDay[] = [];
  let current = startDate;
  while (current <= endDate) {
    const alias = dayAliases[current];
    const formatted = formatDateWithWeekday(current);
    days.push({
      date: current,
      label: alias ? `${alias} - ${formatted}` : formatted,
    });
    current = addDays(current, 1);
  }
  return days;
}

function pluralise(value: number, singular: string, plural = `${singular}s`) {
  return value === 1 ? singular : plural;
}

export function ExportSelectedTasksModal({
  open,
  selectedTasks,
  sourceDate,
  eventStartDate,
  eventEndDate,
  dayAliases,
  isExporting = false,
  onCancel,
  onExport,
}: ExportSelectedTasksModalProps) {
  const [selectedTargetDates, setSelectedTargetDates] = useState<string[]>([]);
  const eventDays = useMemo(
    () => getEventDays(eventStartDate, eventEndDate, dayAliases),
    [dayAliases, eventEndDate, eventStartDate],
  );
  const targetDays = eventDays.filter((day) => day.date !== sourceDate);
  const sourceDay = eventDays.find((day) => day.date === sourceDate);
  const visibleTaskNames = selectedTasks.slice(0, 4).map((task) => task.name);
  const hiddenTaskCount = Math.max(0, selectedTasks.length - visibleTaskNames.length);
  const createdCount = selectedTasks.length * selectedTargetDates.length;
  const canExport = selectedTargetDates.length > 0 && !isExporting;

  useEffect(() => {
    if (open) setSelectedTargetDates([]);
  }, [open]);

  const toggleTarget = (date: string) => {
    setSelectedTargetDates((current) =>
      current.includes(date)
        ? current.filter((item) => item !== date)
        : [...current, date],
    );
  };

  const handleExport = async () => {
    if (!canExport) return;
    await onExport(selectedTargetDates);
  };

  return (
    <Modal open={open} onClose={isExporting ? () => {} : onCancel} maxWidth="lg">
      <div className="p-5 space-y-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Export selected tasks
          </h3>
          <p className="mt-1 text-sm text-foreground-muted">
            From {sourceDay?.label ?? formatDateWithWeekday(sourceDate)}
          </p>
        </div>

        <div className="rounded-lg border border-bordercl bg-surface-inset p-3">
          <p className="text-sm font-medium text-foreground">
            {selectedTasks.length} selected{" "}
            {pluralise(selectedTasks.length, "task")}
          </p>
          {visibleTaskNames.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-foreground-muted">
              {visibleTaskNames.map((taskName, index) => (
                <li key={`${taskName}-${index}`} className="truncate">
                  {taskName}
                </li>
              ))}
              {hiddenTaskCount > 0 && <li>+ {hiddenTaskCount} more</li>}
            </ul>
          )}
        </div>

        <div>
          <h4 className="text-sm font-medium text-foreground-secondary">
            Export to
          </h4>
          {targetDays.length === 0 ? (
            <p className="mt-2 rounded-lg border border-bordercl bg-surface-inset p-3 text-sm text-foreground-muted">
              There are no other days in this event.
            </p>
          ) : (
            <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
              {targetDays.map((day) => (
                <label
                  key={day.date}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-bordercl bg-surface px-3 py-2 text-sm hover:bg-surface-hover"
                >
                  <input
                    type="checkbox"
                    checked={selectedTargetDates.includes(day.date)}
                    onChange={() => toggleTarget(day.date)}
                    disabled={isExporting}
                    className="h-4 w-4 rounded border-bordercl-strong text-primary"
                  />
                  <span className="text-foreground">{day.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg bg-surface-inset px-3 py-2 text-sm text-foreground-muted">
          {selectedTargetDates.length === 0 ? (
            <span>Select at least one target day.</span>
          ) : (
            <span>
              {selectedTasks.length} {pluralise(selectedTasks.length, "task")}{" "}
              will be copied to {selectedTargetDates.length}{" "}
              {pluralise(selectedTargetDates.length, "day")}. {createdCount} new{" "}
              {pluralise(createdCount, "task")} will be created.
            </span>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-bordercl pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isExporting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleExport}
            disabled={!canExport}
          >
            {isExporting ? "Exporting..." : "Export tasks"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
