"use client";

interface SelectedTasksPanelProps {
  selectedCount: number;
  onClear: () => void;
}

export function SelectedTasksPanel({
  selectedCount,
  onClear,
}: SelectedTasksPanelProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="mb-3 rounded-md border border-bordercl bg-surface px-3 py-2 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-foreground">
            {selectedCount} selected {selectedCount === 1 ? "task" : "tasks"}
          </h4>
          <p className="mt-0.5 text-xs text-foreground-muted">
            Drag selected tasks together to adjust times.{" "}
            <kbd className="rounded border border-bordercl bg-surface-inset px-1.5 py-0.5 font-mono text-[11px] text-foreground-secondary">
              Esc
            </kbd>{" "}
            clears selection.
          </p>
        </div>
        <button
          onClick={onClear}
          className="inline-flex items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
