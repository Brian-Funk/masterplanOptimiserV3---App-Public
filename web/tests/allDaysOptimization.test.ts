import { describe, expect, it, vi } from "vitest";

import {
  buildAllDaysSteps,
  runAllDaysSequence,
  summariseAllDaysSteps,
} from "@/lib/allDaysOptimization";

describe("all-days optimisation sequence", () => {
  it("builds every event day in chronological order", () => {
    expect(
      buildAllDaysSteps("2027-07-18", "2027-07-20", (date) => date.slice(-2)),
    ).toEqual([
      {
        date: "2027-07-18",
        label: "18",
        flow: "pending",
        optimisation: "pending",
      },
      {
        date: "2027-07-19",
        label: "19",
        flow: "pending",
        optimisation: "pending",
      },
      {
        date: "2027-07-20",
        label: "20",
        flow: "pending",
        optimisation: "pending",
      },
    ]);
  });

  it("checks and optimises strictly left to right, skipping a failed flow", async () => {
    const calls: string[] = [];
    const initialSteps = buildAllDaysSteps(
      "2027-07-18",
      "2027-07-20",
      (date) => date,
    );
    const checkFlow = vi.fn(async (date: string) => {
      calls.push(`flow:${date}`);
      return date === "2027-07-19"
        ? ({ status: "failed", detail: "Blocked" } as const)
        : ({ status: "passed" } as const);
    });
    const optimise = vi.fn(async (date: string) => {
      calls.push(`optimise:${date}`);
      return date === "2027-07-20"
        ? ({ status: "failed", detail: "No solution" } as const)
        : ({ status: "succeeded" } as const);
    });

    const result = await runAllDaysSequence({
      initialSteps,
      checkFlow,
      optimise,
      onChange: vi.fn(),
    });

    expect(calls).toEqual([
      "flow:2027-07-18",
      "optimise:2027-07-18",
      "flow:2027-07-19",
      "flow:2027-07-20",
      "optimise:2027-07-20",
    ]);
    expect(optimise).not.toHaveBeenCalledWith("2027-07-19");
    expect(summariseAllDaysSteps(result)).toEqual({
      succeeded: 1,
      flowFailed: 1,
      skipped: 0,
      optimisationFailed: 1,
    });
  });
});
