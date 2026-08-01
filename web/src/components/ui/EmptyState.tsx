import React from "react";

/** Props for an actionable, low-emphasis empty state. */
export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** Render a calm empty state with at most one primary next action. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex min-h-52 flex-col items-center justify-center px-8 py-12 text-center ${className}`}
    >
      {icon && (
        <div className="mb-4 text-foreground-faint" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1 max-w-md text-sm leading-6 text-foreground-muted">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
