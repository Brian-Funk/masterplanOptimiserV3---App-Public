"use client";

import { Modal, Spinner } from "@/components/ui";
import type { AllDaysStep } from "@/lib/allDaysOptimization";
import { summariseAllDaysSteps } from "@/lib/allDaysOptimization";

function StepIcon({ step }: { step: AllDaysStep }) {
  if (step.flow === "checking" || step.optimisation === "running") {
    return <Spinner size="sm" className="border-white/40 border-t-white" />;
  }
  if (step.optimisation === "succeeded") return <span aria-hidden="true">✓</span>;
  if (step.flow === "failed" || step.optimisation === "failed") {
    return <span aria-hidden="true">!</span>;
  }
  if (step.flow === "skipped" || step.optimisation === "skipped") {
    return <span aria-hidden="true">–</span>;
  }
  return <span aria-hidden="true">•</span>;
}

function circleClasses(step: AllDaysStep): string {
  if (step.flow === "checking") return "border-blue-600 bg-blue-600 text-white";
  if (step.optimisation === "running") return "border-purple-600 bg-purple-600 text-white";
  if (step.optimisation === "succeeded") return "border-green-600 bg-green-600 text-white";
  if (step.flow === "failed" || step.optimisation === "failed") {
    return "border-red-600 bg-red-600 text-white";
  }
  if (step.flow === "skipped" || step.optimisation === "skipped") {
    return "border-amber-500 bg-amber-500 text-white";
  }
  return "border-bordercl-strong bg-surface text-foreground-muted";
}

function statusLabel(step: AllDaysStep): string {
  if (step.flow === "checking") return "Checking flow";
  if (step.flow === "failed") return "Flow failed · skipped";
  if (step.flow === "skipped") return "No tasks · skipped";
  if (step.optimisation === "running") return "Flow passed · optimising";
  if (step.optimisation === "succeeded") return "Flow passed · optimised";
  if (step.optimisation === "failed") return "Flow passed · optimisation failed";
  if (step.flow === "passed") return "Flow passed";
  return "Waiting";
}

export function OptimiseAllDaysModal({
  open,
  running,
  steps,
  onClose,
}: {
  open: boolean;
  running: boolean;
  steps: AllDaysStep[];
  onClose: () => void;
}) {
  const summary = summariseAllDaysSteps(steps);
  const activeIndex = steps.findIndex(
    (step) => step.flow === "checking" || step.optimisation === "running",
  );

  return (
    <Modal open={open} onClose={running ? () => {} : onClose} maxWidth="4xl">
      <div className="space-y-6 p-6" role="dialog" aria-modal="true" aria-labelledby="optimise-all-title">
        <div>
          <h3 id="optimise-all-title" className="text-xl font-semibold text-foreground">
            Optimise all days
          </h3>
          <p className="mt-1 text-sm text-foreground-muted" aria-live="polite">
            {running
              ? `Working from left to right${activeIndex >= 0 ? ` · day ${activeIndex + 1} of ${steps.length}` : ""}. A day with a failed flow check is skipped.`
              : `${summary.succeeded} of ${steps.length} days optimised.`}
          </p>
        </div>

        <div className="overflow-x-auto pb-2">
          <div className="relative min-w-max px-4">
            <div className="absolute left-12 right-12 top-5 h-0.5 bg-bordercl" aria-hidden="true" />
            <ol className="relative flex items-start" aria-label="All-day optimisation progress">
              {steps.map((step, index) => (
                <li className="relative z-10 w-40 px-2 text-center" key={step.date}>
                  <div
                    className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-bold ${circleClasses(step)}`}
                    aria-label={`${step.label}: ${statusLabel(step)}`}
                  >
                    <StepIcon step={step} />
                  </div>
                  <p className="mt-3 text-sm font-medium text-foreground">{step.label}</p>
                  <p className="mt-1 text-xs text-foreground-muted">{statusLabel(step)}</p>
                  {step.detail && (
                    <p className="mt-1 line-clamp-3 text-xs text-foreground-secondary" title={step.detail}>
                      {step.detail}
                    </p>
                  )}
                  <span className="sr-only">Step {index + 1} of {steps.length}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {!running && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-bordercl pt-4">
            <p className="text-sm text-foreground-muted">
              {summary.flowFailed + summary.skipped > 0
                ? `${summary.flowFailed + summary.skipped} day(s) skipped before optimisation.`
                : "Every day passed its flow check."}
              {summary.optimisationFailed > 0
                ? ` ${summary.optimisationFailed} optimisation(s) failed.`
                : ""}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
