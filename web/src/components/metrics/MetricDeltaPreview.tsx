"use client";

import React from "react";
import { PersonDelta } from "@/lib/metrics/MetricDeltaCalculator";

interface MetricDeltaPreviewProps {
  deltas: PersonDelta[];
  taskDate: string;
  taskHours: number;
  dayAliases?: Record<string, string>;
  compact?: boolean;
}

const MetricDeltaPreview: React.FC<MetricDeltaPreviewProps> = ({
  deltas,
  taskDate,
  taskHours,
  dayAliases = {},
  compact = false,
}) => {
  if (deltas.length === 0) return null;

  const MAX_HOURS = 12; // scale bar to 12h max

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      {!compact && (
        <div className="text-xs font-medium text-foreground-muted uppercase tracking-wide">
          Metric Impact ({dayAliases[taskDate] || taskDate})
        </div>
      )}
      {deltas.map((delta) => {
        const currentOnDay = delta.currentHours[taskDate] || 0;
        const proposedOnDay = delta.proposedHours[taskDate] || 0;
        const isIncrease = delta.dayDelta > 0;
        const currentPct = (currentOnDay / MAX_HOURS) * 100;
        const proposedPct = (proposedOnDay / MAX_HOURS) * 100;

        if (compact) {
          return (
            <div
              key={delta.personId}
              className="flex items-center gap-2 text-xs"
            >
              <span className="w-24 truncate font-medium text-foreground-secondary">
                {delta.personName}
              </span>
              <span className="text-foreground-faint">
                {currentOnDay.toFixed(1)}h →
              </span>
              <span
                className={`font-bold ${isIncrease ? "text-red-600" : "text-green-600"}`}
              >
                {proposedOnDay.toFixed(1)}h
              </span>
              <span
                className={`text-[10px] ${isIncrease ? "text-red-500" : "text-green-500"}`}
              >
                ({isIncrease ? "+" : ""}
                {delta.dayDelta.toFixed(1)}h)
              </span>
            </div>
          );
        }

        return (
          <div
            key={delta.personId}
            className="rounded-lg border border-bordercl-subtle bg-surface-alt p-2"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-foreground-secondary">
                {delta.personName}
              </span>
              <span
                className={`text-xs font-bold ${isIncrease ? "text-red-600" : "text-green-600"}`}
              >
                {isIncrease ? "+" : ""}
                {delta.dayDelta.toFixed(1)}h
              </span>
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-foreground-faint w-10">Now</span>
                <div className="flex-1 bg-surface-inset dark:bg-surface-hover rounded-full h-2">
                  <div
                    className="bg-blue-400 rounded-full h-2 transition-all"
                    style={{ width: `${Math.min(100, currentPct)}%` }}
                  />
                </div>
                <span className="text-[10px] text-foreground-muted w-8 text-right">
                  {currentOnDay.toFixed(1)}h
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-foreground-faint w-10">After</span>
                <div className="flex-1 bg-surface-inset dark:bg-surface-hover rounded-full h-2">
                  <div
                    className={`rounded-full h-2 transition-all ${isIncrease ? "bg-red-400" : "bg-green-400"}`}
                    style={{ width: `${Math.min(100, proposedPct)}%` }}
                  />
                </div>
                <span className="text-[10px] text-foreground-muted w-8 text-right">
                  {proposedOnDay.toFixed(1)}h
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default MetricDeltaPreview;
