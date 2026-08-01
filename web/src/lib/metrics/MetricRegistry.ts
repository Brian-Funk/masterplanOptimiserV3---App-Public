import { IMetric } from "./MetricInterface";
import {
  AverageWorkingHoursMetric,
  AbsoluteWorkingHoursMetric,
  MaxWorkingHoursMetric,
} from "./implementations/TotalHoursMetric";
import { WorkloadSpiderMetric } from "./implementations/WorkloadSpiderMetric";
import { FairnessMetric } from "./implementations/FairnessMetric";
import {
  TaskTypeCountSpiderMetric,
  TaskTypeHoursSpiderMetric,
} from "./implementations/TaskTypeSpiderMetric";
import { FatigueTimelineMetric } from "./implementations/FatigueTimelineMetric";
import { MaxWorkStreakMetric } from "./implementations/MaxWorkStreakMetric";
import { CFIIMetric } from "./implementations/CFIIMetric";
import {
  MinimumSleepingHoursMetric,
  SleepingHoursMetric,
} from "./implementations/SleepHoursMetric";

/**
 * Singleton registry for all available metrics
 */
class MetricRegistry {
  private static instance: MetricRegistry;
  private metrics: Map<string, IMetric> = new Map();

  private constructor() {
    this.registerDefaultMetrics();
  }

  /** Return the singleton metric registry instance. */
  static getInstance(): MetricRegistry {
    if (!MetricRegistry.instance) {
      MetricRegistry.instance = new MetricRegistry();
    }
    return MetricRegistry.instance;
  }

  /**
   * Register default metrics
   */
  private registerDefaultMetrics(): void {
    this.register(new AverageWorkingHoursMetric());
    this.register(new AbsoluteWorkingHoursMetric());
    this.register(new MaxWorkingHoursMetric());
    this.register(new MinimumSleepingHoursMetric());
    this.register(new SleepingHoursMetric());
    this.register(new WorkloadSpiderMetric());
    this.register(new FairnessMetric());
    this.register(new TaskTypeCountSpiderMetric());
    this.register(new TaskTypeHoursSpiderMetric());
    this.register(new FatigueTimelineMetric());
    this.register(new MaxWorkStreakMetric());
    this.register(new CFIIMetric());
  }

  /**
   * Register a metric
   */
  register(metric: IMetric): void {
    if (this.metrics.has(metric.config.id)) {
      console.warn(
        `Metric with id ${metric.config.id} is already registered. Overwriting.`,
      );
    }
    this.metrics.set(metric.config.id, metric);
  }

  /**
   * Unregister a metric
   */
  unregister(metricId: string): void {
    this.metrics.delete(metricId);
  }

  /**
   * Get a metric by id
   */
  get(metricId: string): IMetric | undefined {
    return this.metrics.get(metricId);
  }

  /**
   * Get a metric by id (alias for backwards compatibility)
   */
  getMetric(metricId: string): IMetric | undefined {
    return this.get(metricId);
  }

  /**
   * Get all registered metrics
   */
  getAll(): IMetric[] {
    return Array.from(this.metrics.values());
  }

  /**
   * List all metric IDs
   */
  listMetrics(): string[] {
    return Array.from(this.metrics.keys());
  }

  /**
   * Get metrics by category
   */
  getByCategory(category: string): IMetric[] {
    return Array.from(this.metrics.values()).filter(
      (metric) => metric.config.category === category,
    );
  }

  /**
   * Check if a metric is registered
   */
  has(metricId: string): boolean {
    return this.metrics.has(metricId);
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
  }
}

export { MetricRegistry };
export default MetricRegistry;
