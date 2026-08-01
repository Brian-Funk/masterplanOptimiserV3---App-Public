export const METRICS_HIGHLIGHT_CHANNEL = "metrics-highlight";

export const METRIC_HIGHLIGHT_CLEAR_MESSAGE = { action: "clear" } as const;

type HighlightChannel = Pick<BroadcastChannel, "postMessage"> | null | undefined;

export function postMetricHighlightClear(channel: HighlightChannel) {
  channel?.postMessage(METRIC_HIGHLIGHT_CLEAR_MESSAGE);
}
