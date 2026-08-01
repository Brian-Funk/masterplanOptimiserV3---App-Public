/**
 * Time utility functions for admin dashboard
 */

/**
 * Convert time string (HH:MM) to minutes since midnight
 * @param timeStr - Time string in HH:MM format
 * @returns Minutes since midnight, or null if invalid
 */
export const timeToMinutes = (timeStr: string | null): number | null => {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
};

/**
 * Convert minutes since midnight to time string (HH:MM)
 * @param minutes - Minutes since midnight
 * @returns Time string in HH:MM format
 */
export const minutesToTime = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};
