"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleHelp,
  XCircle,
} from "lucide-react";
import { confidenceClasses } from "@/lib/confidence";
import type {
  EventStatusItemId,
  EventStatusSummary,
} from "@/lib/eventStatusSummary";

export type EventStatusBarAction = {
  label: string;
  onClick: () => void;
};

export type EventStatusBarActions = Partial<
  Record<EventStatusItemId, EventStatusBarAction>
>;

interface EventStatusBarProps {
  summary: EventStatusSummary;
  actions?: EventStatusBarActions;
}

/** Render a compact confidence summary for the selected event. */
export function EventStatusBar({
  summary,
  actions = {},
}: EventStatusBarProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const Icon = getStatusIcon(summary.primary.level);
  const primaryAction = summary.primary.actionId
    ? actions[summary.primary.actionId]
    : undefined;

  return (
    <section
      aria-label="Event status summary"
      className={`rounded-md border px-3 py-1.5 shadow-sm ${
        summary.primary.level === "blocked"
          ? "border-red-200 bg-red-50/70 text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300"
          : "border-bordercl bg-surface/80 text-foreground"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Icon
            className={`h-4 w-4 shrink-0 ${confidenceClasses(
              summary.primary.level,
              "text",
            )}`}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              <span
                className="font-semibold text-foreground"
                data-testid="event-status-headline"
              >
                {summary.primary.title}
              </span>
              {summary.primary.description && (
                <>
                  <span className="mx-1.5 text-foreground-faint">-</span>
                  <span className="text-foreground-muted">
                    {summary.primary.description}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="relative ml-auto flex shrink-0 items-center gap-2">
          {primaryAction && (
            <button
              type="button"
              onClick={primaryAction.onClick}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${confidenceClasses(
                summary.primary.level,
                summary.primary.level === "blocked"
                  ? "button"
                  : "subtleButton",
              )}`}
            >
              {primaryAction.label}
            </button>
          )}

          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            className="rounded-md px-1.5 py-1 text-xs font-medium text-foreground-faint transition-colors hover:bg-surface-hover hover:text-foreground-muted"
            aria-expanded={detailsOpen}
          >
            Details
          </button>

          {detailsOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-lg border border-bordercl bg-surface p-2 shadow-lg">
              <div className="space-y-1">
                {summary.items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-md px-2 py-1.5 text-xs hover:bg-surface-hover"
                    data-testid={`event-status-item-${item.id}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 font-medium text-foreground-secondary">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${confidenceClasses(
                            item.level,
                            "dot",
                          )}`}
                        />
                        {item.label}
                      </span>
                      <span
                        className={`font-semibold ${confidenceClasses(
                          item.level,
                          "text",
                        )}`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-0.5 text-foreground-muted">
                      {item.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function getStatusIcon(level: EventStatusSummary["level"]) {
  if (level === "ready") return CheckCircle2;
  if (level === "review") return AlertTriangle;
  if (level === "blocked") return XCircle;
  if (level === "unknown") return CircleHelp;
  return Circle;
}
