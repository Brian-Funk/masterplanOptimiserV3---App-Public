/**
 * Curated public TypeScript documentation entrypoint.
 *
 * Keep this file focused on reusable app APIs: shared components, contexts,
 * hooks, API clients, utilities, metrics, and public types. Avoid exporting
 * route pages or tab-local implementation glue.
 */

export * from "./components/ui";
export { default as Calendar } from "./components/Calendar";
export type { CalendarProps, CalendarTask, CalendarViewType } from "./components/Calendar";
export { CopiedTaskDateRepairModal } from "./components/data/CopiedTaskDateRepairModal";
export type { CopiedTaskDateRepairModalProps } from "./components/data/CopiedTaskDateRepairModal";

export { EventProvider, useEvent } from "./contexts/EventContext";
export type { EventContextType, SelectedEvent } from "./contexts/EventContext";
export { OptimizationProvider, useOptimization } from "./contexts/OptimizationContext";
export type {
  OptimizationContextType,
  OptimizationState,
} from "./contexts/OptimizationContext";
export { ShortcutProvider, useShortcuts } from "./contexts/ShortcutContext";
export type { ShortcutContextValue } from "./contexts/ShortcutContext";
export { TaskInstanceProvider, useTaskInstances } from "./contexts/TaskInstanceContext";
export type { TaskInstanceContextValue } from "./contexts/TaskInstanceContext";
export { ThemeProvider, useTheme } from "./contexts/ThemeContext";
export type {
  DarkModePreference,
  Theme,
  ThemeContextType,
} from "./contexts/ThemeContext";
export { ToastProvider, useToast } from "./contexts/ToastContext";
export type {
  Toast,
  ToastContextType,
  ToastVariant,
} from "./contexts/ToastContext";

export * from "./lib/api";
export { optimizationApi } from "./lib/optimizationApi";
export { BRAND } from "./lib/brand";
export * from "./lib/calendarTaskUtils";
export * from "./lib/dateFormat";
export * from "./lib/environment";
export * from "./lib/gcalColors";
export * from "./lib/shortcuts";

export type {
  BarChartVisualization,
  Capability as MetricCapability,
  DashboardConfig,
  GaugeVisualization,
  HeatmapVisualization,
  HistogramVisualization,
  IMetric,
  LineChartVisualization,
  MetricBoxConfig,
  MetricConfig,
  MetricFilters,
  MetricResult,
  MetricSettings,
  NumberVisualization,
  Person as MetricPerson,
  PieChartVisualization,
  RadarVisualization,
  ScatterVisualization,
  ScheduleData,
  ScheduleSnapshot,
  StackedBarVisualization,
  TaskInstance as MetricTaskInstance,
  TaskTypeInfo,
  TimelineVisualization,
  VisualizationData,
  VisualizationType,
} from "./lib/metrics/MetricInterface";
export { MetricRegistry } from "./lib/metrics/MetricRegistry";
export {
  computeAssignmentDelta,
  computeEditDelta,
  computeHoursPerDay,
} from "./lib/metrics/MetricDeltaCalculator";
export type { PersonDelta } from "./lib/metrics/MetricDeltaCalculator";

export type * from "./types/masterplan";
export type * from "./types/optimization";
