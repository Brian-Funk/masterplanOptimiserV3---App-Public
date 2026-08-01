"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { optimizationApi } from "@/lib/optimizationApi";
import { useTaskInstances } from "@/contexts/TaskInstanceContext";
import { useToast } from "@/contexts/ToastContext";
import type { ProgressData } from "@/types/optimization";
import SolverProgressModal from "@/components/SolverProgressModal";

/** Current optimisation job lifecycle state. */
export interface OptimizationState {
  runningJobId: number | null;
  runningDate: string | null;
  runningEventId: number | null;
  isOptimizing: boolean;
}

/** Context value for optimisation progress and job controls. */
export interface OptimizationContextType {
  optimizationState: OptimizationState;
  startOptimization: (eventId: number, date: string, jobId: number) => void;
  stopOptimization: () => void;
  progressData: ProgressData | null;
  elapsedSeconds: number | undefined;
  showProgressModal: boolean;
  setShowProgressModal: (show: boolean) => void;
}

const OptimizationContext = createContext<OptimizationContextType | undefined>(
  undefined,
);

/**
 * Sync optimisation results to the server via the TaskInstance API.
 *
 * IMPORTANT: This function updates BOTH task.optimised AND task.final fields.
 * - task.optimised = Optimiser's original output (preserved, never changes)
 * - task.final = Current schedule state (initially same as optimised)
 *
 * When user makes manual adjustments:
 * - Only task.final is updated (preserves task.optimised)
 * - User can "Reset to optimised" to copy optimised → final
 */

/** Track running optimisation jobs and sync completed results into task instances. */
export function OptimizationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { instances, bulkSetOptimised } = useTaskInstances();
  const { addToast } = useToast();
  const instancesRef = useRef(instances);
  const bulkSetOptimisedRef = useRef(bulkSetOptimised);
  instancesRef.current = instances;
  bulkSetOptimisedRef.current = bulkSetOptimised;
  const hasProcessedRef = useRef<number | null>(null);
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number | undefined>(
    undefined,
  );
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [optimizationState, setOptimizationState] = useState<OptimizationState>(
    {
      runningJobId: null,
      runningDate: null,
      runningEventId: null,
      isOptimizing: false,
    },
  );

  // Poll for status updates when optimisation is running
  useEffect(() => {
    if (!optimizationState.isOptimizing || !optimizationState.runningJobId) {
      return;
    }

    const pollStatus = async () => {
      try {
        const status = await optimizationApi.getJobStatus(
          optimizationState.runningJobId!,
          optimizationState.runningEventId!,
        );

        // Update progress data from backend on every poll
        if (status.progress_data) {
          const snapCount = status.progress_data.snapshots?.length ?? 0;
          if (snapCount > 0) {
            console.log(
              `[OptimizationContext] Progress: ${snapCount} snapshots, is_running=${status.progress_data.is_running}`,
            );
          }
          setProgressData(status.progress_data);
        }
        if (status.elapsed_seconds !== undefined) {
          setElapsedSeconds(status.elapsed_seconds);
        }

        // If job completed successfully, sync results to server via API
        if (status.status === "completed") {
          // Guard against double-processing when deps cause re-fire
          if (hasProcessedRef.current === optimizationState.runningJobId) {
            // Already processed - just make sure we stop the spinner
            setOptimizationState({
              runningJobId: null,
              runningDate: null,
              runningEventId: null,
              isOptimizing: false,
            });
            return;
          }
          hasProcessedRef.current = optimizationState.runningJobId;

          // Final progress update: use stored progress_data (has solver_status)
          if (status.progress_data) {
            setProgressData(status.progress_data);
          }
          if (status.elapsed_seconds !== undefined) {
            setElapsedSeconds(status.elapsed_seconds);
          }

          console.log(
            `[OptimizationContext] Optimisation completed (${status.result_data?.status ?? "unknown"}), syncing results via API`,
          );

          if (status.result_data) {
            const eventId = optimizationState.runningEventId!;
            const date = optimizationState.runningDate!;
            const resultData = status.result_data;

            try {
              // Log normalisation warnings/errors if the optimiser returned any
              const normErrors: string[] =
                resultData.normalization_errors || resultData.errors || [];
              if (normErrors.length > 0) {
                console.warn(
                  "[OptimizationContext] Normalisation warnings:",
                  normErrors,
                );
              }

              // Group assignments by task_id
              const assignmentsByTask: Record<number, any[]> = {};
              for (const assignment of resultData.assignments || []) {
                const taskId = assignment.task_id;
                if (!assignmentsByTask[taskId]) assignmentsByTask[taskId] = [];
                assignmentsByTask[taskId].push(assignment);
              }
              const assignedInstanceIds = new Set<number>();
              const taskDetails = resultData.task_details || {};
              for (const rawTaskId of Object.keys(assignmentsByTask)) {
                const taskId = Number(rawTaskId);
                if (Number.isFinite(taskId)) {
                  assignedInstanceIds.add(taskId);
                }
                const originalId = Number(taskDetails[rawTaskId]?.original_id);
                if (Number.isFinite(originalId)) {
                  assignedInstanceIds.add(originalId);
                }
              }
              const toClockMinutes = (value: unknown): unknown => {
                if (typeof value !== "number" || !Number.isFinite(value)) {
                  return value;
                }
                return ((value % 1440) + 1440) % 1440;
              };

              // Build bulk-optimised items for matching tasks
              const matchingInstances = instancesRef.current.filter(
                (i) =>
                  i.event_id === eventId &&
                  (i.date === date || assignedInstanceIds.has(Math.floor(i.id))),
              );
              const bulkItems: {
                id: number;
                optimised: Record<string, any>;
                final?: Record<string, any>;
              }[] = [];

              const skippedTasks: string[] = [];
              for (const inst of matchingInstances) {
                const taskAssignments =
                  assignmentsByTask[inst.id] ||
                  assignmentsByTask[Math.floor(inst.id)];
                if (!taskAssignments || taskAssignments.length === 0) {
                  skippedTasks.push(
                    `${inst.name || inst.id} (id=${inst.id}${inst.is_floating ? ", floating" : ""})`,
                  );
                  continue;
                }

                const first = taskAssignments[0];
                const optimisedResult: Record<string, any> = {
                  start_time: toClockMinutes(first.start_time),
                  end_time: toClockMinutes(first.end_time),
                  location: first.location_id,
                  assigned_persons: taskAssignments.map(
                    (a: any) => a.person_id,
                  ),
                };

                // Include per-field person assignments if available
                const allFieldAssignments = resultData.field_assignments || {};
                const taskFieldMap =
                  allFieldAssignments[String(inst.id)] ||
                  allFieldAssignments[inst.id];
                if (taskFieldMap && Object.keys(taskFieldMap).length > 0) {
                  optimisedResult.field_assignments = taskFieldMap;
                }

                bulkItems.push({
                  id: inst.id,
                  optimised: optimisedResult,
                  final: { ...optimisedResult },
                });
              }

              if (bulkItems.length > 0) {
                await bulkSetOptimisedRef.current(bulkItems);
                console.log(
                  `[OptimizationContext] Synced ${bulkItems.length} tasks via API`,
                );
              }

              if (skippedTasks.length > 0) {
                console.warn(
                  `[OptimizationContext] ${skippedTasks.length} tasks had no assignments:`,
                  skippedTasks,
                );
              }

              let toastMsg = `Optimisation completed - ${bulkItems.length} tasks updated`;
              if (skippedTasks.length > 0) {
                toastMsg += ` (${skippedTasks.length} tasks had no assignments)`;
              }
              if (normErrors.length > 0) {
                toastMsg += `  -  ${normErrors.length} warning(s)`;
              }
              addToast(
                toastMsg,
                skippedTasks.length > 0 || normErrors.length > 0
                  ? "warning"
                  : "success",
              );
            } catch (syncError) {
              console.error(
                "[OptimizationContext] Error syncing results:",
                syncError,
              );
              addToast(
                "Optimisation completed but failed to sync results",
                "error",
              );
            }
          } else {
            console.warn(
              "[OptimizationContext] Job completed but result_data is missing",
            );
            addToast("Optimisation completed", "success");
          }

          setOptimizationState({
            runningJobId: null,
            runningDate: null,
            runningEventId: null,
            isOptimizing: false,
          });
        }

        // Infeasibility is a valid solver conclusion, not an operational
        // failure. Keep its diagnostics available and stop polling cleanly.
        if (
          status.status === "infeasible" ||
          status.status === "undetermined"
        ) {
          if (hasProcessedRef.current === optimizationState.runningJobId) {
            return;
          }
          hasProcessedRef.current = optimizationState.runningJobId;
          if (status.progress_data) {
            setProgressData(status.progress_data);
          }
          const summary = status.result_data?.diagnostics?.summary;
          addToast(
            summary ||
              (status.status === "infeasible"
                ? "No feasible schedule was found. Review the listed requirements."
                : "The solver could not determine whether a schedule exists."),
            status.status === "infeasible" ? "error" : "warning",
          );
          setOptimizationState({
            runningJobId: null,
            runningDate: null,
            runningEventId: null,
            isOptimizing: false,
          });
        }

        // If job failed, stop tracking
        if (status.status === "failed") {
          console.error(
            "[OptimizationContext] Optimisation failed:",
            status.error_message,
          );
          addToast(
            "Optimisation failed: " + (status.error_message || "Unknown error"),
            "error",
          );
          setOptimizationState({
            runningJobId: null,
            runningDate: null,
            runningEventId: null,
            isOptimizing: false,
          });
        }
      } catch (error) {
        console.error("Error polling optimisation status:", error);
      }
    };

    // Poll every 2 seconds
    pollStatus();
    const interval = setInterval(pollStatus, 2000);

    return () => clearInterval(interval);
  }, [optimizationState.isOptimizing, optimizationState.runningJobId]);

  const startOptimization = (eventId: number, date: string, jobId: number) => {
    setProgressData(null);
    setElapsedSeconds(undefined);
    setOptimizationState({
      runningJobId: jobId,
      runningDate: date,
      runningEventId: eventId,
      isOptimizing: true,
    });
  };

  const stopOptimization = () => {
    setProgressData(null);
    setElapsedSeconds(undefined);
    setShowProgressModal(false);
    setOptimizationState({
      runningJobId: null,
      runningDate: null,
      runningEventId: null,
      isOptimizing: false,
    });
  };

  return (
    <OptimizationContext.Provider
      value={{
        optimizationState,
        startOptimization,
        stopOptimization,
        progressData,
        elapsedSeconds,
        showProgressModal,
        setShowProgressModal,
      }}
    >
      {children}
      <SolverProgressModal
        open={showProgressModal}
        onClose={() => setShowProgressModal(false)}
        progressData={progressData}
        elapsedSeconds={elapsedSeconds}
      />
    </OptimizationContext.Provider>
  );
}

/** Access optimisation progress, modal state, and job lifecycle helpers. */
export function useOptimization() {
  const context = useContext(OptimizationContext);
  if (!context) {
    throw new Error("useOptimization must be used within OptimizationProvider");
  }
  return context;
}
