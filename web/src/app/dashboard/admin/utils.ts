/**
 * Utility functions for admin dashboard
 */
import { getApiUrl } from "@/lib/environment";

/**
 * No-op auth headers (auth removed in GC variant).
 */
export function getAuthHeaders(): Record<string, string> {
  return {};
}

// Re-export getApiUrl from the shared environment module so that
// existing imports from this file keep working.
export { getApiUrl };
