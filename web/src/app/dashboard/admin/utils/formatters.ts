/**
 * Data formatting utility functions for admin dashboard
 */
import {
  formatDateShort,
  formatDateTime as formatSwissDateTime,
} from "@/lib/dateFormat";

/**
 * Format a date string to a readable format
 * @param dateStr - ISO date string
 * @returns Formatted date string
 */
export const formatDate = (dateStr: string): string => {
  return formatDateShort(dateStr);
};

/**
 * Format a datetime string to a readable format
 * @param dateTimeStr - ISO datetime string
 * @returns Formatted datetime string
 */
export const formatDateTime = (dateTimeStr: string): string => {
  return formatSwissDateTime(dateTimeStr);
};
