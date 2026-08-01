"use client";

import { AlertTriangle, CheckCircle2, Info, Send, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import type {
  DayPublishPreview,
  PublishPreview,
} from "@/lib/publishPreview";
import { formatStatusTimestamp } from "@/lib/statusTimestamps";

export interface PublishPreviewModalProps {
  open: boolean;
  preview: PublishPreview | null;
  publishing?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const statusTone: Record<
  DayPublishPreview["status"],
  { label: string; dot: string; text: string }
> = {
  ready: {
    label: "Ready",
    dot: "bg-emerald-500",
    text: "text-foreground-secondary",
  },
  up_to_date: {
    label: "Up to date",
    dot: "bg-emerald-500",
    text: "text-foreground-secondary",
  },
  changes_pending: {
    label: "Changes pending",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-300",
  },
  not_ready: {
    label: "Not ready",
    dot: "bg-slate-400",
    text: "text-foreground-muted",
  },
  no_publishable_tasks: {
    label: "No publishable tasks",
    dot: "bg-slate-400",
    text: "text-foreground-muted",
  },
  has_conflicts: {
    label: "Conflicts",
    dot: "bg-red-500",
    text: "text-red-700 dark:text-red-300",
  },
  skipped: {
    label: "Skipped",
    dot: "bg-slate-400",
    text: "text-foreground-muted",
  },
  failed: {
    label: "Failed",
    dot: "bg-red-500",
    text: "text-red-700 dark:text-red-300",
  },
};

/** Render the confirmation preview shown before publishing externally. */
export function PublishPreviewModal({
  open,
  preview,
  publishing = false,
  onCancel,
  onConfirm,
}: PublishPreviewModalProps) {
  const [showDetails, setShowDetails] = useState(true);
  const hasBlockingReasons = Boolean(preview?.blockingReasons.length);
  const hasWarnings = Boolean(preview?.warnings.length);
  const HeaderIcon = hasBlockingReasons
    ? XCircle
    : hasWarnings
      ? AlertTriangle
      : CheckCircle2;
  const headerTone = hasBlockingReasons
    ? "text-red-600 dark:text-red-300"
    : hasWarnings
      ? "text-amber-600 dark:text-amber-300"
      : "text-emerald-600 dark:text-emerald-300";

  return (
    <Modal open={open} onClose={publishing ? () => {} : onCancel} maxWidth="2xl">
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-start gap-3">
          <HeaderIcon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${headerTone}`} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-foreground">
              Preview publish
            </h2>
            <p className="mt-1 text-sm text-foreground-secondary">
              {preview?.summary ?? "Preparing publish preview..."}
            </p>
          </div>
        </div>

        {preview ? (
          <div className="mt-5 space-y-5">
            <SummaryGrid preview={preview} />

            <p className="rounded-lg border border-bordercl bg-surface-alt px-4 py-3 text-sm text-foreground-secondary">
              {preview.explanation}
            </p>

            {preview.blockingReasons.length > 0 && (
              <MessageList
                tone="blocked"
                title="Cannot publish yet"
                items={preview.blockingReasons}
              />
            )}

            {preview.warnings.length > 0 && (
              <MessageList
                tone="review"
                title="Review before publishing"
                items={preview.warnings}
              />
            )}

            <section>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Day details
                </h3>
                <button
                  type="button"
                  onClick={() => setShowDetails((value) => !value)}
                  className="text-xs text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
                >
                  {showDetails ? "Hide details" : "Show details"}
                </button>
              </div>
              {showDetails && (
                <div className="mt-2 divide-y divide-bordercl rounded-lg border border-bordercl bg-surface">
                  {preview.days.map((day) => (
                    <DayRow key={day.dayId} day={day} />
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="mt-6 flex items-center gap-2 text-sm text-foreground-muted">
            <Spinner size="sm" />
            Preparing publish preview...
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-bordercl pt-4">
          <Button variant="secondary" onClick={onCancel} disabled={publishing}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!preview?.canPublish || publishing}
          >
            {publishing ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Publishing...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                {preview?.actionLabel ?? "Publish"}
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SummaryGrid({ preview }: { preview: PublishPreview }) {
  const warningText =
    preview.blockingReasons.length > 0
      ? `${preview.blockingReasons.length} blocked`
      : preview.warnings.length > 0
        ? `${preview.warnings.length} warning${preview.warnings.length === 1 ? "" : "s"}`
        : "None";
  const rows = [
    ["Destination", preview.targetLabel],
    ["Scope", preview.scopeLabel],
    [
      "Tasks",
      `${preview.totalTasksToPublish} ${
        preview.totalTasksToPublish === 1 ? "task" : "tasks"
      }`,
    ],
    ["Warnings", warningText],
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="rounded-lg border border-bordercl bg-surface px-3 py-2"
        >
          <p className="text-xs text-foreground-muted">{label}</p>
          <p className="mt-0.5 truncate text-sm font-medium text-foreground">
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}

function DayRow({ day }: { day: DayPublishPreview }) {
  const tone = statusTone[day.status];
  const taskText = `${day.taskCount} ${day.taskCount === 1 ? "task" : "tasks"}`;
  const editText =
    day.manualEditCount > 0
      ? `${day.manualEditCount} ${day.manualEditCount === 1 ? "edit" : "edits"}`
      : null;
  const conflictText =
    day.conflictCount > 0
      ? `${day.conflictCount} ${
          day.conflictCount === 1 ? "conflict" : "conflicts"
        }`
      : null;
  const publishedText = formatStatusTimestamp(day.lastPublishedAt);
  const meta = [
    taskText,
    editText,
    conflictText,
    publishedText ? `published ${publishedText}` : null,
  ].filter(Boolean);

  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{day.dayLabel}</p>
        <p className="mt-0.5 text-xs text-foreground-muted">
          {meta.join(" / ")}
        </p>
        {day.reason && (
          <p className="mt-1 text-xs text-foreground-muted">{day.reason}</p>
        )}
      </div>
      <div className={`flex flex-shrink-0 items-center gap-2 text-xs ${tone.text}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
        <span>{day.willPublish ? tone.label : `${tone.label} - skipped`}</span>
      </div>
    </div>
  );
}

function MessageList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "blocked" | "review";
}) {
  const Icon = tone === "blocked" ? XCircle : Info;
  const classes =
    tone === "blocked"
      ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200"
      : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200";

  return (
    <section className={`rounded-lg border px-4 py-3 ${classes}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <ul className="mt-1 space-y-1 text-sm opacity-90">
            {items.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
