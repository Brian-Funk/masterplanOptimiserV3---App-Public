export type AllDaysFlowState =
  | "pending"
  | "checking"
  | "passed"
  | "failed"
  | "skipped";

export type AllDaysOptimisationState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export interface AllDaysStep {
  date: string;
  label: string;
  flow: AllDaysFlowState;
  optimisation: AllDaysOptimisationState;
  detail?: string;
}

export interface FlowSequenceResult {
  status: "passed" | "failed" | "skipped";
  detail?: string;
}

export interface OptimisationSequenceResult {
  status: "succeeded" | "failed";
  detail?: string;
}

function addCalendarDay(date: string): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/** Build the inclusive, ordered event-day sequence used by bulk optimisation. */
export function buildAllDaysSteps(
  startDate: string,
  endDate: string,
  getLabel: (date: string) => string,
): AllDaysStep[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || startDate > endDate) return [];
  const steps: AllDaysStep[] = [];
  let date = startDate;
  while (date <= endDate) {
    steps.push({
      date,
      label: getLabel(date),
      flow: "pending",
      optimisation: "pending",
    });
    date = addCalendarDay(date);
  }
  return steps;
}

function replaceStep(
  steps: AllDaysStep[],
  date: string,
  patch: Partial<AllDaysStep>,
): AllDaysStep[] {
  return steps.map((step) => (step.date === date ? { ...step, ...patch } : step));
}

/** Run one full flow check and, only when it passes, one optimisation per day. */
export async function runAllDaysSequence({
  initialSteps,
  checkFlow,
  optimise,
  onChange,
}: {
  initialSteps: AllDaysStep[];
  checkFlow: (date: string) => Promise<FlowSequenceResult>;
  optimise: (date: string) => Promise<OptimisationSequenceResult>;
  onChange: (steps: AllDaysStep[]) => void;
}): Promise<AllDaysStep[]> {
  let steps = initialSteps.map((step) => ({ ...step }));
  onChange(steps);

  for (const day of initialSteps) {
    steps = replaceStep(steps, day.date, {
      flow: "checking",
      optimisation: "pending",
      detail: undefined,
    });
    onChange(steps);

    const flow = await checkFlow(day.date);
    if (flow.status !== "passed") {
      steps = replaceStep(steps, day.date, {
        flow: flow.status,
        optimisation: "skipped",
        detail: flow.detail,
      });
      onChange(steps);
      continue;
    }

    steps = replaceStep(steps, day.date, {
      flow: "passed",
      optimisation: "running",
      detail: undefined,
    });
    onChange(steps);

    const result = await optimise(day.date);
    steps = replaceStep(steps, day.date, {
      optimisation: result.status,
      detail: result.detail,
    });
    onChange(steps);
  }

  return steps;
}

export function summariseAllDaysSteps(steps: AllDaysStep[]) {
  return {
    succeeded: steps.filter((step) => step.optimisation === "succeeded").length,
    flowFailed: steps.filter((step) => step.flow === "failed").length,
    skipped: steps.filter((step) => step.flow === "skipped").length,
    optimisationFailed: steps.filter((step) => step.optimisation === "failed").length,
  };
}
