/**
 * API utility functions for admin dashboard
 */

/**
 * No-op auth headers (auth removed in GC variant).
 */
export const getAuthHeaders = () => {
  return {
    "Content-Type": "application/json",
  };
};
