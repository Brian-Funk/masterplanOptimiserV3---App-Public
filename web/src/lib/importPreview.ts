import type {
  ImportPreviewSummary,
  ImportValidationIssue,
  ImportValidationResult,
} from "@/lib/api";

const emptySummary: ImportPreviewSummary = {
  peopleCount: 0,
  locationCount: 0,
  groupCount: 0,
  taskCount: 0,
  templateCount: 0,
  taskTypeCount: 0,
  assignmentCount: 0,
  hasOptimisedSchedule: false,
  hasFinalSchedule: false,
  hasPublishMetadata: false,
  hasAppSettings: false,
  importType: "unknown",
};

/** Build a blocking validation result when the selected file is not JSON. */
export function buildInvalidJsonImportValidation(
  message = "The selected file is not valid JSON.",
): ImportValidationResult {
  const error: ImportValidationIssue = {
    id: "invalid_json",
    severity: "error",
    title: "Invalid JSON",
    message,
  };
  return {
    isValid: false,
    errors: [error],
    warnings: [],
    info: [],
    summary: { ...emptySummary },
  };
}

/** Return whether the preview has blocking import errors. */
export function hasBlockingImportErrors(
  validation: ImportValidationResult | null,
): boolean {
  return Boolean(validation?.errors.length);
}

/** Format the main entity counts in an import preview summary. */
export function formatImportContents(summary: ImportPreviewSummary): string {
  const parts = [
    countPart(summary.peopleCount, "person", "people"),
    countPart(summary.locationCount, "location", "locations"),
    countPart(summary.groupCount, "group", "groups"),
    countPart(summary.taskCount, "task", "tasks"),
    countPart(summary.templateCount, "template", "templates"),
    countPart(summary.assignmentCount, "assignment", "assignments"),
  ].filter(Boolean);

  if (parts.length > 0) return parts.join(", ");
  if (summary.hasAppSettings) return "application settings";
  return "no recognised project records";
}

/** Derive a compact user-facing status for an import preview. */
export function getImportPreviewStatus(validation: ImportValidationResult) {
  if (validation.errors.length > 0) {
    return {
      level: "blocked" as const,
      title: "Cannot import",
      description: `${validation.errors.length} blocking ${plural(validation.errors.length, "error")} found.`,
    };
  }

  if (validation.warnings.length > 0) {
    return {
      level: "review" as const,
      title: "Review recommended",
      description: `${validation.warnings.length} ${plural(validation.warnings.length, "warning")} found.`,
    };
  }

  return {
    level: "ready" as const,
    title: "Ready to import",
    description: formatImportContents(validation.summary),
  };
}

/** Return the action label for the current import contents. */
export function getImportActionLabel(summary: ImportPreviewSummary): string {
  if (summary.taskCount > 0 || summary.projectName || summary.eventName) {
    return "Import as new project";
  }
  return "Import application settings";
}

function countPart(count: number, singular: string, pluralLabel: string) {
  if (!count) return null;
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function plural(count: number, singular: string) {
  return count === 1 ? singular : `${singular}s`;
}
