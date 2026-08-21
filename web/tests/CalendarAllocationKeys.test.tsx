import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Calendar, { type CalendarTask } from "@/components/Calendar";

describe("Calendar allocation row identity", () => {
  it("renders distinct field ids that share the same display label without key warnings", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const task: CalendarTask = {
      id: 1,
      name: "Synthetic transfer",
      task_type_id: 1,
      task_type_name: "Transfer",
      task_type_color: "#123456",
      date: "2032-04-21",
      start_end_time: { start: "09:00", end: "10:00" },
      fields: {},
      field_definitions: [
        { id: "field_Assigned", name: "Assigned", type: "persons_list" },
        { id: "field_assigned_custom", name: "Assigned", type: "persons_list" },
      ],
      field_assignments: {
        field_Assigned: [1],
        field_assigned_custom: [2],
      },
    };

    render(
      <Calendar
        tasks={[task]}
        viewType="daily"
        selectedDate="2032-04-21"
        onTaskEdit={vi.fn()}
        persons={[
          { id: 1, first_name: "Synthetic", last_name: "One" },
          { id: 2, first_name: "Synthetic", last_name: "Two" },
        ]}
      />,
    );

    expect(screen.getAllByText("Assigned:")).toHaveLength(2);
    expect(screen.getByText("Synthetic One")).toBeInTheDocument();
    expect(screen.getByText("Synthetic Two")).toBeInTheDocument();
    expect(
      consoleError.mock.calls.some((call) =>
        call.some((part) => String(part).includes("same key")),
      ),
    ).toBe(false);
    consoleError.mockRestore();
  });

  it("keeps ignored CMI tasks visible, selectable, and clearly labelled", () => {
    const task: CalendarTask = {
      id: 9,
      name: "Diagnostic task",
      task_type_id: 1,
      task_type_name: "Static",
      task_type_color: "#2563EB",
      date: "2032-04-21",
      start_end_time: { start: "09:00", end: "10:00" },
      fields: {},
      field_definitions: [],
    };

    const { container } = render(
      <Calendar
        tasks={[task]}
        viewType="daily"
        selectedDate="2032-04-21"
        onTaskEdit={vi.fn()}
        selectedTaskIds={[9]}
        ignoredTaskIds={new Set([9])}
      />,
    );

    expect(screen.getByText("Diagnostic task")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Ignored by flow checking and optimisation"),
    ).toBeInTheDocument();
    const card = container.querySelector('[data-task-id="9"]');
    expect(card).toHaveAttribute("data-solver-ignored", "true");
    expect(card).toHaveClass("opacity-60", "saturate-50");
    expect(card).toHaveClass("ring-4");
  });
});
