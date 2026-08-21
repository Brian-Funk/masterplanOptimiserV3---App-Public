import { beforeEach, describe, expect, it, vi } from "vitest";

import { performFlowCheck } from "@/app/dashboard/admin/tabs/cmi/flowCheckUtils";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  getCapabilities: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  flowApi: { check: mocks.check },
  capabilitiesApi: { getAll: mocks.getCapabilities },
}));

const task = {
  id: 1,
  event_id: 7,
  template_id: 11,
  task_type_id: 4,
  date: "2032-04-21",
  field_values: {
    101: { start: "09:00", end: "10:00" },
    102: 3,
  },
};

const params = {
  selectedEvent: { id: 7 },
  selectedDate: "2032-04-21",
  templates: [
    {
      id: 11,
      name: "Static",
      fields: [
        { id: 101, name: "Time", type: "start_end_time" },
        { id: 102, name: "Location", type: "location" },
      ],
    },
  ],
  taskTypes: [{ id: 4 }],
  persons: [
    {
      id: 9,
      first_name: "Synthetic",
      last_name: "Person",
      capabilities: [],
      unavailabilities: [],
    },
  ],
  locations: [{ id: 3, name: "Synthetic venue" }],
  taskInstances: [task],
};

describe("flow checks with ignored tasks", () => {
  beforeEach(() => {
    mocks.check.mockReset().mockResolvedValue({
      feasible: true,
      errors: [],
      diagnostics: {
        schema_version: 1,
        status: "feasible",
        checked_scope: "full",
        summary: "Feasible",
        issues: [],
      },
    });
    mocks.getCapabilities.mockReset().mockResolvedValue([]);
  });

  it("does not call the backend when every task is ignored", async () => {
    const result = await performFlowCheck({
      ...params,
      ignoredTaskIds: new Set([1]),
    });

    expect(result.status).toBe("empty");
    expect(result.emptyMessage).toContain("all tasks are ignored");
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("sends the event-scoped active task set", async () => {
    const result = await performFlowCheck({
      ...params,
      ignoredTaskIds: new Set(),
    });

    expect(result.status).toBe("valid");
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.check.mock.calls[0][0].event_id).toBe(7);
    expect(mocks.check.mock.calls[0][0].tasks.map((item: any) => item.id)).toEqual([
      1,
    ]);
  });
});
