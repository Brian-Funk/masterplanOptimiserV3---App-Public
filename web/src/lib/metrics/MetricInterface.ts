// Core types for the metric system

export type VisualizationType =
  | "number"
  | "bar_chart"
  | "line_chart"
  | "heatmap"
  | "radar"
  | "pie_chart"
  | "gauge"
  | "histogram"
  | "scatter"
  | "stacked_bar"
  | "timeline";

export interface MetricConfig {
  id: string;
  name: string;
  description: string;
  category:
    | "workload"
    | "fatigue"
    | "flow"
    | "distribution"
    | "utilization"
    | "custom";
  visualization: VisualizationType;
  supportsPersonFilter: boolean;
  supportsCapabilityFilter: boolean;
  /**
   * When true the metric already uses time/days as an axis (e.g. line charts
   * with one point per day).  The "Event / Day" aggregation toggle is hidden
   * for these metrics because filtering to a single day would collapse the axis.
   */
  hasTimeAxis?: boolean;
}

// ---------- Schedule data ----------

export interface ScheduleData {
  tasks: TaskInstance[];
  people: Person[];
  capabilities: Capability[];
  taskTypes: TaskTypeInfo[];
  /** Map of ISO date "YYYY-MM-DD" → display alias, e.g. "Setup Day" */
  dayAliases: Record<string, string>;
  /** Sorted array of all event dates "YYYY-MM-DD" from start_date to end_date */
  eventDates?: string[];
}

/** @deprecated Use ScheduleData instead - kept for backward compat */
export type ScheduleSnapshot = ScheduleData;

export interface TaskInstance {
  id: string;
  person_ids: number[]; // all assigned person IDs
  /**
   * People whose role on this assignment consumes working time. When absent,
   * metrics retain the historical all-assigned-people behaviour.
   */
  working_person_ids?: number[];
  task_id: number;
  task_type_id: number; // links to taskTypes
  capability_ids: number[]; // actual capability IDs required
  date: string; // "YYYY-MM-DD"
  start_time: string; // ISO datetime "YYYY-MM-DDTHH:MM:SS"
  end_time: string; // ISO datetime "YYYY-MM-DDTHH:MM:SS"
  name: string;
  schedule_source?: "final" | "optimised" | "raw";
  person_assignment_sources?: Record<number, string[]>;
  /** Whether this assignment contributes to working-time limits and metrics. */
  counts_towards_work_time?: boolean;
}

export interface Person {
  id: number;
  name: string;
  first_name: string;
  last_name: string;
  email: string | null;
  max_hours_per_day?: number | null;
  capabilities: string[]; // machine_names e.g. ["is_orga", "can_drive"]
}

export interface Capability {
  id: number;
  name: string;
  machine_name: string;
  color: string;
}

export interface TaskTypeInfo {
  id: number;
  name: string;
  color: string;
  fatigue_score: number;
  /** Whether tasks of this type contribute to working-time totals. */
  counts_towards_work_time?: boolean;
}

export interface MetricResult {
  value: number;
  label?: string;
  data?: VisualizationData;
}

// Visualization-specific data types
export type VisualizationData =
  | NumberVisualization
  | BarChartVisualization
  | LineChartVisualization
  | HeatmapVisualization
  | RadarVisualization
  | PieChartVisualization
  | GaugeVisualization
  | HistogramVisualization
  | ScatterVisualization
  | StackedBarVisualization
  | TimelineVisualization;

export interface NumberVisualization {
  type: "number";
  value: number;
  unit?: string;
  format?: "integer" | "decimal" | "percentage" | "duration";
}

export interface BarChartVisualization {
  type: "bar_chart";
  bars: Array<{
    label: string;
    value: number;
    color?: string;
    personId?: number;
    capabilityId?: number;
  }>;
  xAxisLabel?: string;
  yAxisLabel?: string;
}

export interface LineChartVisualization {
  type: "line_chart";
  lines: Array<{
    label: string;
    points: Array<{ x: number | string; y: number }>;
    /** X-values that are not measurable and must render as chart gaps. */
    missingPoints?: Array<number | string>;
    color?: string;
    style?: "solid" | "dashed";
  }>;
  xOrder?: string[];
  xLabels?: Record<string, string>;
  xAxisLabel?: string;
  yAxisLabel?: string;
}

export interface HeatmapVisualization {
  type: "heatmap";
  data: Array<{
    x: string;
    y: string;
    value: number;
  }>;
  xOrder?: string[];
  xLabels?: Record<string, string>;
  colorScale?: "sequential" | "diverging";
}

export interface RadarVisualization {
  type: "radar";
  axes: string[];
  datasets: Array<{
    label: string;
    values: number[];
    color?: string;
  }>;
}

export interface PieChartVisualization {
  type: "pie_chart";
  slices: Array<{
    label: string;
    value: number;
    color?: string;
  }>;
}

export interface GaugeVisualization {
  type: "gauge";
  value: number;
  min: number;
  max: number;
  thresholds?: Array<{ value: number; color: string }>;
}

export interface HistogramVisualization {
  type: "histogram";
  bins: Array<{
    range: [number, number];
    count: number;
  }>;
  xAxisLabel?: string;
  yAxisLabel?: string;
}

export interface ScatterVisualization {
  type: "scatter";
  points: Array<{
    x: number;
    y: number;
    label?: string;
    color?: string;
    personId?: number;
  }>;
  xAxisLabel?: string;
  yAxisLabel?: string;
}

export interface StackedBarVisualization {
  type: "stacked_bar";
  bars: Array<{
    label: string;
    segments: Array<{
      value: number;
      color?: string;
      segmentLabel?: string;
    }>;
  }>;
  xAxisLabel?: string;
  yAxisLabel?: string;
}

export interface TimelineVisualization {
  type: "timeline";
  events: Array<{
    time: string;
    label: string;
    value: number;
    color?: string;
  }>;
}

// ---------- Metric interface ----------

export interface IMetric {
  config: MetricConfig;

  /** Calculate the metric for the current schedule */
  calculate(
    data: ScheduleData,
    filters?: MetricFilters,
    settings?: MetricSettings,
  ): Promise<MetricResult>;
}

export interface MetricFilters {
  personIds?: number[];
  capabilityIds?: number[];
  timeRange?: {
    start: string;
    end: string;
  };
}

// ---------- Settings & dashboard config ----------
export interface MetricSettings {
  filters?: MetricFilters;
  personIds?: number[]; // Quick access for person filters
  capabilityIds?: number[]; // Quick access for capability filters
  /** "event" = aggregate across all days (default), "day" = only the currently-viewed day */
  timeAggregation?: "event" | "day";
  colorMap?: {
    capabilities?: Record<number, string>;
    people?: Record<number, string>;
    [key: string]: string | Record<number, string> | undefined; // Allow `person-${id}` and `capability-${id}` keys
  };
  customParams?: Record<string, any>;
}

export interface DashboardConfig {
  layout: MetricBoxConfig[];
}

export interface MetricBoxConfig {
  i: string; // unique identifier (metricId)
  x: number; // grid position x
  y: number; // grid position y
  w: number; // width in grid units
  h: number; // height in grid units
  metricId: string;
  settings: MetricSettings;
}
