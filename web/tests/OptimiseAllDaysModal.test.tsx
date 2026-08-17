import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OptimiseAllDaysModal } from "@/app/dashboard/admin/tabs/cmi/OptimiseAllDaysModal";
import type { AllDaysStep } from "@/lib/allDaysOptimization";

const steps: AllDaysStep[] = [
  {
    date: "2027-07-18",
    label: "Sunday, 18 July",
    flow: "passed",
    optimisation: "succeeded",
  },
  {
    date: "2027-07-19",
    label: "Monday, 19 July",
    flow: "checking",
    optimisation: "pending",
  },
  {
    date: "2027-07-20",
    label: "Tuesday, 20 July",
    flow: "pending",
    optimisation: "pending",
  },
];

describe("OptimiseAllDaysModal", () => {
  it("shows ordered day progress and cannot be dismissed while running", () => {
    const onClose = vi.fn();
    render(
      <OptimiseAllDaysModal
        open
        running
        steps={steps}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("day 2 of 3", { exact: false })).toBeInTheDocument();
    expect(
      screen.getByLabelText("Sunday, 18 July: Flow passed · optimised"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Monday, 19 July: Checking flow"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("summarises the result and closes after the sequence settles", () => {
    const onClose = vi.fn();
    const completed: AllDaysStep[] = [
      steps[0],
      {
        ...steps[1],
        flow: "failed",
        optimisation: "skipped",
        detail: "Two flow issues.",
      },
      {
        ...steps[2],
        flow: "passed",
        optimisation: "succeeded",
      },
    ];
    render(
      <OptimiseAllDaysModal
        open
        running={false}
        steps={completed}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("2 of 3 days optimised.")).toBeInTheDocument();
    expect(screen.getByText("1 day(s) skipped before optimisation.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
