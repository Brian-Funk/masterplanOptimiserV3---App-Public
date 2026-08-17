import { describe, expect, it } from "vitest";
import type { CalendarTask } from "@/components/Calendar";
import {
  buildPdfDayTaskModel,
  formatPdfFieldValue,
} from "@/lib/pdfScheduleDetails";

function task(overrides: Partial<CalendarTask>): CalendarTask {
  return {
    id: 1,
    name: "Task",
    task_type_id: 1,
    task_type_name: "Operations",
    task_type_color: "#2563eb",
    fields: {},
    field_definitions: [],
    ...overrides,
  };
}

describe("PDF schedule details", () => {
  it("orders tasks chronologically and assigns stable printable references", () => {
    const model = buildPdfDayTaskModel([
      task({ id: 2, name: "Later", date: "2032-04-21", time: "11:00" }),
      task({ id: 1, name: "Earlier", date: "2032-04-21", time: "09:00" }),
    ]);

    expect(model.details.map((detail) => [detail.reference, detail.title])).toEqual([
      ["T01", "Earlier"],
      ["T02", "Later"],
    ]);
    expect(model.tasks.map((item) => item._pdf_reference)).toEqual(["T01", "T02"]);
  });

  it("keeps complete allocation and user-facing field text without raw person ids", () => {
    const model = buildPdfDayTaskModel([
      task({
        name: "A deliberately long operational task title",
        start_end_time: { start: "09:00", end: "11:30" },
        location_name: "Main Hall",
        resource_info: "Stage leads: Alex Example, Sam Example | Safety: Jo Example",
        fields: {
          notes: "Bring the complete equipment manifest.",
          people: [41, 42],
          reference: { label: "Run sheet", url: "https://example.invalid/run-sheet" },
        },
        field_definitions: [
          { id: "notes", name: "Instructions", type: "text" },
          { id: "people", name: "People", type: "persons_list" },
          { id: "reference", name: "Reference", type: "link" },
        ],
        _extra_card_fields: [{ label: "Radio channel", value: "Operations 3" }],
      }),
    ]);

    expect(model.details[0]).toMatchObject({
      time: "09:00 - 11:30",
      location: "Main Hall",
      allocations: [
        "Stage leads: Alex Example, Sam Example",
        "Safety: Jo Example",
      ],
    });
    expect(model.details[0].fields).toEqual([
      { label: "Instructions", value: "Bring the complete equipment manifest." },
      { label: "Reference", value: "Run sheet - https://example.invalid/run-sheet" },
      { label: "Radio channel", value: "Operations 3" },
    ]);
    expect(JSON.stringify(model.details[0])).not.toContain("41");
  });

  it("formats only bounded human-readable values", () => {
    expect(formatPdfFieldValue(["North", "South"])).toBe("North, South");
    expect(formatPdfFieldValue({ label: "Map", url: "https://example.invalid/map" })).toBe(
      "Map - https://example.invalid/map",
    );
    expect(formatPdfFieldValue({ secret: "not rendered" })).toBe("");
  });

  it("does not crash the hidden renderer on malformed display-only values", () => {
    const model = buildPdfDayTaskModel([
      task({
        name: { unexpected: "object" } as any,
        task_type_name: ["unexpected"] as any,
        location_name: 42 as any,
        time: { value: "09:00" } as any,
      }),
    ]);

    expect(model.details[0]).toMatchObject({
      title: "Unnamed task",
      taskType: "Operational task",
      location: "42",
      time: "Not scheduled",
    });
  });
});
