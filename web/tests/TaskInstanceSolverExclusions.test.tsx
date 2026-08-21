import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  TaskInstanceProvider,
  useTaskInstances,
} from "@/contexts/TaskInstanceContext";

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  getSolverExclusions: vi.fn(),
  setSolverExclusions: vi.fn(),
}));

vi.mock("@/contexts/EventContext", () => ({
  useEvent: () => ({ selectedEventId: 7 }),
}));

vi.mock("@/lib/api", () => ({
  taskInstancesApi: {
    getAll: mocks.getAll,
    getSolverExclusions: mocks.getSolverExclusions,
    setSolverExclusions: mocks.setSolverExclusions,
  },
}));

function Harness() {
  const { ignoredTaskIds, setTasksIgnored } = useTaskInstances();
  return (
    <div>
      <output>{Array.from(ignoredTaskIds).sort().join(",")}</output>
      <button
        type="button"
        onClick={() => void setTasksIgnored([2], true).catch(() => undefined)}
      >
        Ignore second
      </button>
    </div>
  );
}

describe("TaskInstanceContext solver exclusions", () => {
  beforeEach(() => {
    mocks.getAll.mockReset().mockResolvedValue([
      { id: 1, event_id: 7, name: "First" },
      { id: 2, event_id: 7, name: "Second" },
    ]);
    mocks.getSolverExclusions
      .mockReset()
      .mockResolvedValue({ ignored_task_instance_ids: [1] });
    mocks.setSolverExclusions
      .mockReset()
      .mockResolvedValue({ ignored_task_instance_ids: [1, 2] });
  });

  it("loads and reconciles the complete persisted ignored-task set", async () => {
    render(
      <TaskInstanceProvider>
        <Harness />
      </TaskInstanceProvider>,
    );

    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Ignore second" }));
    await waitFor(() => expect(screen.getByText("1,2")).toBeInTheDocument());
    expect(mocks.setSolverExclusions).toHaveBeenCalledWith(7, [2], true);
  });

  it("keeps the existing state when persistence fails", async () => {
    mocks.setSolverExclusions.mockRejectedValueOnce(new Error("Synthetic failure"));
    render(
      <TaskInstanceProvider>
        <Harness />
      </TaskInstanceProvider>,
    );

    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Ignore second" }));
    await waitFor(() => expect(mocks.setSolverExclusions).toHaveBeenCalled());
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
