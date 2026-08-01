"use client";

import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { formatDateShort } from "@/lib/dateFormat";
import type { CopiedTaskDateRepairPreview } from "@/lib/api";

/** Props for the controlled copied-task date repair preview. */
export interface CopiedTaskDateRepairModalProps {
  preview: CopiedTaskDateRepairPreview | null;
  selectedTaskIds: number[];
  repairing?: boolean;
  onToggleTask: (taskInstanceId: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Render a controlled preview for repairing copied task skeleton dates. */
export function CopiedTaskDateRepairModal({
  preview,
  selectedTaskIds,
  repairing = false,
  onToggleTask,
  onCancel,
  onConfirm,
}: CopiedTaskDateRepairModalProps) {
  return (
    <Modal
      open={preview !== null}
      onClose={repairing ? () => {} : onCancel}
      maxWidth="lg"
    >
      <div className="p-6">
        <div className="flex items-start gap-3">
          <Wrench className="mt-0.5 h-5 w-5 text-blue-600" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Repair copied task dates
            </h2>
            <p className="mt-1 text-sm text-foreground-muted">
              Review unscheduled task skeletons that still use dates from the
              selected source project.
            </p>
          </div>
        </div>

        {preview?.candidates.length === 0 ? (
          <div className="mt-5 rounded-lg border border-bordercl bg-surface-alt p-4 text-sm text-foreground-muted">
            No matching copied task dates need repair.
          </div>
        ) : (
          <div className="mt-5 max-h-80 divide-y divide-bordercl overflow-y-auto rounded-lg border border-bordercl">
            {preview?.candidates.map((candidate) => (
              <label
                key={candidate.task_instance_id}
                className="flex items-start gap-3 bg-surface px-4 py-3"
              >
                <input
                  type="checkbox"
                  className="mt-1 rounded text-blue-600"
                  checked={selectedTaskIds.includes(candidate.task_instance_id)}
                  disabled={!candidate.repairable || repairing}
                  onChange={() => onToggleTask(candidate.task_instance_id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {candidate.name}
                  </span>
                  {candidate.repairable && candidate.proposed_date ? (
                    <span className="mt-0.5 block text-xs text-foreground-muted">
                      {formatDateShort(candidate.current_date)} to{" "}
                      {formatDateShort(candidate.proposed_date)}
                    </span>
                  ) : (
                    <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-300">
                      {candidate.reason || "This task cannot be repaired safely."}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-bordercl pt-4">
          <Button variant="secondary" onClick={onCancel} disabled={repairing}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={repairing || selectedTaskIds.length === 0}
          >
            {repairing ? (
              <>
                <Spinner size="sm" className="mr-2" /> Repairing...
              </>
            ) : (
              `Repair ${selectedTaskIds.length} ${
                selectedTaskIds.length === 1 ? "task date" : "task dates"
              }`
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
