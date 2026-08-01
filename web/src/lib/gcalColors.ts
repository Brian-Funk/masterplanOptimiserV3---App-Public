/** Google Calendar colour id with foreground/background colours. */
export interface GCalColor {
  id: string;
  background: string;
  foreground: string;
}

/** Google Calendar colour labels and display order used in export settings. */
export const GCAL_COLOR_META: Record<
  string,
  { label: string; order: number; background: string; foreground: string }
> = {
  "11": {
    label: "Tomato",
    order: 0,
    background: "#D50000",
    foreground: "#FFFFFF",
  },
  "4": {
    label: "Flamingo",
    order: 1,
    background: "#E67C73",
    foreground: "#FFFFFF",
  },
  "6": {
    label: "Tangerine",
    order: 2,
    background: "#F4511E",
    foreground: "#FFFFFF",
  },
  "5": {
    label: "Banana",
    order: 3,
    background: "#F6BF26",
    foreground: "#000000",
  },
  "2": {
    label: "Sage",
    order: 4,
    background: "#33B679",
    foreground: "#FFFFFF",
  },
  "10": {
    label: "Basil",
    order: 5,
    background: "#0B8043",
    foreground: "#FFFFFF",
  },
  "7": {
    label: "Peacock",
    order: 6,
    background: "#039BE5",
    foreground: "#FFFFFF",
  },
  "9": {
    label: "Blueberry",
    order: 7,
    background: "#3F51B5",
    foreground: "#FFFFFF",
  },
  "1": {
    label: "Lavender",
    order: 8,
    background: "#7986CB",
    foreground: "#FFFFFF",
  },
  "3": {
    label: "Grape",
    order: 9,
    background: "#8E24AA",
    foreground: "#FFFFFF",
  },
  "8": {
    label: "Graphite",
    order: 10,
    background: "#616161",
    foreground: "#FFFFFF",
  },
};

/**
 * Hardcoded Google Calendar palette (always available, no API needed).
 * Use this when you need the 11 colours without a Google Calendar connection.
 */
export const GCAL_PALETTE: GCalColor[] = Object.entries(GCAL_COLOR_META)
  .sort(([, a], [, b]) => a.order - b.order)
  .map(([id, meta]) => ({
    id,
    background: meta.background,
    foreground: meta.foreground,
  }));

/** Sort Google Calendar colours into the canonical Google display order. */
export function sortedGcalColors(colors: GCalColor[]): GCalColor[] {
  return [...colors].sort((a, b) => {
    const oa = GCAL_COLOR_META[a.id]?.order ?? 99;
    const ob = GCAL_COLOR_META[b.id]?.order ?? 99;
    return oa - ob;
  });
}

/** Return the user-facing Google Calendar colour label for a colour id. */
export function gcalColorLabel(id: string): string {
  return GCAL_COLOR_META[id]?.label ?? `Colour ${id}`;
}
