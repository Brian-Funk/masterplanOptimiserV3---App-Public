import { describe, expect, it } from "vitest";
import type { CalendarTask } from "@/components/Calendar";
import { buildPdfTimelineLayout } from "@/lib/pdfTimeline";

function task(
  id: number,
  start: string,
  end: string,
  date = "2032-04-21",
): CalendarTask {
  return {
    id,
    name: `Task ${String(id)}`,
    task_type_id: 1,
    task_type_name: "Operations",
    task_type_color: "#2563eb",
    date,
    start_end_time: { start, end },
    fields: {},
    field_definitions: [],
    _pdf_reference: "T01",
  };
}

describe("static PDF timeline", () => {
  it("lays out overlapping tasks in separate finite columns", () => {
    const layout = buildPdfTimelineLayout(
      [task(1, "08:00", "10:00"), task(2, "09:00", "11:00")],
      "2032-04-21",
      { startHour: 8, endHour: 18 },
    );

    expect(layout.items).toHaveLength(2);
    expect(layout.items.map((item) => item.width)).toEqual([50, 50]);
    expect(layout.items.every((item) => Number.isFinite(item.top))).toBe(true);
    expect(layout.items.every((item) => item.height >= 18)).toBe(true);
  });

  it("does not use imported task IDs as overlap-graph identities", () => {
    const malformed = [
      task(Number.NaN, "08:00", "09:00"),
      task(Number.NaN, "08:30", "09:30"),
      task(5, "09:00", "10:00"),
      task(5, "09:15", "10:15"),
    ];
    const layout = buildPdfTimelineLayout(
      malformed,
      "2032-04-21",
      { startHour: 8, endHour: 18 },
    );

    expect(layout.items).toHaveLength(4);
    expect(new Set(layout.items.map((item) => item.key)).size).toBe(4);
  });

  it("keeps a dense seven-day-sized workload bounded and deterministic", () => {
    const dense = Array.from({ length: 292 }, (_, index) => {
      const hour = 6 + (index % 18);
      return task(index + 1, `${String(hour).padStart(2, "0")}:00`, `${String((hour + 1) % 24).padStart(2, "0")}:00`);
    });
    const first = buildPdfTimelineLayout(
      dense,
      "2032-04-21",
      { startHour: 6, endHour: 24 },
    );
    const second = buildPdfTimelineLayout(
      dense,
      "2032-04-21",
      { startHour: 6, endHour: 24 },
    );

    expect(first.items).toHaveLength(292);
    expect(second).toEqual(first);
    expect(first.totalHeight).toBeGreaterThan(0);
  });

  it("places an after-midnight task in the previous working-day tail", () => {
    const layout = buildPdfTimelineLayout(
      [task(1, "01:00", "02:00", "2032-04-22")],
      "2032-04-21",
      { startHour: 6, endHour: 30 },
    );

    expect(layout.items[0].top).toBeGreaterThan(0);
    expect(layout.items[0].top).toBeLessThan(layout.totalHeight);
  });
});
