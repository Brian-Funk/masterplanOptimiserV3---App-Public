"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { Line, Radar, Chart } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  RadarController,
  RadialLinearScale,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { MatrixController, MatrixElement } from "chartjs-chart-matrix";
import { GripVertical, Settings, X } from "lucide-react";
import { Tooltip as UITooltip } from "@/components/ui";
import { MetricRegistry } from "@/lib/metrics/MetricRegistry";
import {
  ScheduleData,
  MetricResult,
  MetricSettings,
  LineChartVisualization,
  RadarVisualization,
  HeatmapVisualization,
  IMetric,
} from "@/lib/metrics/MetricInterface";
import { formatDateShort } from "@/lib/dateFormat";
import { dedupeMetricIds } from "@/lib/metrics/metricScheduleData";
import { alignMetricLinePoints } from "@/lib/metrics/lineChartData";
import MetricResourceSelector from "./MetricResourceSelector";

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  RadarController,
  RadialLinearScale,
  Title,
  Tooltip,
  Legend,
  Filler,
  MatrixController,
  MatrixElement,
);

/** Read current theme colours from CSS custom properties for Chart.js canvas. */
function getChartColors() {
  if (typeof document === "undefined") {
    return { text: "#6b7280", grid: "#e5e7eb" };
  }
  const style = getComputedStyle(document.documentElement);
  return {
    text:
      style.getPropertyValue("--color-foreground-muted").trim() || "#6b7280",
    grid: style.getPropertyValue("--color-border").trim() || "#e5e7eb",
  };
}

interface MetricCardProps {
  cardId: string;
  metricId: string;
  snapshot: ScheduleData | null;
  previewSnapshot?: ScheduleData | null;
  settings: MetricSettings;
  /** ISO date "YYYY-MM-DD" currently shown in the OptimisedTab calendar */
  currentDay?: string | null;
  onSettingsChange: (cardId: string, settings: MetricSettings) => void;
  onRemove: (cardId: string) => void;
  onResourceHover?: (type: "person" | "capability", id: number) => void;
  onResourceHoverEnd?: () => void;
}

type HoverResource = { type: "person" | "capability"; id: number };

function cleanLegendLabel(label: unknown): string {
  return String(label ?? "")
    .replace(/\s+\(preview\)$/i, "")
    .trim();
}

function setLegendCursor(event: any, cursor: string) {
  const target = event?.native?.target;
  if (target instanceof HTMLElement) {
    target.style.cursor = cursor;
  }
}

const MetricCard: React.FC<MetricCardProps> = ({
  cardId,
  metricId,
  snapshot,
  previewSnapshot,
  settings,
  currentDay,
  onSettingsChange,
  onRemove,
  onResourceHover,
  onResourceHoverEnd,
}) => {
  const [result, setResult] = useState<MetricResult | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);

  const registry = useMemo(() => MetricRegistry.getInstance(), []);
  const metric = useMemo(() => registry.get(metricId), [registry, metricId]);

  // Whether this metric supports the event/day toggle
  const showTimeToggle = metric ? !metric.config.hasTimeAxis : false;
  const timeAggregation = settings.timeAggregation || "event";

  /**
   * When the metric is in "day" mode, filter tasks to only the current day.
   * This gives metrics an automatically-scoped ScheduleData without needing
   * per-metric implementation changes.
   */
  const effectiveSnapshot = useMemo(() => {
    if (!snapshot) return null;
    if (!showTimeToggle || timeAggregation !== "day" || !currentDay) {
      return snapshot;
    }
    return {
      ...snapshot,
      tasks: snapshot.tasks.filter((t) => {
        const date =
          t.date || new Date(t.start_time).toISOString().split("T")[0];
        return date === currentDay;
      }),
    };
  }, [snapshot, showTimeToggle, timeAggregation, currentDay]);

  const effectivePreview = useMemo(() => {
    if (!previewSnapshot) return null;
    if (!showTimeToggle || timeAggregation !== "day" || !currentDay) {
      return previewSnapshot;
    }
    return {
      ...previewSnapshot,
      tasks: previewSnapshot.tasks.filter((t) => {
        const date =
          t.date || new Date(t.start_time).toISOString().split("T")[0];
        return date === currentDay;
      }),
    };
  }, [previewSnapshot, showTimeToggle, timeAggregation, currentDay]);

  const resolveLegendResource = useCallback(
    (label: unknown): HoverResource | null => {
      if (!snapshot) return null;

      const cleanedLabel = cleanLegendLabel(label);
      if (!cleanedLabel) return null;

      const selectedPersonIds = new Set(settings.personIds || []);
      const selectedCapabilityIds = new Set(settings.capabilityIds || []);

      const people = snapshot.people.filter(
        (person) =>
          selectedPersonIds.size === 0 || selectedPersonIds.has(person.id),
      );
      for (const person of people) {
        const fullName = [person.first_name, person.last_name]
          .filter(Boolean)
          .join(" ")
          .trim();
        const labels = [person.name, fullName]
          .map((value) => value?.trim())
          .filter(Boolean);

        if (labels.includes(cleanedLabel)) {
          return { type: "person", id: person.id };
        }
      }

      const capabilities = snapshot.capabilities
        .filter(
          (capability) =>
            selectedCapabilityIds.size === 0 ||
            selectedCapabilityIds.has(capability.id),
        )
        .sort((a, b) => {
          const aLen = Math.max(
            a.name?.length || 0,
            a.machine_name?.length || 0,
          );
          const bLen = Math.max(
            b.name?.length || 0,
            b.machine_name?.length || 0,
          );
          return bLen - aLen;
        });

      for (const capability of capabilities) {
        const labels = [capability.name, capability.machine_name]
          .map((value) => value?.trim())
          .filter(Boolean);

        if (
          labels.some(
            (capabilityLabel) =>
              cleanedLabel === capabilityLabel ||
              cleanedLabel.startsWith(`${capabilityLabel} (`),
          )
        ) {
          return { type: "capability", id: capability.id };
        }
      }

      return null;
    },
    [snapshot, settings.personIds, settings.capabilityIds],
  );

  const handleLegendHover = useCallback(
    (event: any, legendItem: any, legend: any) => {
      const dataset =
        typeof legendItem?.datasetIndex === "number"
          ? legend?.chart?.data?.datasets?.[legendItem.datasetIndex]
          : null;
      const resource = resolveLegendResource(
        dataset?.label ?? legendItem?.text,
      );

      setLegendCursor(event, resource ? "pointer" : "default");
      if (resource) {
        onResourceHover?.(resource.type, resource.id);
      } else {
        onResourceHoverEnd?.();
      }
    },
    [onResourceHover, onResourceHoverEnd, resolveLegendResource],
  );

  const handleLegendLeave = useCallback(
    (event: any) => {
      setLegendCursor(event, "default");
      onResourceHoverEnd?.();
    },
    [onResourceHoverEnd],
  );

  // Recalculate when snapshot or settings change
  useEffect(() => {
    if (!effectiveSnapshot || !metric) return;

    let cancelled = false;
    setIsCalculating(true);

    const doCalculate = async () => {
      try {
        const calcResult = await metric.calculate(
          effectiveSnapshot,
          settings.filters,
          settings,
        );
        if (!cancelled) {
          setResult(calcResult);
        }
      } catch (err) {
        console.error(`Error calculating metric ${metricId}:`, err);
      } finally {
        if (!cancelled) {
          setIsCalculating(false);
        }
      }
    };

    doCalculate();
    return () => {
      cancelled = true;
    };
  }, [effectiveSnapshot, metric, metricId, settings]);

  // Calculate preview result when previewSnapshot is available
  const [previewResult, setPreviewResult] = useState<MetricResult | null>(null);
  useEffect(() => {
    if (!effectivePreview || !metric) {
      setPreviewResult(null);
      return;
    }
    let cancelled = false;
    const doCalc = async () => {
      try {
        const r = await metric.calculate(
          effectivePreview,
          settings.filters,
          settings,
        );
        if (!cancelled) setPreviewResult(r);
      } catch {
        if (!cancelled) setPreviewResult(null);
      }
    };
    doCalc();
    return () => {
      cancelled = true;
    };
  }, [effectivePreview, metric, settings]);

  // Build Chart.js data from LineChartVisualization
  const chartData = useMemo(() => {
    if (!result?.data || result.data.type !== "line_chart") return null;

    const lineData = result.data as LineChartVisualization;
    if (!lineData.lines || lineData.lines.length === 0) return null;

    const previewLineData =
      previewResult?.data?.type === "line_chart"
        ? (previewResult.data as LineChartVisualization)
        : null;

    // Gather all unique x values (dates) from both current and preview
    const allXValues = new Set<string>();
    lineData.lines.forEach((line) =>
      line.points.forEach((p) => allXValues.add(String(p.x))),
    );
    if (previewLineData) {
      previewLineData.lines.forEach((line) =>
        line.points.forEach((p) => allXValues.add(String(p.x))),
      );
    }
    const explicitXOrder: string[] = [];
    const addOrderedX = (value: string) => {
      if (!explicitXOrder.includes(value)) explicitXOrder.push(value);
    };
    lineData.xOrder?.forEach((value) => addOrderedX(String(value)));
    previewLineData?.xOrder?.forEach((value) => addOrderedX(String(value)));

    const sortedDates =
      explicitXOrder.length > 0
        ? [
            ...explicitXOrder,
            ...Array.from(allXValues)
              .filter((value) => !explicitXOrder.includes(value))
              .sort(),
          ]
        : Array.from(allXValues).sort();
    // Map dates to display labels using day aliases from the schedule data
    const dayAliases = snapshot?.dayAliases || {};
    const xLabels = {
      ...(previewLineData?.xLabels || {}),
      ...(lineData.xLabels || {}),
    };
    const labels = sortedDates.map(
      (date) => xLabels[date] || dayAliases[date] || date,
    );

    const datasets: any[] = lineData.lines.map((line) => {
      const data = alignMetricLinePoints(line, sortedDates);
      const color = line.color || "#3b82f6";

      return {
        label: line.label,
        data,
        borderColor: color,
        backgroundColor: color + "33",
        borderWidth: 1.5,
        borderDash: line.style === "dashed" ? [6, 4] : undefined,
        pointRadius: 2,
        pointHoverRadius: 4,
        tension: 0.1,
        fill: false,
      };
    });

    // Add dashed preview overlay lines
    if (previewLineData) {
      for (const previewLine of previewLineData.lines) {
        const previewData = alignMetricLinePoints(previewLine, sortedDates);

        // Only add if data actually differs from the current line
        const matchingCurrent = lineData.lines.find(
          (l) => l.label === previewLine.label,
        );
        if (matchingCurrent) {
          const currentData = alignMetricLinePoints(
            matchingCurrent,
            sortedDates,
          );
          const differs = previewData.some((v, i) => {
            const current = currentData[i];
            if (v == null || current == null) return v !== current;
            return Math.abs(v - current) > 0.001;
          });
          if (!differs) continue;
        }

        const color = previewLine.color || "#3b82f6";
        datasets.push({
          label: `${previewLine.label} (preview)`,
          data: previewData,
          borderColor: color,
          backgroundColor: "transparent",
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          pointHoverRadius: 3,
          tension: 0.1,
          fill: false,
        });
      }
    }

    return { labels, datasets };
  }, [result, previewResult, snapshot]);

  const chartOptions = useMemo(() => {
    const { text: textColor, grid: gridColor } = getChartColors();
    const nonPreviewCount = chartData
      ? chartData.datasets.filter((d: any) => !d.label?.endsWith("(preview)"))
          .length
      : 0;
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: nonPreviewCount > 1,
          position: "top" as const,
          onHover: handleLegendHover,
          onLeave: handleLegendLeave,
          labels: {
            color: textColor,
            filter: (legendItem: any) =>
              !legendItem.text?.endsWith("(preview)"),
            font: { size: 10 },
            boxWidth: 12,
            padding: 4,
          },
        },
        tooltip: {
          mode: "index" as const,
          intersect: false,
          titleFont: { size: 10 },
          bodyFont: { size: 10 },
        },
      },
      scales: {
        x: {
          ticks: {
            color: textColor,
            font: { size: 9 },
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: 10,
          },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: textColor,
            font: { size: 9 },
            maxTicksLimit: 6,
          },
          grid: {
            color: gridColor,
          },
        },
      },
      interaction: {
        mode: "nearest" as const,
        axis: "x" as const,
        intersect: false,
      },
    };
  }, [chartData, handleLegendHover, handleLegendLeave]);

  // ── Heatmap (matrix chart) data ───────────────────────────────────
  const heatmapConfig = useMemo(() => {
    if (!result?.data || result.data.type !== "heatmap") return null;

    const hm = result.data as HeatmapVisualization;
    if (!hm.data || hm.data.length === 0) return null;

    const isDiverging = hm.colorScale === "diverging";

    // Unique axes. Heatmaps may provide a stable xOrder so display aliases do
    // not accidentally change chronological order.
    const uniqueXValues = Array.from(new Set(hm.data.map((d) => d.x)));
    const xValueSet = new Set(uniqueXValues);
    const orderedFromMetric = (hm.xOrder || []).filter((value) =>
      xValueSet.has(value),
    );
    const remainingXValues = uniqueXValues.filter(
      (value) => !orderedFromMetric.includes(value),
    );
    const looksLikeIsoDates =
      remainingXValues.length > 0 &&
      remainingXValues.every((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
    const xValues = [
      ...orderedFromMetric,
      ...(looksLikeIsoDates ? [...remainingXValues].sort() : remainingXValues),
    ];
    const yLabels = Array.from(new Set(hm.data.map((d) => d.y)));
    const displayX = (value: string) => hm.xLabels?.[value] || value;

    const xIdx = new Map(xValues.map((l, i) => [l, i]));
    const yIdx = new Map(yLabels.map((l, i) => [l, i]));

    // Value range for colour interpolation
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const d of hm.data) {
      if (d.value < minVal) minVal = d.value;
      if (d.value > maxVal) maxVal = d.value;
    }
    if (minVal === maxVal) {
      minVal = 0;
      maxVal = Math.max(1, maxVal);
    }

    // Colour helpers ─ scriptable: receive the data-point value at render time
    const interpolateSequential = (t: number): string => {
      // green → yellow → red
      const r = Math.round(t < 0.5 ? t * 2 * 255 : 255);
      const g = Math.round(t < 0.5 ? 255 : (1 - (t - 0.5) * 2) * 255);
      return `rgb(${r},${g},60)`;
    };

    const interpolateDivergingNorm = (t: number): string => {
      // green (negative / advantaged) → white (0) → red (positive / disadvantaged)
      // t is already in -1 … +1 range
      if (t <= 0) {
        const s = Math.min(1, Math.abs(t));
        const r = Math.round(255 * (1 - s * 0.8));
        const b = Math.round(255 * (1 - s * 0.6));
        return `rgb(${r},255,${b})`;
      } else {
        const s = Math.min(1, t);
        const g = Math.round(255 * (1 - s * 0.75));
        const b = Math.round(255 * (1 - s * 0.85));
        return `rgb(255,${g},${b})`;
      }
    };

    // For diverging heatmaps, compute absMax per column so each day's contrast
    // is independently visible even when some days have much larger values
    const colAbsMax = new Map<string, number>();
    if (isDiverging) {
      for (const d of hm.data) {
        const cur = colAbsMax.get(d.x) || 0;
        if (Math.abs(d.value) > cur) colAbsMax.set(d.x, Math.abs(d.value));
      }
    }

    // Keep minVal / maxVal in closure for the scriptable backgroundColor fn
    const capturedMin = minVal;
    const capturedRange = maxVal - minVal;

    // Use string labels for x/y so chartjs-chart-matrix positions cells
    // correctly on category scales
    const dataset = hm.data.map((d) => ({
      x: d.x,
      y: d.y,
      v: d.value,
    }));

    const data = {
      datasets: [
        {
          label: "Heatmap",
          data: dataset,
          backgroundColor(ctx: any) {
            const raw = ctx.dataset.data[ctx.dataIndex];
            if (!raw) return "#e5e7eb";
            if (isDiverging) {
              const absMax = colAbsMax.get(raw.x) || 1;
              const t = raw.v / absMax; // -1 … +1 within this column
              return interpolateDivergingNorm(t);
            }
            const norm =
              capturedRange > 0 ? (raw.v - capturedMin) / capturedRange : 0;
            return interpolateSequential(norm);
          },
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.4)",
          width: ({ chart }: any) =>
            (chart.chartArea?.width || 100) / Math.max(1, xValues.length) - 1,
          height: ({ chart }: any) =>
            (chart.chartArea?.height || 100) / Math.max(1, yLabels.length) - 1,
        },
      ],
    };

    const options: any = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items: any[]) => {
              if (!items.length) return "";
              const raw = items[0].raw as any;
              return `${raw.y} - ${displayX(raw.x)}`;
            },
            label: (item: any) => {
              const raw = item.raw as any;
              return `Value: ${raw.v.toFixed(1)}`;
            },
          },
          titleFont: { size: 10 },
          bodyFont: { size: 10 },
        },
      },
      scales: {
        x: {
          type: "category" as const,
          labels: xValues,
          offset: true,
          ticks: {
            color: getChartColors().text,
            font: { size: 9 },
            maxRotation: 45,
            callback(value: any) {
              const raw = xValues[Number(value)] ?? String(value);
              return displayX(raw);
            },
          },
          grid: { display: false },
        },
        y: {
          type: "category" as const,
          labels: yLabels,
          offset: true,
          ticks: { color: getChartColors().text, font: { size: 9 } },
          grid: { display: false },
        },
      },
    };

    return { data, options };
  }, [result]);

  // Build radar chart data from RadarVisualization (with optional preview overlay)
  const radarData = useMemo(() => {
    if (!result?.data || result.data.type !== "radar") return null;

    const radar = result.data as RadarVisualization;
    if (!radar.axes || radar.datasets.length === 0) return null;

    const previewRadar =
      previewResult?.data?.type === "radar"
        ? (previewResult.data as RadarVisualization)
        : null;

    // Normalise values per-axis to 0-100 - include preview values in max calc
    const axisCount = radar.axes.length;
    const maxPerAxis = new Array(axisCount).fill(0);
    const allSources = previewRadar
      ? [...radar.datasets, ...previewRadar.datasets]
      : radar.datasets;
    for (const ds of allSources) {
      for (let i = 0; i < axisCount; i++) {
        maxPerAxis[i] = Math.max(maxPerAxis[i], ds.values[i] || 0);
      }
    }

    const normalise = (values: number[]) =>
      values.map((v, i) =>
        maxPerAxis[i] > 0 ? Number(((v / maxPerAxis[i]) * 100).toFixed(1)) : 0,
      );

    const datasets: any[] = radar.datasets.map((ds) => {
      const color = ds.color || "#3b82f6";
      return {
        label: ds.label,
        data: normalise(ds.values),
        _rawValues: ds.values,
        borderColor: color,
        backgroundColor: color + "22",
        borderWidth: 1.5,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: color,
      };
    });

    // Add dashed preview overlay datasets
    if (previewRadar) {
      for (const previewDs of previewRadar.datasets) {
        // Only add if values actually differ from the matching current dataset
        const matchingCurrent = radar.datasets.find(
          (d) => d.label === previewDs.label,
        );
        if (matchingCurrent) {
          const differs = previewDs.values.some(
            (v, i) => Math.abs(v - matchingCurrent.values[i]) > 0.001,
          );
          if (!differs) continue;
        }

        const color = previewDs.color || "#3b82f6";
        datasets.push({
          label: `${previewDs.label} (preview)`,
          data: normalise(previewDs.values),
          _rawValues: previewDs.values,
          borderColor: color,
          backgroundColor: "transparent",
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          pointHoverRadius: 3,
          pointBackgroundColor: color,
        });
      }
    }

    return { labels: radar.axes, datasets };
  }, [result, previewResult]);

  const radarOptions = useMemo(() => {
    const { text: textColor, grid: gridColor } = getChartColors();
    const nonPreviewCount = radarData
      ? radarData.datasets.filter((d: any) => !d.label?.endsWith("(preview)"))
          .length
      : 0;
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: nonPreviewCount > 1,
          position: "top" as const,
          onHover: handleLegendHover,
          onLeave: handleLegendLeave,
          labels: {
            color: textColor,
            filter: (legendItem: any) =>
              !legendItem.text?.endsWith("(preview)"),
            font: { size: 10 },
            boxWidth: 12,
            padding: 4,
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx: any) => {
              const raw = ctx.dataset._rawValues?.[ctx.dataIndex];
              return `${ctx.dataset.label}: ${raw != null ? raw : ctx.parsed.r}`;
            },
          },
          titleFont: { size: 10 },
          bodyFont: { size: 10 },
        },
      },
      scales: {
        r: {
          beginAtZero: true,
          max: 100,
          ticks: {
            display: false,
          },
          pointLabels: {
            color: textColor,
            font: { size: 10 },
          },
          grid: {
            color: gridColor,
          },
          angleLines: {
            color: gridColor,
          },
        },
      },
    };
  }, [radarData, handleLegendHover, handleLegendLeave]);

  // Handlers for resource selection
  const handleAddPerson = useCallback(
    (personId: number) => {
      const newPersonIds = dedupeMetricIds([...(settings.personIds || []), personId]);
      onSettingsChange(cardId, {
        ...settings,
        personIds: newPersonIds,
        filters: { ...settings.filters, personIds: newPersonIds },
      });
    },
    [cardId, settings, onSettingsChange],
  );

  const handleRemovePerson = useCallback(
    (personId: number) => {
      const newPersonIds = dedupeMetricIds(settings.personIds).filter(
        (id) => id !== personId,
      );
      onSettingsChange(cardId, {
        ...settings,
        personIds: newPersonIds,
        filters: { ...settings.filters, personIds: newPersonIds },
      });
    },
    [cardId, settings, onSettingsChange],
  );

  const handleAddCapability = useCallback(
    (capabilityId: number) => {
      const newCapIds = dedupeMetricIds([
        ...(settings.capabilityIds || []),
        capabilityId,
      ]);
      onSettingsChange(cardId, {
        ...settings,
        capabilityIds: newCapIds,
        filters: { ...settings.filters, capabilityIds: newCapIds },
      });
    },
    [cardId, settings, onSettingsChange],
  );

  const handleRemoveCapability = useCallback(
    (capabilityId: number) => {
      const newCapIds = dedupeMetricIds(settings.capabilityIds).filter(
        (id) => id !== capabilityId,
      );
      onSettingsChange(cardId, {
        ...settings,
        capabilityIds: newCapIds,
        filters: { ...settings.filters, capabilityIds: newCapIds },
      });
    },
    [cardId, settings, onSettingsChange],
  );

  const handleColorChange = useCallback(
    (key: string, color: string) => {
      const newColorMap = { ...(settings.colorMap || {}), [key]: color };
      onSettingsChange(cardId, {
        ...settings,
        colorMap: newColorMap,
      });
    },
    [cardId, settings, onSettingsChange],
  );

  const handleTimeAggregationChange = useCallback(
    (value: "event" | "day") => {
      onSettingsChange(cardId, {
        ...settings,
        timeAggregation: value,
      });
    },
    [cardId, settings, onSettingsChange],
  );

  // Resolve the display label for the current day
  const currentDayLabel = useMemo(() => {
    if (!currentDay) return "Day";
    return snapshot?.dayAliases[currentDay] || formatDateShort(currentDay);
  }, [currentDay, snapshot]);

  if (!metric) {
    return (
      <div className="h-full bg-surface rounded-lg border border-red-200 dark:border-red-800 p-3 flex flex-col items-center justify-center gap-2">
        <span className="text-xs text-red-500">
          Metric &quot;{metricId}&quot; not found
        </span>
        <button
          onClick={() => onRemove(cardId)}
          className="px-2 py-1 text-xs font-medium text-red-600 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 rounded transition-colors"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="h-full bg-surface rounded-lg border border-bordercl shadow-sm flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-bordercl-subtle bg-surface-alt/50 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="metric-drag-handle cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-surface-inset dark:bg-surface-hover text-foreground-faint">
            <GripVertical size={14} />
          </div>
          <span className="text-xs font-semibold text-foreground-secondary truncate">
            {metric.config.name}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {result && (
            <span className="text-[10px] text-foreground-muted mr-1 truncate max-w-[80px]">
              {result.label}
            </span>
          )}
          <UITooltip content="Toggle filters" side="bottom">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-1 rounded hover:bg-surface-inset dark:bg-surface-hover transition-colors ${
                showSettings
                  ? "bg-surface-inset dark:bg-surface-hover text-blue-600"
                  : "text-foreground-faint"
              }`}
            >
              <Settings size={12} />
            </button>
          </UITooltip>
          <UITooltip content="Remove metric" side="bottom">
            <button
              onClick={() => onRemove(cardId)}
              className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-foreground-faint hover:text-red-500 transition-colors"
            >
              <X size={12} />
            </button>
          </UITooltip>
        </div>
      </div>

      {/* Filters section */}
      {showSettings &&
        snapshot &&
        (showTimeToggle ||
          metric.config.supportsPersonFilter ||
          metric.config.supportsCapabilityFilter) && (
          <div className="px-3 py-2 border-b border-bordercl-subtle bg-blue-50 dark:bg-blue-950/30 shrink-0">
            {/* Time aggregation toggle - only for metrics without a time axis */}
            {showTimeToggle && (
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[10px] text-foreground-muted font-medium shrink-0">
                  Scope:
                </span>
                <div className="inline-flex rounded-md border border-bordercl overflow-hidden">
                  <button
                    onClick={() => handleTimeAggregationChange("event")}
                    className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      timeAggregation === "event"
                        ? "bg-blue-600 text-white"
                        : "bg-surface text-foreground-muted hover:bg-surface-hover"
                    }`}
                  >
                    Event
                  </button>
                  <UITooltip
                    content={
                      currentDay ? formatDateShort(currentDay) : "No day selected"
                    }
                    side="bottom"
                  >
                    <button
                      onClick={() => handleTimeAggregationChange("day")}
                      className={`px-2 py-0.5 text-[10px] font-medium transition-colors border-l border-bordercl ${
                        timeAggregation === "day"
                          ? "bg-blue-600 text-white"
                          : "bg-surface text-foreground-muted hover:bg-surface-hover"
                      }`}
                    >
                      {currentDayLabel}
                    </button>
                  </UITooltip>
                </div>
              </div>
            )}
            <MetricResourceSelector
              people={snapshot.people}
              capabilities={snapshot.capabilities}
              selectedPersonIds={dedupeMetricIds(settings.personIds)}
              selectedCapabilityIds={dedupeMetricIds(settings.capabilityIds)}
              colorMap={(settings.colorMap as Record<string, string>) || {}}
              onAddPerson={handleAddPerson}
              onRemovePerson={handleRemovePerson}
              onAddCapability={handleAddCapability}
              onRemoveCapability={handleRemoveCapability}
              onColorChange={handleColorChange}
              onResourceHover={onResourceHover}
              onResourceHoverEnd={onResourceHoverEnd}
              showPersonFilter={metric.config.supportsPersonFilter !== false}
            />
          </div>
        )}

      {/* Chart area */}
      <div className="flex-1 min-h-0 p-2">
        {isCalculating ? (
          <div className="h-full flex items-center justify-center">
            <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
          </div>
        ) : heatmapConfig ? (
          <div className="h-full w-full">
            <Chart
              type="matrix"
              data={heatmapConfig.data}
              options={heatmapConfig.options}
            />
          </div>
        ) : radarData ? (
          <div className="h-full w-full">
            <Radar data={radarData} options={radarOptions} />
          </div>
        ) : chartData ? (
          <div className="h-full w-full">
            <Line data={chartData} options={chartOptions} />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-foreground-faint">
            {!snapshot ? "Loading data..." : "No data to display"}
          </div>
        )}
      </div>
    </div>
  );
};

export default MetricCard;
