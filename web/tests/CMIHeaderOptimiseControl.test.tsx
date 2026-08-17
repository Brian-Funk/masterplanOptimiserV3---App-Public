import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CMIHeader } from "@/app/dashboard/admin/tabs/cmi/CMIHeader";

const setShowProgressModal = vi.fn();

vi.mock("@/contexts/OptimizationContext", () => ({
  useOptimization: () => ({
    optimizationState: {
      runningJobId: null,
      runningDate: null,
      runningEventId: null,
      isOptimizing: false,
    },
    progressData: null,
    setShowProgressModal,
  }),
}));

function renderHeader({
  flowCheckStatus = "valid",
  onOptimise = vi.fn(),
  onOptimiseAllDays = vi.fn(),
}: {
  flowCheckStatus?: "checking" | "valid" | "invalid" | null;
  onOptimise?: () => void;
  onOptimiseAllDays?: () => void;
} = {}) {
  render(
    <CMIHeader
      selectedDate="2027-07-18"
      selectedEvent={{
        id: 1,
        start_date: "2027-07-18",
        end_date: "2027-07-20",
      }}
      flowCheckStatus={flowCheckStatus}
      flowCheckErrors={[]}
      flowCheckDiagnostics={null}
      infeasibleTasks={[]}
      getDayInfo={() => ({
        dayNumber: 1,
        alias: null,
        formattedDate: "18 July 2027",
      })}
      onRefresh={vi.fn()}
      onOptimise={onOptimise}
      onOptimiseAllDays={onOptimiseAllDays}
      allDaysRunning={false}
      onPreviousDay={vi.fn()}
      onNextDay={vi.fn()}
    />,
  );
}

describe("CMIHeader optimisation control", () => {
  beforeEach(() => {
    setShowProgressModal.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("uses one fixed-width button and switches actions only while Shift is held", () => {
    const onOptimise = vi.fn();
    const onOptimiseAllDays = vi.fn();
    renderHeader({ onOptimise, onOptimiseAllDays });

    const dayButton = screen.getByRole("button", { name: "Optimise day" });
    expect(dayButton).toHaveClass("w-40", "bg-purple-600");
    fireEvent.click(dayButton);
    expect(onOptimise).toHaveBeenCalledOnce();
    expect(onOptimiseAllDays).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    const allDaysButton = screen.getByRole("button", {
      name: "Optimise all days",
    });
    expect(allDaysButton).toHaveClass("w-40", "bg-indigo-700");
    fireEvent.click(allDaysButton, { shiftKey: true });
    expect(onOptimiseAllDays).toHaveBeenCalledOnce();

    fireEvent.keyUp(window, { key: "Shift" });
    expect(
      screen.getByRole("button", { name: "Optimise day" }),
    ).toHaveClass("w-40", "bg-purple-600");
  });

  it("allows the all-days flow to skip an invalid selected day", () => {
    const onOptimiseAllDays = vi.fn();
    renderHeader({
      flowCheckStatus: "invalid",
      onOptimiseAllDays,
    });

    expect(screen.getByRole("button", { name: "Optimise day" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });

    const allDaysButton = screen.getByRole("button", {
      name: "Optimise all days",
    });
    expect(allDaysButton).toBeEnabled();
    fireEvent.click(allDaysButton, { shiftKey: true });
    expect(onOptimiseAllDays).toHaveBeenCalledOnce();
  });
});
