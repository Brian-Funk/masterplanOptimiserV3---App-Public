"use client";

interface SelectedTasksPanelProps {
  selectedCount: number;
  onClear: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport?: () => void;
  exportDisabled?: boolean;
  customActions?: React.ReactNode;
  customHints?: React.ReactNode;
}

export function SelectedTasksPanel({
  selectedCount,
  onClear,
  onDuplicate,
  onDelete,
  onExport,
  exportDisabled = false,
  customActions,
  customHints,
}: SelectedTasksPanelProps) {
  if (selectedCount === 0) return null;

  const actionButton =
    "inline-flex items-center justify-center rounded-md border border-bordercl px-2.5 py-1 text-xs font-medium text-foreground-secondary transition-colors hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed";
  const dangerButton =
    "inline-flex items-center justify-center rounded-md border border-transparent px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30";
  const keyClass =
    "rounded border border-bordercl bg-surface-inset px-1.5 py-0.5 font-mono text-[11px] text-foreground-secondary";

  return (
    <div className="mb-3 rounded-md border border-bordercl bg-surface px-3 py-2 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-foreground">
            {selectedCount} selected {selectedCount === 1 ? "task" : "tasks"}
          </h4>
          {customHints ? (
            customHints
          ) : (
            <p className="mt-0.5 text-xs text-foreground-muted">
              Press <kbd className={keyClass}>D</kbd> to duplicate,{" "}
              <kbd className={keyClass}>Delete</kbd> to delete.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={onClear}
            className="inline-flex items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            Clear
          </button>
          {customActions ? (
            customActions
          ) : (
            <>
              <button onClick={onDuplicate} className={actionButton}>
                Duplicate
              </button>
              {onExport && (
                <button
                  onClick={onExport}
                  disabled={exportDisabled}
                  className={actionButton}
                >
                  Export to day
                </button>
              )}
              <button onClick={onDelete} className={dangerButton}>
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
