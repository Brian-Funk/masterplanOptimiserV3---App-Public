"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "../../components";
import { useOptimization } from "@/contexts/OptimizationContext";
import {
  confidenceClasses,
  getFlowCheckConfidence,
} from "@/lib/confidence";
import { FeasibilityIssuesPanel } from "@/components/FeasibilityIssuesPanel";
import type { FeasibilityDiagnostics } from "@/types/optimization";

type FlowCheckStatus = "checking" | "valid" | "invalid" | null;

interface DayInfo {
  dayNumber: number;
  alias: string | null;
  formattedDate: string;
}

interface CMIHeaderProps {
  selectedDate: string;
  selectedEvent: {
    id: number;
    start_date: string;
    end_date: string;
  };
  flowCheckStatus: FlowCheckStatus;
  flowCheckErrors: string[];
  flowCheckDiagnostics: FeasibilityDiagnostics | null;
  infeasibleTasks: Array<{ id: number; name: string }>;
  getDayInfo: (date: string) => DayInfo | null;
  onRefresh: () => void;
  onOptimise: () => void;
  onOptimiseAllDays: () => void;
  allDaysRunning: boolean;
  onPreviousDay: () => void;
  onNextDay: () => void;
  onInfeasibleTaskClick?: (taskId: number) => void;
}

export function CMIHeader({
  selectedDate,
  selectedEvent,
  flowCheckStatus,
  flowCheckErrors,
  flowCheckDiagnostics,
  infeasibleTasks,
  getDayInfo,
  onRefresh,
  onOptimise,
  onOptimiseAllDays,
  allDaysRunning,
  onPreviousDay,
  onNextDay,
  onInfeasibleTaskClick,
}: CMIHeaderProps) {
  const { optimizationState, progressData, setShowProgressModal } =
    useOptimization();
  const [showBottlenecks, setShowBottlenecks] = useState(false);
  const [shiftPressed, setShiftPressed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") setShiftPressed(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") setShiftPressed(false);
    };
    const handleBlur = () => setShiftPressed(false);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    if (flowCheckStatus === "invalid") setShowBottlenecks(true);
  }, [flowCheckStatus, flowCheckDiagnostics]);

  // Track the last settled (non-checking) status so we can show it faded during recheck
  const lastSettledStatusRef = useRef<"valid" | "invalid" | null>(null);
  if (flowCheckStatus === "valid" || flowCheckStatus === "invalid") {
    lastSettledStatusRef.current = flowCheckStatus;
  }
  const isRechecking = flowCheckStatus === "checking";
  const staleStatus = isRechecking ? lastSettledStatusRef.current : null;

  // Check if current date is being optimized
  const isOptimizingCurrentDate =
    optimizationState.isOptimizing &&
    optimizationState.runningDate === selectedDate &&
    optimizationState.runningEventId === selectedEvent.id;
  const flowConfidence = getFlowCheckConfidence(flowCheckStatus);

  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">
          Constraint Model Inputs
        </h3>

        <div className="flex items-center gap-2">
          {/* Optimization status indicator */}
          {isOptimizingCurrentDate && (
            <div
              className={`relative group cursor-pointer flex items-center gap-2 rounded-md px-3 py-1.5 ${confidenceClasses(
                "review",
                "badge",
              )}`}
              onClick={() => setShowProgressModal(true)}
            >
              <svg
                className="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <span className="text-sm font-medium">
                Optimising
                {progressData?.snapshots?.length
                  ? ` (${progressData.snapshots.length} solution${progressData.snapshots.length !== 1 ? "s" : ""})`
                  : "..."}
              </span>
              {/* Hover tooltip */}
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 hidden group-hover:block z-10 pointer-events-none">
                <div className="bg-gray-900 text-white text-xs rounded px-3 py-2 whitespace-nowrap shadow-lg">
                  Click or press Ctrl+M for details
                </div>
              </div>
            </div>
          )}

          {/* Flow status indicator */}
          <div className="flex items-center gap-2">
            {flowCheckStatus === "checking" && !staleStatus && (
              <div
                className={`flex items-center gap-1 ${confidenceClasses(
                  flowConfidence.level,
                  "text",
                )}`}
                title={flowConfidence.description}
              >
                <svg
                  className="animate-spin h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                <span className="text-xs">Checking...</span>
              </div>
            )}
            {/* Rechecking: show previous result faded + small spinner */}
            {isRechecking && staleStatus === "valid" && (
              <Tooltip content="Rechecking...">
                <div
                  className={`flex items-center gap-1 opacity-40 ${confidenceClasses(
                    "ready",
                    "text",
                  )}`}
                >
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <svg
                    className="animate-spin h-3 w-3 text-blue-500"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                </div>
              </Tooltip>
            )}
            {isRechecking && staleStatus === "invalid" && (
              <Tooltip content="Rechecking...">
                <div
                  className={`flex items-center gap-1 opacity-40 ${confidenceClasses(
                    "blocked",
                    "text",
                  )}`}
                >
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <svg
                    className="animate-spin h-3 w-3 text-blue-500"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                </div>
              </Tooltip>
            )}
            {flowCheckStatus === "valid" && (
              <Tooltip content="The current tasks are satisfiable">
                <div
                  className={`flex items-center gap-1 ${confidenceClasses(
                    flowConfidence.level,
                    "text",
                  )}`}
                >
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
              </Tooltip>
            )}
            {flowCheckStatus === "invalid" && (
              <Tooltip
                content={`${infeasibleTasks.length} unsatisfiable task${infeasibleTasks.length !== 1 ? "s" : ""}  -  click for details`}
              >
                <button
                  onClick={() => setShowBottlenecks((v) => !v)}
                  className={`flex cursor-pointer items-center gap-1 transition-colors ${confidenceClasses(
                    flowConfidence.level,
                    "text",
                  )}`}
                >
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <span className="text-xs font-medium">
                    {infeasibleTasks.length}
                  </span>
                </button>
              </Tooltip>
            )}
          </div>

          {/* Refresh button */}
          <Tooltip content="Refresh tasks" side="bottom">
            <button
              onClick={onRefresh}
              className="px-2 py-1 text-xs font-medium text-foreground-secondary bg-surface-inset rounded hover:bg-surface-inset dark:bg-surface-hover transition-colors"
            >
              ↻
            </button>
          </Tooltip>

          {/* Hold Shift to change the same control from one day to all days. */}
          <Tooltip
            content={
              optimizationState.isOptimizing || allDaysRunning
                ? "Another optimisation is already running"
                : shiftPressed
                  ? "Check and optimise each event day in order"
                  : flowCheckStatus !== "valid"
                    ? "Fix flow check errors before optimising this day. Hold Shift to optimise all days."
                    : "Run optimisation for this day. Hold Shift to optimise all days."
            }
            side="bottom"
          >
            <button
              type="button"
              onClick={(event) => {
                if (event.shiftKey || shiftPressed) {
                  onOptimiseAllDays();
                } else {
                  onOptimise();
                }
              }}
              disabled={
                optimizationState.isOptimizing ||
                allDaysRunning ||
                (!shiftPressed && flowCheckStatus !== "valid")
              }
              className={`flex w-40 items-center justify-center gap-1 rounded px-3 py-1 text-xs font-medium text-white transition-colors disabled:bg-surface-inset disabled:cursor-not-allowed ${
                shiftPressed
                  ? "bg-indigo-700 hover:bg-indigo-800"
                  : "bg-purple-600 hover:bg-purple-700"
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              {shiftPressed ? "Optimise all days" : "Optimise day"}
            </button>
          </Tooltip>

          {/* Date navigation */}
          {(() => {
            const dayInfo = getDayInfo(selectedDate);
            const displayText = dayInfo?.alias
              ? `${dayInfo.alias} (Day ${dayInfo.dayNumber}) - ${dayInfo.formattedDate}`
              : dayInfo?.formattedDate || selectedDate;

            return (
              <div className="flex items-center gap-1">
                <button
                  onClick={onPreviousDay}
                  disabled={selectedDate <= selectedEvent.start_date}
                  className="px-2 py-1 text-xs font-medium text-foreground-secondary bg-surface-inset rounded hover:bg-surface-inset dark:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  ←
                </button>
                <span className="px-2 py-1 text-xs font-medium text-foreground bg-surface-alt rounded border border-bordercl">
                  {displayText}
                </span>
                <button
                  onClick={onNextDay}
                  disabled={selectedDate >= selectedEvent.end_date}
                  className="px-2 py-1 text-xs font-medium text-foreground-secondary bg-surface-inset rounded hover:bg-surface-inset dark:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  →
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Bottleneck details panel */}
      {flowCheckStatus === "invalid" &&
        showBottlenecks &&
        flowCheckErrors.length > 0 && (
          <div
            className={`mt-2 rounded-lg border p-3 ${confidenceClasses(
              "blocked",
              "panel",
            )}`}
          >
            <div className="flex items-center justify-between mb-2">
              <h4
                className={`text-sm font-semibold ${confidenceClasses(
                  "blocked",
                  "text",
                )}`}
              >
                Bottlenecks ({flowCheckErrors.length})
              </h4>
              <button
                onClick={() => setShowBottlenecks(false)}
                className="text-red-400 hover:text-red-600 dark:hover:text-red-300 text-xs"
              >
                ✕
              </button>
            </div>
            {flowCheckDiagnostics?.issues.length ? (
              <FeasibilityIssuesPanel diagnostics={flowCheckDiagnostics} />
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {flowCheckErrors.map((error, idx) => {
                // Find the matching task for click-to-scroll
                const matchingTask = infeasibleTasks.find((t) =>
                  error.toLowerCase().includes(t.name.toLowerCase()),
                );
                return (
                  <div
                    key={idx}
                    className={`text-xs text-red-700 dark:text-red-300 py-1 px-2 rounded bg-red-100/50 dark:bg-red-900/20 ${
                      matchingTask
                        ? "cursor-pointer hover:bg-red-200/60 dark:hover:bg-red-900/40"
                        : ""
                    }`}
                    onClick={() =>
                      matchingTask && onInfeasibleTaskClick?.(matchingTask.id)
                    }
                  >
                    {error}
                  </div>
                );
                })}
              </div>
            )}
          </div>
        )}
    </>
  );
}
