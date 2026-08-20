export type ConfidenceLevel = "ready" | "review" | "blocked" | "unknown";

export interface ConfidenceDescriptor {
  level: ConfidenceLevel;
  label: string;
  description: string;
}

type ConfidenceStylePart =
  | "badge"
  | "dot"
  | "panel"
  | "text"
  | "border"
  | "button"
  | "subtleButton";

const CONFIDENCE_STYLES: Record<ConfidenceLevel, Record<ConfidenceStylePart, string>> = {
  ready: {
    badge:
      "bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800",
    dot: "bg-green-500",
    panel:
      "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/30 dark:border-green-800 dark:text-green-300",
    text: "text-green-700 dark:text-green-300",
    border: "border-green-300 dark:border-green-800",
    button:
      "bg-green-600 text-white hover:bg-green-700 focus:ring-green-500",
    subtleButton:
      "bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950/30 dark:text-green-300 dark:hover:bg-green-900/40",
  },
  review: {
    badge:
      "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800",
    dot: "bg-amber-500",
    panel:
      "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-300 dark:border-amber-800",
    button:
      "bg-amber-600 text-white hover:bg-amber-700 focus:ring-amber-500",
    subtleButton:
      "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-900/40",
  },
  blocked: {
    badge:
      "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800",
    dot: "bg-red-500",
    panel:
      "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-800 dark:text-red-300",
    text: "text-red-700 dark:text-red-300",
    border: "border-red-300 dark:border-red-800",
    button: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500",
    subtleButton:
      "bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-900/40",
  },
  unknown: {
    badge:
      "bg-surface-inset text-foreground-muted border border-bordercl dark:bg-surface-hover",
    dot: "bg-bordercl-strong",
    panel:
      "bg-surface-alt border-bordercl text-foreground-secondary dark:bg-surface-hover",
    text: "text-foreground-muted",
    border: "border-bordercl",
    button:
      "bg-slate-600 text-white hover:bg-slate-700 focus:ring-slate-500",
    subtleButton:
      "bg-surface-inset text-foreground-secondary hover:bg-surface-hover",
  },
};

/** Return Tailwind classes for one part of the shared confidence colour language. */
export function confidenceClasses(
  level: ConfidenceLevel,
  part: ConfidenceStylePart,
): string {
  return CONFIDENCE_STYLES[level][part];
}

/** Convert a project event status into a user-facing confidence state. */
export function getEventStatusConfidence(status?: string | null): ConfidenceDescriptor {
  switch (status) {
    case "published":
      return {
        level: "ready",
        label: "Published",
        description: "The project has been published.",
      };
    case "finalised":
      return {
        level: "ready",
        label: "Finalised",
        description: "The masterplan is ready to publish or review.",
      };
    case "optimised":
      return {
        level: "review",
        label: "Needs Review",
        description: "An optimised schedule exists and should be checked.",
      };
    case "draft":
      return {
        level: "unknown",
        label: "Draft",
        description: "The project is still being set up.",
      };
    default:
      return {
        level: "unknown",
        label: "Unknown",
        description: "The project status has not been set yet.",
      };
  }
}

/** Convert a publish-target set into a confidence state. */
export function getPublishTargetConfidence(
  target?: string | string[] | null,
): ConfidenceDescriptor {
  const targets = Array.isArray(target)
    ? target.filter((item) =>
        item === "google" || item === "mp-backend" || item === "pdf" || item === "excel",
      )
    : target === "both"
      ? ["google", "mp-backend"]
      : target && target !== "none"
        ? [target]
        : [];
  if (targets.length === 0) {
    return {
      level: "blocked",
      label: "Publish Target Missing",
      description: "Configure a publish target before publishing.",
    };
  }

  const labels = targets.map((item) => {
    if (item === "google") return "Google Calendar";
    if (item === "mp-backend") return "MP-Backend";
    if (item === "pdf") return "PDF";
    return "Excel workbook";
  });
  return {
    level: "ready",
    label: labels.join(", "),
    description: `Publishing is configured for ${labels.join(", ")}.`,
  };
}

/** Convert the CMI satisfiability check into the shared confidence language. */
export function getFlowCheckConfidence(
  status?: "checking" | "valid" | "invalid" | null,
): ConfidenceDescriptor {
  switch (status) {
    case "valid":
      return {
        level: "ready",
        label: "No Conflicts",
        description: "The current tasks are satisfiable.",
      };
    case "invalid":
      return {
        level: "blocked",
        label: "Conflicts",
        description: "Fix the listed bottlenecks before optimising.",
      };
    case "checking":
      return {
        level: "review",
        label: "Checking",
        description: "The flow check is currently running.",
      };
    default:
      return {
        level: "unknown",
        label: "Not Checked",
        description: "Run a flow check to confirm readiness.",
      };
  }
}

/** Convert an optimiser job status into the shared confidence language. */
export function getOptimisationConfidence(status?: string | null): ConfidenceDescriptor {
  switch (status) {
    case "completed":
      return {
        level: "ready",
        label: "Optimised",
        description: "An optimisation result exists for this day.",
      };
    case "failed":
      return {
        level: "blocked",
        label: "Failed",
        description: "The optimiser failed and needs attention.",
      };
    case "infeasible":
      return {
        level: "blocked",
        label: "Unsatisfiable",
        description: "The solver proved that the current requirements conflict.",
      };
    case "undetermined":
      return {
        level: "review",
        label: "Undetermined",
        description: "The solver stopped before proving feasibility.",
      };
    case "pending":
    case "running":
      return {
        level: "review",
        label: status === "pending" ? "Queued" : "Running",
        description: "Optimisation is still in progress.",
      };
    default:
      return {
        level: "unknown",
        label: "Not Run",
        description: "No optimisation result exists yet.",
      };
  }
}
