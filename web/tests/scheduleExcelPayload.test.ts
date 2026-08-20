import { describe, expect, it } from "vitest";
import type { CalendarTask } from "@/components/Calendar";
import { buildScheduleExcelPayload } from "@/lib/scheduleExcelPayload";

const event = {
  id: 4,
  name: "Synthetic Session",
  start_date: "2032-04-21",
  end_date: "2032-04-22",
  meta_data: { day_aliases: { "2032-04-21": "Build" } },
};

const people = [
  { id: 3, evidence_subject_id: "three", first_name: "Ada", last_name: "Lovelace", email: null, capabilities: [], unavailabilities: [] },
  { id: 1, evidence_subject_id: "one", first_name: "Alan", last_name: "Turing", email: null, capabilities: [], unavailabilities: [] },
  { id: 2, evidence_subject_id: "two", first_name: "Alan", last_name: "Turing", email: null, capabilities: [], unavailabilities: [] },
];

function task(): CalendarTask {
  return {
    id: 9,
    name: "Transfer briefing",
    task_type_id: 2,
    task_type_name: "Transfer",
    task_type_color: "#123456",
    fields: {
      field_start: 11,
      field_end: { value: 12 },
      field_notes: "Bring the group list",
      field_link: "https://example.invalid/list",
      field_people: [1, 2],
    },
    field_definitions: [
      { id: "field_start", name: "Start", type: "location", category: "conditions" },
      { id: "field_end", name: "End", type: "location", category: "conditions" },
      { id: "field_notes", name: "Notes", type: "text", category: "arbitrary" },
      { id: "field_link", name: "Group list", type: "link", category: "arbitrary" },
      { id: "field_people", name: "Passengers", type: "persons_list", category: "conditions" },
    ] as any,
    start_end_time: { start: "23:30", end: "25:00" },
    resource_info: "Driver: Ada Lovelace | Passengers: Alan Turing",
    assigned_persons: [3],
    field_assignments: { field_people: [1, 2, 2] },
    location_id: 11,
  };
}

describe("Excel publication payload", () => {
  it("builds narrow, sorted workbook data with all final assignments", () => {
    const result = buildScheduleExcelPayload({
      title: "Plan",
      event,
      people: people as any,
      locations: [
        { id: 11, event_id: 4, name: "ETH Hall", address: "ETH Zurich" },
        { id: 12, event_id: 4, name: "Stanford Lab", address: "Stanford" },
      ],
      sourceTasks: [{ id: 9, description: "Operational transfer", additional: { vehicle: "Bus", date: "2032-04-21" } }],
      layoutColours: { 9: "#ABCDEF" },
      days: [{ date: "2032-04-21", tasks: [task()] }],
    });

    expect(result.people).toEqual([
      { id: 3, displayName: "Ada Lovelace" },
      { id: 1, displayName: "Alan Turing (1)" },
      { id: 2, displayName: "Alan Turing (2)" },
    ]);
    expect(result.days[0]).toMatchObject({ alias: "Build", dayNumber: 1 });
    expect(result.days[0].tasks[0]).toMatchObject({
      id: 9,
      startMinutes: 1410,
      endMinutes: 1500,
      colour: "#ABCDEF",
      assignedPersonIds: [1, 2, 3],
      routeStart: { name: "ETH Hall", address: "ETH Zurich" },
      routeEnd: { name: "Stanford Lab", address: "Stanford" },
    });
    expect(result.days[0].tasks[0].additionalInfo).toBe(
      "Description: Operational transfer\nNotes: Bring the group list\nGroup list: https://example.invalid/list",
    );
    expect(result.days[0].tasks[0].additionalInfo).not.toContain("Vehicle");
    expect(JSON.stringify(result)).not.toContain("example.invalid/list\",\"field_people");
  });

  it("uses Schedule as a safe alias fallback and leaves missing times blank", () => {
    const item = task();
    item.start_end_time = undefined;
    const result = buildScheduleExcelPayload({
      title: "Plan",
      event: { ...event, meta_data: {} },
      people: people as any,
      locations: [],
      days: [{ date: "2032-04-22", tasks: [item] }],
    });
    expect(result.days[0].alias).toBe("Schedule");
    expect(result.days[0].dayNumber).toBe(2);
    expect(result.days[0].tasks[0].startMinutes).toBeNull();
  });

  it("orders after-midnight tasks within the preceding working day", () => {
    const evening = task();
    evening.id = 10;
    evening.name = "Evening work";
    evening.date = "2032-04-21";
    evening.start_end_time = { start: "23:00", end: "23:30" };
    const overnight = task();
    overnight.id = 11;
    overnight.name = "Overnight work";
    overnight.date = "2032-04-22";
    overnight.start_end_time = { start: "01:00", end: "02:00" };

    const result = buildScheduleExcelPayload({
      title: "Plan",
      event,
      people: people as any,
      locations: [],
      days: [{ date: "2032-04-21", tasks: [overnight, evening] }],
    });

    expect(result.days[0].tasks.map((item) => [item.id, item.startMinutes, item.endMinutes])).toEqual([
      [10, 1380, 1410],
      [11, 1500, 1560],
    ]);
  });
});
