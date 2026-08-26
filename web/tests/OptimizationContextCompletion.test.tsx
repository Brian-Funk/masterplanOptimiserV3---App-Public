import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  OptimizationProvider,
  useOptimization,
} from "@/contexts/OptimizationContext";

const mockGetJobStatus = vi.hoisted(() => vi.fn());
const mockAddToast = vi.hoisted(() => vi.fn());
const mockBulkSetOptimised = vi.hoisted(() => vi.fn());

vi.mock("@/lib/optimizationApi", () => ({
  optimizationApi: {
    getJobStatus: mockGetJobStatus,
  },
}));

vi.mock("@/contexts/TaskInstanceContext", () => ({
  useTaskInstances: () => ({
    instances: [
      {
        id: 12,
        event_id: 7,
        date: "2027-07-18",
        name: "Synthetic task",
        is_floating: false,
      },
    ],
    ignoredTaskIds: new Set<number>(),
    bulkSetOptimised: mockBulkSetOptimised,
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock("@/components/SolverProgressModal", () => ({
  default: () => null,
}));

function CompletionHarness() {
  const { startOptimization } = useOptimization();
  return (
    <button
      type="button"
      onClick={async () => {
        const result = await startOptimization(7, "2027-07-18", 91);
        document.body.dataset.optimisationResult = result.status;
      }}
    >
      Start
    </button>
  );
}

describe("OptimizationContext completion promises", () => {
  beforeEach(() => {
    delete document.body.dataset.optimisationResult;
    mockGetJobStatus.mockReset();
    mockAddToast.mockReset();
    mockBulkSetOptimised.mockReset();
  });

  it("resolves only after the tracked job reaches a terminal result", async () => {
    mockGetJobStatus.mockResolvedValue({
      status: "completed",
      result_data: null,
    });
    render(
      <OptimizationProvider>
        <CompletionHarness />
      </OptimizationProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(document.body.dataset.optimisationResult).toBe("completed");
    });
    expect(mockGetJobStatus).toHaveBeenCalledWith(91, 7);
  });

  it("processes a newly started run even when an older backend reused its job ID", async () => {
    mockGetJobStatus.mockResolvedValue({
      status: "completed",
      result_data: {
        status: "OPTIMAL",
        assignments: [
          {
            task_id: 12,
            person_id: 4,
            start_time: 600,
            end_time: 660,
            location_id: 3,
          },
        ],
        field_assignments: {},
        errors: [],
      },
    });
    render(
      <OptimizationProvider>
        <CompletionHarness />
      </OptimizationProvider>,
    );

    const start = screen.getByRole("button", { name: "Start" });
    fireEvent.click(start);
    await waitFor(() => expect(mockBulkSetOptimised).toHaveBeenCalledTimes(1));

    fireEvent.click(start);
    await waitFor(() => expect(mockBulkSetOptimised).toHaveBeenCalledTimes(2));

    expect(mockBulkSetOptimised).toHaveBeenLastCalledWith([
      {
        id: 12,
        optimised: {
          start_time: 600,
          end_time: 660,
          location: 3,
          assigned_persons: [4],
        },
        final: {
          start_time: 600,
          end_time: 660,
          location: 3,
          assigned_persons: [4],
        },
      },
    ]);
  });
});
