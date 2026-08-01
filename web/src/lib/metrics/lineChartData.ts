import { LineChartVisualization } from "./MetricInterface";

type MetricLine = LineChartVisualization["lines"][number];

/**
 * Align sparse metric points to the chart's x-axis without inventing data.
 *
 * Ordinary metrics retain the historical zero-fill behaviour. Metrics can
 * list explicitly unmeasurable x-values in `missingPoints` to render gaps.
 */
export function alignMetricLinePoints(
  line: MetricLine,
  xValues: string[],
): Array<number | null> {
  const pointMap = new Map(
    line.points.map((point) => [String(point.x), point.y]),
  );
  const missingPoints = new Set(
    (line.missingPoints || []).map((value) => String(value)),
  );

  return xValues.map((value) => {
    if (pointMap.has(value)) return pointMap.get(value) ?? null;
    if (missingPoints.has(value) || line.style === "dashed") return null;
    return 0;
  });
}
