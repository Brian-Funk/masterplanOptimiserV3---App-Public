"use client";

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ImportValidationIssue, ImportValidationResult } from "@/lib/api";
import {
  formatImportContents,
  getImportActionLabel,
  getImportPreviewStatus,
  hasBlockingImportErrors,
} from "@/lib/importPreview";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";

export interface ImportPreviewModalProps {
  open: boolean;
  fileName?: string;
  validation: ImportValidationResult | null;
  importing?: boolean;
  onCancel: () => void;
  onChooseAnother?: () => void;
  onConfirm: () => void;
}

const statusClasses = {
  ready: {
    icon: CheckCircle2,
    wrap: "border-green-200 bg-green-50 text-green-800 dark:border-green-900/60 dark:bg-green-950/25 dark:text-green-200",
  },
  review: {
    icon: AlertTriangle,
    wrap: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200",
  },
  blocked: {
    icon: XCircle,
    wrap: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-200",
  },
};

/** Render the import preview and confirmation step before data is changed. */
export function ImportPreviewModal({
  open,
  fileName,
  validation,
  importing = false,
  onCancel,
  onChooseAnother,
  onConfirm,
}: ImportPreviewModalProps) {
  const status = validation ? getImportPreviewStatus(validation) : null;
  const StatusIcon = status ? statusClasses[status.level].icon : Info;
  const canImport = validation && !hasBlockingImportErrors(validation);
  const summary = validation?.summary;

  return (
    <Modal open={open} onClose={onCancel} maxWidth="2xl">
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Import preview
            </h2>
            <p className="mt-1 text-sm text-foreground-muted">
              Review what this file contains before applying any changes.
            </p>
          </div>
          {fileName && (
            <span className="max-w-[220px] truncate rounded-md bg-surface-hover px-2 py-1 text-xs text-foreground-muted">
              {fileName}
            </span>
          )}
        </div>

        {status && summary ? (
          <div className="mt-5 space-y-5">
            <div
              className={`rounded-lg border px-4 py-3 ${statusClasses[status.level].wrap}`}
            >
              <div className="flex items-start gap-3">
                <StatusIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold">{status.title}</p>
                  <p className="mt-0.5 text-sm opacity-90">
                    {status.description}
                  </p>
                </div>
              </div>
            </div>

            <section>
              <h3 className="text-sm font-semibold text-foreground">
                Summary
              </h3>
              <div className="mt-2 rounded-lg border border-bordercl bg-surface-alt p-4 text-sm text-foreground-secondary">
                {summary.projectName && (
                  <p>
                    <span className="text-foreground-muted">Project:</span>{" "}
                    <span className="font-medium text-foreground">
                      {summary.projectName}
                    </span>
                  </p>
                )}
                {summary.dateRange && (
                  <p className="mt-1">
                    <span className="text-foreground-muted">Dates:</span>{" "}
                    {summary.dateRange}
                  </p>
                )}
                <p className="mt-1">
                  <span className="text-foreground-muted">
                    This file contains:
                  </span>{" "}
                  {formatImportContents(summary)}.
                </p>
                <p className="mt-2 text-xs text-foreground-muted">
                  {summary.taskCount > 0 || summary.projectName
                    ? "This will create imported project data after you confirm."
                    : "This will import application settings after you confirm."}
                </p>
              </div>
            </section>

            <DataBreakdown validation={validation} />
            <IssueSection title="Blocking errors" issues={validation.errors} />
            <IssueSection title="Warnings" issues={validation.warnings} />
            <IssueSection title="Notes" issues={validation.info} />
          </div>
        ) : (
          <div className="mt-6 flex items-center gap-2 text-sm text-foreground-muted">
            <Spinner size="sm" />
            Validating import file...
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-bordercl pt-4">
          <Button variant="secondary" onClick={onCancel} disabled={importing}>
            Cancel
          </Button>
          {onChooseAnother && (
            <Button
              variant="secondary"
              onClick={onChooseAnother}
              disabled={importing}
            >
              Choose another file
            </Button>
          )}
          <Button onClick={onConfirm} disabled={!canImport || importing}>
            {importing ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Importing...
              </>
            ) : summary ? (
              getImportActionLabel(summary)
            ) : (
              "Import"
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DataBreakdown({
  validation,
}: {
  validation: ImportValidationResult;
}) {
  const summary = validation.summary;
  const rows = [
    ["People", summary.peopleCount],
    ["Locations", summary.locationCount],
    ["Groups", summary.groupCount],
    ["Tasks", summary.taskCount],
    ["Task templates", summary.templateCount],
    ["Task types", summary.taskTypeCount],
    ["Assignments", summary.assignmentCount],
  ] as const;

  return (
    <section>
      <h3 className="text-sm font-semibold text-foreground">
        Data breakdown
      </h3>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {rows.map(([label, count]) => (
          <div
            key={label}
            className="rounded-lg border border-bordercl bg-surface px-3 py-2"
          >
            <p className="text-xs text-foreground-muted">{label}</p>
            <p className="text-base font-semibold text-foreground">{count}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-foreground-muted">
        <InclusionPill
          included={summary.hasOptimisedSchedule}
          label="Optimised schedule"
        />
        <InclusionPill included={summary.hasFinalSchedule} label="Final schedule" />
        <InclusionPill
          included={summary.hasPublishMetadata}
          label="Publish metadata"
        />
        <InclusionPill
          included={summary.hasAppSettings}
          label="Application settings"
        />
      </div>
    </section>
  );
}

function InclusionPill({
  included,
  label,
}: {
  included: boolean;
  label: string;
}) {
  return (
    <span className="rounded-full bg-surface-hover px-2 py-1">
      {label}: {included ? "included" : "not included"}
    </span>
  );
}

function IssueSection({
  title,
  issues,
}: {
  title: string;
  issues: ImportValidationIssue[];
}) {
  if (!issues.length) return null;

  return (
    <section>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-2 space-y-2">
        {issues.map((issue, index) => (
          <div
            key={`${issue.id}-${issue.path || index}`}
            className="rounded-lg border border-bordercl bg-surface px-3 py-2 text-sm"
          >
            <div className="flex items-start gap-2">
              <span
                className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${
                  issue.severity === "error"
                    ? "bg-red-500"
                    : issue.severity === "warning"
                      ? "bg-amber-500"
                      : "bg-slate-400"
                }`}
              />
              <div>
                <p className="font-medium text-foreground">{issue.title}</p>
                <p className="text-foreground-muted">{issue.message}</p>
                {issue.path && (
                  <p className="mt-1 font-mono text-xs text-foreground-faint">
                    {issue.path}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
