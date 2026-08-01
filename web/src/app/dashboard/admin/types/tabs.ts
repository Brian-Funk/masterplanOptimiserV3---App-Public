/**
 * Type definitions for admin dashboard tabs and sections
 */

export type MainTab =
  | "input"
  | "tasks"
  | "general-schedule"
  | "optimisation"
  | "masterplan";

export type InputSection =
  | "users"
  | "locations"
  | "task-builder"
  | "cmi"
  | "dependency-locks"
  | "groups"
  | "audience-teams"
  | "room-allocation";

export type TasksSection = "task-builder" | "cmi";

export interface TabProps {
  selectedEvent: any;
}
