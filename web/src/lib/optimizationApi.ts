/**
 * API Client for Optimisation Endpoints
 */
import type {
  OptimizationJob,
  JobListResponse,
  OptimizeStartResponse,
  OptimizeRequest,
} from "@/types/optimization";

import { getApiUrl } from "@/lib/environment";

/** Client wrapper for backend optimisation job endpoints. */
export const optimizationApi = {
  /**
   * Start optimisation for a specific day
   */
  async startOptimization(
    request: OptimizeRequest,
  ): Promise<OptimizeStartResponse> {
    const response = await fetch(`${getApiUrl()}/api/v1/optimize/day`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Unknown error" }));

      // Handle validation errors (422)
      if (response.status === 422 && error.detail) {
        if (Array.isArray(error.detail)) {
          const messages = error.detail
            .map((err: any) => `${err.loc?.join(".") || "field"}: ${err.msg}`)
            .join("\n");
          throw new Error(`Validation errors:\n${messages}`);
        }
      }

      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    return response.json();
  },

  /**
   * Get status of a specific optimisation job
   */
  async getJobStatus(jobId: number, eventId: number): Promise<OptimizationJob> {
    const response = await fetch(
      `${getApiUrl()}/api/v1/optimize/jobs/${jobId}?event_id=${eventId}`,
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  },

  /**
   * Get all optimisation jobs for an event
   */
  async getJobsForEvent(eventId: number): Promise<JobListResponse> {
    const response = await fetch(
      `${getApiUrl()}/api/v1/optimize/jobs?event_id=${eventId}`,
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  },
};
