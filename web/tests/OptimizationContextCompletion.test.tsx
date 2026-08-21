import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  OptimizationProvider,
  useOptimization,
} from "@/contexts/OptimizationContext";

const mockGetJobStatus = vi.hoisted(() => vi.fn());
const mockAddToast = vi.hoisted(() => vi.fn());

vi.mock("@/lib/optimizationApi", () => ({
  optimizationApi: {
    getJobStatus: mockGetJobStatus,
  },
}));

vi.mock("@/contexts/TaskInstanceContext", () => ({
  useTaskInstances: () => ({
    instances: [],
    ignoredTaskIds: new Set<number>(),
    bulkSetOptimised: vi.fn(),
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
});
