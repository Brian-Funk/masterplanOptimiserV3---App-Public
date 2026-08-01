"use client";

import React from "react";
import type { JobSummary } from "@/types/optimization";
import {
  confidenceClasses,
  getOptimisationConfidence,
} from "@/lib/confidence";

interface DaysOverviewProps {
  startDate: string;
  endDate: string;
  jobs: JobSummary[];
  selectedDate: string;
  onDateSelect: (date: string) => void;
}

/** Render a compact day grid that uses the shared confidence colour language. */
export default function DaysOverview({
  startDate,
  endDate,
  jobs,
  selectedDate,
  onDateSelect,
}: DaysOverviewProps) {
  const getDaysArray = (start: string, end: string): string[] => {
    const dates: string[] = [];
    const startD = new Date(start + "T00:00:00");
    const endD = new Date(end + "T00:00:00");
    let current = new Date(startD);

    while (current <= endD) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, "0");
      const day = String(current.getDate()).padStart(2, "0");
      dates.push(`${year}-${month}-${day}`);
      current.setDate(current.getDate() + 1);
    }

    return dates;
  };

  const days = getDaysArray(startDate, endDate);

  const getStatusIndicator = (date: string) => {
    const job = jobs.find((j) => j.date === date);
    const confidence = getOptimisationConfidence(job?.status);

    return (
      <span
        className={`mx-auto block h-2 w-2 rounded-full ${
          job?.status === "running" ? "animate-pulse" : ""
        } ${confidenceClasses(confidence.level, "dot")}`}
        title={confidence.description}
      />
    );
  };

  return (
    <div className="bg-surface rounded-lg border border-bordercl p-6">
      <h4 className="text-sm font-semibold text-foreground mb-4">
        All Days Overview
      </h4>
      <div className="grid grid-cols-7 gap-2">
        {days.map((date) => (
          <button
            key={date}
            onClick={() => onDateSelect(date)}
            className={`p-2 rounded text-xs transition-colors ${
              selectedDate === date
                ? "bg-blue-100 border-2 border-blue-500"
                : "bg-surface-alt border border-bordercl hover:bg-surface-hover"
            }`}
          >
            <div className="font-medium">{date.split("-")[2]}</div>
            <div className="mt-1">{getStatusIndicator(date)}</div>
          </button>
        ))}
      </div>
      <div className="mt-4 pt-4 border-t flex flex-wrap items-center gap-4 text-xs text-foreground-muted">
        <LegendItem level="unknown" label="Not Run" />
        <LegendItem level="review" label="Queued or Running" />
        <LegendItem level="ready" label="Done" />
        <LegendItem level="blocked" label="Failed" />
      </div>
    </div>
  );
}

function LegendItem({
  level,
  label,
}: {
  level: "ready" | "review" | "blocked" | "unknown";
  label: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <span
        className={`h-2 w-2 rounded-full ${confidenceClasses(level, "dot")}`}
      />
      <span>{label}</span>
    </div>
  );
}
