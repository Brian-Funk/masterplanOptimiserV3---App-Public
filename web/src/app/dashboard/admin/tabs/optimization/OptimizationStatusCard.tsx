/**
 * Status Card Component - Shows detailed status of the current day's optimisation
 */
"use client";

import React from "react";
import type { OptimizationJob } from "@/types/optimization";
import { formatDateTime } from "@/lib/dateFormat";
import {
  confidenceClasses,
  getOptimisationConfidence,
} from "@/lib/confidence";
import { FeasibilityIssuesPanel } from "@/components/FeasibilityIssuesPanel";

interface OptimizationStatusCardProps {
  job: OptimizationJob | null;
  loading: boolean;
}

export default function OptimizationStatusCard({
  job,
  loading,
}: OptimizationStatusCardProps) {
  if (loading) {
    return (
      <div className="bg-surface rounded-lg border border-bordercl p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-surface-inset dark:bg-surface-hover rounded w-1/4 mb-4"></div>
          <div className="h-8 bg-surface-inset dark:bg-surface-hover rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (!job) {
    const confidence = getOptimisationConfidence(null);
    return (
      <div
        className={`rounded-lg border p-6 ${confidenceClasses(
          confidence.level,
          "panel",
        )}`}
      >
        <div className="text-center py-8">
          <p className="font-medium text-foreground-secondary">
            No optimisation run for this day yet
          </p>
          <p className="text-sm text-foreground-faint mt-2">
            Go to CMI tab to start optimisation
          </p>
        </div>
      </div>
    );
  }

  const solutionCount = job.progress_data?.snapshots?.length ?? 0;
  const confidence = getOptimisationConfidence(job.status);

  const getStatusIcon = () => {
    switch (job.status) {
      case "pending":
        return (
          <div className={confidenceClasses(confidence.level, "text")}>
            <svg
              className="w-8 h-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        );
      case "running":
        return (
          <div
            className={`relative group cursor-default ${confidenceClasses(
              confidence.level,
              "text",
            )}`}
          >
            <svg
              className="w-8 h-8 animate-spin"
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
            {/* Hover tooltip */}
            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10 pointer-events-none">
              <div className="bg-gray-900 text-white text-xs rounded px-3 py-2 whitespace-nowrap shadow-lg">
                {solutionCount > 0
                  ? `${solutionCount} solution${solutionCount !== 1 ? "s" : ""} found`
                  : "Solving..."}
                <span className="text-gray-400 ml-1">- Ctrl+M for details</span>
              </div>
            </div>
          </div>
        );
      case "completed":
        return (
          <div className={confidenceClasses(confidence.level, "text")}>
            <svg
              className="w-8 h-8"
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
        );
      case "infeasible":
      case "undetermined":
      case "failed":
        return (
          <div className={confidenceClasses(confidence.level, "text")}>
            <svg
              className="w-8 h-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        );
    }
  };

  const getStatusLabel = () => {
    switch (job.status) {
      case "pending":
        return "Queued";
      case "running":
        return "Running";
      case "completed":
        return "Completed";
      case "infeasible":
        return "Unsatisfiable";
      case "undetermined":
        return "Undetermined";
      case "failed":
        return "Failed";
    }
  };

  return (
    <div className="bg-surface rounded-lg border border-bordercl p-6">
      <div className="space-y-4">
        {/* Status Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {getStatusIcon()}
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-lg font-semibold text-foreground">
                  {getStatusLabel()}
                </h4>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${confidenceClasses(
                    confidence.level,
                    "badge",
                  )}`}
                  title={confidence.description}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${confidenceClasses(
                      confidence.level,
                      "dot",
                    )}`}
                  />
                  {confidence.label}
                </span>
              </div>
              {job.is_test_run && (
                <span className="text-xs text-orange-600 font-medium">
                  TEST MODE (10s)
                </span>
              )}
            </div>
          </div>

          {/* Elapsed Time */}
          {job.elapsed_seconds !== null &&
            job.elapsed_seconds !== undefined && (
              <div className="text-right">
                <p className="text-sm text-foreground-muted">Elapsed Time</p>
                <p className="text-lg font-semibold text-foreground">
                  {Math.round(job.elapsed_seconds)}s
                </p>
              </div>
            )}
        </div>

        {/* Details */}
        <div className="grid grid-cols-2 gap-4 pt-4 border-t">
          <div>
            <p className="text-sm text-foreground-muted">Started</p>
            <p className="text-sm font-medium text-foreground">
              {job.created_at ? formatDateTime(job.created_at) : "N/A"}
            </p>
          </div>
          <div>
            <p className="text-sm text-foreground-muted">Completed</p>
            <p className="text-sm font-medium text-foreground">
              {job.completed_at
                ? formatDateTime(job.completed_at)
                : "In progress..."}
            </p>
          </div>
        </div>

        {/* Results Preview (if completed) */}
        {job.status === "completed" && job.result_data && (
          <div className="pt-4 border-t space-y-3">
            <h5 className="text-sm font-semibold text-foreground">
              Optimisation Results
            </h5>

            {/* Status and Solve Time */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-surface-alt rounded p-3">
                <p className="text-xs text-foreground-muted mb-1">Status</p>
                <p className="text-sm font-semibold text-foreground">
                  {job.result_data.status || "N/A"}
                </p>
              </div>
              <div className="bg-surface-alt rounded p-3">
                <p className="text-xs text-foreground-muted mb-1">
                  Assignments
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {job.result_data.assignments?.length || 0}
                </p>
              </div>
              <div className="bg-surface-alt rounded p-3">
                <p className="text-xs text-foreground-muted mb-1">Solve Time</p>
                <p className="text-sm font-semibold text-foreground">
                  {job.result_data.solve_time?.toFixed(2) || "0"}s
                </p>
              </div>
            </div>

            {/* Fatigue Statistics */}
            {job.result_data.fatigue_stats && (
              <div className="bg-blue-50 dark:bg-blue-950/30 rounded p-3">
                <p className="text-xs font-semibold text-blue-900 mb-2">
                  Fatigue Distribution
                </p>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-blue-600">Min:</span>{" "}
                    <span className="font-medium text-blue-900">
                      {job.result_data.fatigue_stats.min?.toFixed(1) || "0"}
                    </span>
                  </div>
                  <div>
                    <span className="text-blue-600">Max:</span>{" "}
                    <span className="font-medium text-blue-900">
                      {job.result_data.fatigue_stats.max?.toFixed(1) || "0"}
                    </span>
                  </div>
                  <div>
                    <span className="text-blue-600">Range:</span>{" "}
                    <span className="font-medium text-blue-900">
                      {job.result_data.fatigue_stats.range?.toFixed(1) || "0"}
                    </span>
                  </div>
                </div>
                {job.result_data.fatigue_stats.per_person && (
                  <div className="mt-2 text-xs text-blue-700">
                    {
                      Object.keys(job.result_data.fatigue_stats.per_person)
                        .length
                    }{" "}
                    persons allocated
                  </div>
                )}
              </div>
            )}

            {/* Errors (if any) */}
            {job.result_data.errors && job.result_data.errors.length > 0 && (
              <div className="bg-yellow-50 dark:bg-yellow-950/30 rounded p-3">
                <p className="text-xs font-semibold text-yellow-900 mb-1">
                  Warnings ({job.result_data.errors.length})
                </p>
                <ul className="text-xs text-yellow-700 space-y-1">
                  {job.result_data.errors
                    .slice(0, 3)
                    .map((error: string, idx: number) => (
                      <li key={idx}>• {error}</li>
                    ))}
                  {job.result_data.errors.length > 3 && (
                    <li className="text-yellow-600 italic">
                      ...and {job.result_data.errors.length - 3} more
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* View Details Link */}
            <div className="text-center">
              <button
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                onClick={() => {
                  alert(
                    "Task assignments have been written to the database.\nView them in the Optimised tab or refresh the CMI view.",
                  );
                }}
              >
                View Full Results →
              </button>
            </div>
          </div>
        )}

        {/* Error Message (if failed) */}
        {job.status === "failed" && job.error_message && (
          <div className="pt-4 border-t">
            <h5 className="text-sm font-semibold text-red-900 mb-2">Error</h5>
            <div className="bg-red-50 dark:bg-red-950/30 rounded p-3">
              <p className="text-sm text-red-700 dark:text-red-400">
                {job.error_message}
              </p>
            </div>
          </div>
        )}

        {(job.status === "infeasible" || job.status === "undetermined") && (
          <FeasibilityIssuesPanel
            diagnostics={
              job.result_data?.diagnostics || job.progress_data?.diagnostics
            }
            className="mt-4"
          />
        )}
      </div>
    </div>
  );
}
