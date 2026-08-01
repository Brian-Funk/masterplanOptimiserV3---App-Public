/**
 * TypeScript types for Optimisation feature
 */

/** Persistent lifecycle state for a background optimisation job. */
export type OptimizationStatus =
  | "pending"
  | "running"
  | "completed"
  | "infeasible"
  | "undetermined"
  | "failed";

/** A labelled fact supporting a feasibility issue. */
export interface DiagnosticFact {
  label: string;
  value: string;
}

/** One concrete scheduling requirement that could not be satisfied. */
export interface FeasibilityIssue {
  code: string;
  category: string;
  severity: "error" | "warning";
  message: string;
  task_ids: number[];
  person_ids: number[];
  transfer_ids: number[];
  location_ids: number[];
  capability_ids: string[];
  time_window?: { start: number; end: number };
  facts: DiagnosticFact[];
  suggestions: string[];
}

/** Versioned diagnostic result shared by flow checks and optimisation. */
export interface FeasibilityDiagnostics {
  schema_version: 1;
  status: "feasible" | "infeasible" | "invalid_input" | "undetermined";
  checked_scope: "full" | "fixed_tasks" | string;
  summary: string;
  issues: FeasibilityIssue[];
}

export interface ProgressSnapshot {
  solution_count: number;
  objective_value: number;
  best_bound: number;
  wall_time: number;
  num_conflicts: number;
  num_branches: number;
}

export interface ProgressData {
  snapshots: ProgressSnapshot[];
  is_running: boolean;
  max_time_seconds: number;
  solver_status?: string; // OPTIMAL, FEASIBLE, INFEASIBLE, UNKNOWN
  diagnostics?: FeasibilityDiagnostics;
}

export interface OptimizationJob {
  id: number;
  event_id: number;
  date: string;
  status: OptimizationStatus;
  is_test_run: boolean;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  elapsed_seconds?: number;
  result_data?: {
    status: string;
    assignments: Array<{
      person_id: number;
      task_id: number;
      start_time: number;
      end_time: number;
      location_id: number;
      fatigue_contributed: number;
    }>;
    transfer_assignments?: { [transferId: string]: number[] };
    task_details?: {
      [taskId: string]: {
        start_time: string;
        end_time: string;
        location_id?: number;
        start_location_id?: number;
        end_location_id?: number;
        original_id?: number;
      };
    };
    fatigue_stats: Record<string, any>;
    field_assignments?: Record<string, Record<string, number[]>>;
    solve_time: number;
    errors: string[];
    normalization_errors?: string[];
    diagnostics?: FeasibilityDiagnostics;
  };
  error_message?: string;
  progress_data?: ProgressData;
}

export interface JobSummary {
  id: number;
  date: string;
  status: OptimizationStatus;
  is_test_run: boolean;
  created_at: string;
  completed_at?: string;
}

export interface JobListResponse {
  jobs: JobSummary[];
  running_job?: JobSummary;
}

export interface OptimizeStartResponse {
  job_id: number;
  status: string;
  message: string;
}

export interface OptimizeRequest {
  event_id: number;
  date: string;
  working_day_boundary_offset_hour?: number;
  test_mode: boolean;
  tasks: any[];
  persons: any[];
  locations: any[];
  capabilities: any[];
  fatigue_scores?: Record<number, number>;
}
