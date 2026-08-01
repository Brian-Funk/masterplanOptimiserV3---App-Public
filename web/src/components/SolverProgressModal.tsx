/**
 * Solver Progress Modal - Shows detailed solver progress with objective chart
 * Opened via Ctrl+M while an optimisation is running
 */
"use client";

import React, { useMemo } from "react";
import { Modal } from "@/components/ui/Modal";
import type { ProgressData, ProgressSnapshot } from "@/types/optimization";
import { FeasibilityIssuesPanel } from "@/components/FeasibilityIssuesPanel";

interface SolverProgressModalProps {
  open: boolean;
  onClose: () => void;
  progressData: ProgressData | null;
  elapsedSeconds?: number;
}

/**
 * SVG line chart showing objective value convergence over time
 */
function ObjectiveChart({ snapshots }: { snapshots: ProgressSnapshot[] }) {
  const width = 520;
  const height = 200;
  const padding = { top: 16, right: 16, bottom: 32, left: 56 };

  const chartData = useMemo(() => {
    if (snapshots.length === 0) return null;

    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const times = snapshots.map((s) => s.wall_time);
    const objectives = snapshots.map((s) => s.objective_value);
    const bounds = snapshots.map((s) => s.best_bound);

    const allValues = [...objectives, ...bounds];
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const minVal = Math.min(...allValues);
    const maxVal = Math.max(...allValues);

    // Avoid division by zero
    const timeRange = maxTime - minTime || 1;
    const valRange = maxVal - minVal || 1;

    const scaleX = (t: number) =>
      padding.left + ((t - minTime) / timeRange) * plotW;
    const scaleY = (v: number) =>
      padding.top + plotH - ((v - minVal) / valRange) * plotH;

    const objectivePath = snapshots
      .map(
        (s, i) =>
          `${i === 0 ? "M" : "L"} ${scaleX(s.wall_time)} ${scaleY(s.objective_value)}`,
      )
      .join(" ");

    const boundPath = snapshots
      .map(
        (s, i) =>
          `${i === 0 ? "M" : "L"} ${scaleX(s.wall_time)} ${scaleY(s.best_bound)}`,
      )
      .join(" ");

    // Y-axis ticks (5 ticks)
    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const val = minVal + (valRange * i) / 4;
      return { val, y: scaleY(val) };
    });

    // X-axis ticks (4 ticks)
    const xTicks = Array.from({ length: 4 }, (_, i) => {
      const t = minTime + (timeRange * i) / 3;
      return { val: t, x: scaleX(t) };
    });

    return { objectivePath, boundPath, yTicks, xTicks, plotW, plotH };
  }, [snapshots]);

  if (!chartData || snapshots.length < 2) {
    return (
      <div className="flex items-center justify-center h-[200px] text-foreground-muted text-sm">
        {snapshots.length === 0
          ? "Waiting for first solution..."
          : "Waiting for more data points..."}
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      {/* Grid lines */}
      {chartData.yTicks.map((tick, i) => (
        <g key={`y-${i}`}>
          <line
            x1={padding.left}
            y1={tick.y}
            x2={padding.left + chartData.plotW}
            y2={tick.y}
            stroke="currentColor"
            className="text-bordercl"
            strokeDasharray="3,3"
            strokeWidth={0.5}
          />
          <text
            x={padding.left - 8}
            y={tick.y + 4}
            textAnchor="end"
            className="fill-foreground-muted"
            fontSize={10}
          >
            {tick.val.toFixed(1)}
          </text>
        </g>
      ))}

      {/* X-axis labels */}
      {chartData.xTicks.map((tick, i) => (
        <text
          key={`x-${i}`}
          x={tick.x}
          y={height - 4}
          textAnchor="middle"
          className="fill-foreground-muted"
          fontSize={10}
        >
          {tick.val.toFixed(1)}s
        </text>
      ))}

      {/* Best bound line (dashed) */}
      <path
        d={chartData.boundPath}
        fill="none"
        stroke="#60a5fa"
        strokeWidth={1.5}
        strokeDasharray="4,3"
      />

      {/* Objective value line (solid) */}
      <path
        d={chartData.objectivePath}
        fill="none"
        stroke="#f59e0b"
        strokeWidth={2}
      />

      {/* Latest point marker */}
      {snapshots.length > 0 &&
        (() => {
          const last = snapshots[snapshots.length - 1];
          const times = snapshots.map((s) => s.wall_time);
          const allValues = [
            ...snapshots.map((s) => s.objective_value),
            ...snapshots.map((s) => s.best_bound),
          ];
          const minTime = Math.min(...times);
          const maxTime = Math.max(...times);
          const minVal = Math.min(...allValues);
          const maxVal = Math.max(...allValues);
          const timeRange = maxTime - minTime || 1;
          const valRange = maxVal - minVal || 1;
          const plotW = width - padding.left - padding.right;
          const plotH = height - padding.top - padding.bottom;
          const cx =
            padding.left + ((last.wall_time - minTime) / timeRange) * plotW;
          const cy =
            padding.top +
            plotH -
            ((last.objective_value - minVal) / valRange) * plotH;
          return <circle cx={cx} cy={cy} r={3} fill="#f59e0b" />;
        })()}

      {/* Legend */}
      <g transform={`translate(${padding.left + 8}, ${padding.top + 8})`}>
        <line x1={0} y1={0} x2={16} y2={0} stroke="#f59e0b" strokeWidth={2} />
        <text x={20} y={4} className="fill-foreground-muted" fontSize={10}>
          Objective
        </text>
        <line
          x1={80}
          y1={0}
          x2={96}
          y2={0}
          stroke="#60a5fa"
          strokeWidth={1.5}
          strokeDasharray="4,3"
        />
        <text x={100} y={4} className="fill-foreground-muted" fontSize={10}>
          Best bound
        </text>
      </g>
    </svg>
  );
}

export default function SolverProgressModal({
  open,
  onClose,
  progressData,
  elapsedSeconds,
}: SolverProgressModalProps) {
  const snapshots = progressData?.snapshots ?? [];
  const maxTime = progressData?.max_time_seconds ?? 30;
  const isRunning = progressData?.is_running ?? false;
  const solverStatus = progressData?.solver_status ?? null;
  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  const elapsed = elapsedSeconds ?? latest?.wall_time ?? 0;
  const progressPct =
    maxTime > 0 ? Math.min(100, (elapsed / maxTime) * 100) : 0;
  const remaining = Math.max(0, maxTime - elapsed);

  // Optimality gap: |objective - bound| / |objective|
  const gap = latest
    ? latest.objective_value !== 0
      ? (Math.abs(latest.objective_value - latest.best_bound) /
          Math.abs(latest.objective_value)) *
        100
      : 0
    : null;

  // Status badge styling
  const statusLabel = solverStatus
    ? solverStatus.charAt(0) + solverStatus.slice(1).toLowerCase()
    : isRunning
      ? "Solving"
      : snapshots.length > 0
        ? "Complete"
        : "Pending";

  const statusColour =
    solverStatus === "OPTIMAL"
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      : solverStatus === "FEASIBLE"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
        : solverStatus === "INFEASIBLE"
          ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
          : isRunning
            ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
            : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";

  return (
    <Modal open={open} onClose={onClose} maxWidth="2xl">
      <div className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">
            Solver Progress
          </h3>
          <button
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground p-1"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Elapsed / timeout progress bar */}
        <div>
          <div className="flex justify-between text-xs text-foreground-muted mb-1">
            <span>{elapsed.toFixed(1)}s elapsed</span>
            <span>
              {isRunning
                ? `up to ${remaining.toFixed(0)}s remaining`
                : solverStatus
                  ? `Finished - ${statusLabel}`
                  : "Complete"}
            </span>
          </div>
          <div className="h-2 bg-surface-inset dark:bg-surface-hover rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isRunning
                  ? "bg-yellow-500"
                  : solverStatus === "OPTIMAL"
                    ? "bg-green-500"
                    : solverStatus === "FEASIBLE"
                      ? "bg-amber-500"
                      : solverStatus === "INFEASIBLE"
                        ? "bg-red-500"
                        : "bg-green-500"
              }`}
              style={{
                width: `${!isRunning && solverStatus ? 100 : progressPct}%`,
              }}
            />
          </div>
        </div>

        {/* Objective chart */}
        <div className="bg-surface-alt rounded-lg p-4 border border-bordercl">
          <h4 className="text-sm font-medium text-foreground mb-2">
            Objective Convergence
          </h4>
          <ObjectiveChart snapshots={snapshots} />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Solutions Found"
            value={latest?.solution_count?.toString() ?? "0"}
            accent={
              latest && latest.solution_count > 0
                ? solverStatus === "OPTIMAL"
                  ? "green"
                  : "amber"
                : undefined
            }
          />
          <StatCard
            label="Best Fatigue Range"
            value={latest ? latest.objective_value.toFixed(2) : "-"}
          />
          <StatCard
            label="Optimality Gap"
            value={gap !== null ? `${gap.toFixed(1)}%` : "-"}
            accent={gap !== null && gap === 0 ? "green" : undefined}
          />
          <StatCard label="Solve Time" value={`${elapsed.toFixed(1)}s`} />
        </div>

        {/* Collapsible solver details */}
        <FeasibilityIssuesPanel diagnostics={progressData?.diagnostics} />

        {/* Collapsible solver details */}
        {latest && (
          <details className="text-xs text-foreground-muted">
            <summary className="cursor-pointer hover:text-foreground select-none">
              Solver details
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 pl-4">
              <span>Conflicts:</span>
              <span className="text-foreground">
                {latest.num_conflicts.toLocaleString()}
              </span>
              <span>Branches:</span>
              <span className="text-foreground">
                {latest.num_branches.toLocaleString()}
              </span>
              <span>Best bound:</span>
              <span className="text-foreground">
                {latest.best_bound.toFixed(4)}
              </span>
              <span>Objective:</span>
              <span className="text-foreground">
                {latest.objective_value.toFixed(4)}
              </span>
            </div>
          </details>
        )}

        {/* Keyboard hint */}
        <p className="text-xs text-foreground-faint text-center">
          Press{" "}
          <kbd className="px-1.5 py-0.5 bg-surface-inset dark:bg-surface-hover rounded text-foreground-muted text-xs">
            Esc
          </kbd>{" "}
          or{" "}
          <kbd className="px-1.5 py-0.5 bg-surface-inset dark:bg-surface-hover rounded text-foreground-muted text-xs">
            Ctrl+M
          </kbd>{" "}
          to close
        </p>
      </div>
    </Modal>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "green" | "amber" | "red";
}) {
  const valueColour =
    accent === "green"
      ? "text-green-600 dark:text-green-400"
      : accent === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : accent === "red"
          ? "text-red-600 dark:text-red-400"
          : "text-foreground";

  return (
    <div className="bg-surface-alt rounded-lg p-3 border border-bordercl text-center">
      <p className="text-xs text-foreground-muted mb-1">{label}</p>
      <p className={`text-sm font-semibold ${valueColour}`}>{value}</p>
    </div>
  );
}
