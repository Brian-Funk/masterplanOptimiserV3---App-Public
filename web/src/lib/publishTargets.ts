export type PublishDestination = "google" | "mp-backend" | "pdf" | "excel";
export type PublishTarget = PublishDestination[];

export const PUBLISH_DESTINATIONS: readonly PublishDestination[] = [
  "google",
  "mp-backend",
  "pdf",
  "excel",
] as const;

/** Canonicalise persisted targets and translate the retired scalar contract. */
export function normalisePublishTargets(value: unknown): PublishTarget {
  if (typeof value === "string") {
    if (value === "google") value = ["google"];
    else if (value === "mp-backend") value = ["mp-backend"];
    else if (value === "both") value = ["google", "mp-backend"];
    else value = [];
  }
  if (!Array.isArray(value)) return [];
  const selected = new Set(
    value.filter((item): item is PublishDestination =>
      PUBLISH_DESTINATIONS.includes(item as PublishDestination),
    ),
  );
  return PUBLISH_DESTINATIONS.filter((target) => selected.has(target));
}

export function hasPublishDestination(
  targets: PublishTarget | null | undefined,
  destination: PublishDestination,
): boolean {
  return Boolean(targets?.includes(destination));
}

export function getPublishTargetsLabel(
  targets: PublishTarget | null | undefined,
): string {
  const labels = normalisePublishTargets(targets).map((target) => {
    if (target === "google") return "Google Calendar";
    if (target === "mp-backend") return "MP-Backend";
    if (target === "pdf") return "PDF";
    return "Excel workbook";
  });
  if (labels.length === 0) return "No publish target";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}
