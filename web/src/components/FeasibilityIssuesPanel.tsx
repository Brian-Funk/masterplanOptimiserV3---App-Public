"use client";

import type { FeasibilityDiagnostics } from "@/types/optimization";

interface FeasibilityIssuesPanelProps {
  diagnostics?: FeasibilityDiagnostics | null;
  className?: string;
}

/**
 * Show a concise feasibility summary with expandable evidence and remedies.
 */
export function FeasibilityIssuesPanel({
  diagnostics,
  className = "",
}: FeasibilityIssuesPanelProps) {
  if (!diagnostics || diagnostics.issues.length === 0) return null;

  return (
    <section
      className={`rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-950/30 ${className}`}
      aria-label="Schedule feasibility problems"
    >
      <p className="text-sm font-semibold text-red-900 dark:text-red-300">
        {diagnostics.summary}
      </p>
      {diagnostics.checked_scope === "fixed_tasks" && (
        <p className="mt-1 text-xs text-red-700 dark:text-red-400">
          Floating tasks were not included in this quick check.
        </p>
      )}
      <div className="mt-2 space-y-2">
        {diagnostics.issues.map((issue, index) => (
          <details
            key={`${issue.code}-${index}`}
            className="rounded border border-red-200 bg-surface px-3 py-2 dark:border-red-900/60"
          >
            <summary className="cursor-pointer select-none text-sm font-medium text-foreground">
              {issue.message}
            </summary>
            <div className="mt-2 space-y-2 text-xs text-foreground-muted">
              {issue.facts.length > 0 && (
                <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                  {issue.facts.map((fact, factIndex) => (
                    <div key={`${fact.label}-${factIndex}`} className="contents">
                      <dt className="font-medium text-foreground-secondary">
                        {fact.label}
                      </dt>
                      <dd>{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {issue.suggestions.length > 0 && (
                <div>
                  <p className="font-medium text-foreground-secondary">
                    What to review
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {issue.suggestions.map((suggestion, suggestionIndex) => (
                      <li key={suggestionIndex}>{suggestion}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
