"use client";

import React from "react";
import { ArrowLeft, Clock3, MapPin, Users } from "lucide-react";
import type { CalendarTask } from "@/components/Calendar";
import type { Person, TaskTemplate } from "@/lib/api";

interface PresentSlideProps {
  task: CalendarTask;
  slideIndex: number;
  totalSlides: number;
  persons?: Person[];
  templates?: TaskTemplate[];
  onBack?: () => void;
}

/** Render a clean single-task detail slide for presentation mode. */
export default function PresentSlide({
  task,
  slideIndex,
  totalSlides,
  persons = [],
  templates = [],
  onBack,
}: PresentSlideProps) {
  const color = task.task_type_color || "#3b82f6";
  const fieldValues: Record<string, any> = task.fields || {};
  const fieldDefs: any[] = task.field_definitions || [];
  const template = templates.find((t) => t.id === (task as any).templateId);
  const fieldAssignments: Record<string, number[]> | null =
    (task as any).field_assignments || null;
  const assignedPersonIds: number[] = (task as any).assigned_persons || [];

  const resolvePerson = (pid: number) => persons.find((p) => p.id === pid);

  const personGroups: {
    label: string;
    persons: Array<{
      id: number;
      first_name: string;
      last_name: string;
      excluded?: boolean;
      tooltip?: string;
    }>;
  }[] = [];
  if (
    fieldAssignments &&
    Object.keys(fieldAssignments).length > 0 &&
    template?.fields
  ) {
    const fieldIds = Array.from(
      new Set([
        ...Object.keys(fieldAssignments || {}),
        ...Object.keys((task as any).field_assignment_exclusions || {}),
      ]),
    );
    for (const fieldId of fieldIds) {
      const pids = fieldAssignments?.[fieldId] || [];
      const fieldDef = template.fields.find((f: any) => f.id === fieldId);
      const label =
        fieldDef?.name || fieldId.replace(/^field_/, "").replace(/_/g, " ");
      const resolved = (pids as number[])
        .map(resolvePerson)
        .filter(Boolean) as Array<Person & { excluded?: boolean; tooltip?: string }>;
      const excluded = ((task as any).field_assignment_exclusions?.[fieldId] || [])
        .map((item: any) => {
          const person = resolvePerson(item.person_id);
          if (!person) return null;
          const range =
            item.unavailable_from && item.unavailable_to
              ? ` (${item.unavailable_from} - ${item.unavailable_to})`
              : "";
          return {
            ...person,
            excluded: true,
            tooltip: `Unavailable during this task${range}`,
          };
        })
        .filter(Boolean) as Array<Person & { excluded: boolean; tooltip: string }>;
      resolved.push(...excluded);
      if (resolved.length > 0) {
        personGroups.push({ label, persons: resolved });
      }
    }
  } else if (assignedPersonIds.length > 0) {
    const resolved = assignedPersonIds
      .map(resolvePerson)
      .filter(Boolean) as Person[];
    if (resolved.length > 0) {
      personGroups.push({ label: "Assigned", persons: resolved });
    }
  }

  const linkFields: { label: string; url: string }[] = [];
  const dataFields: { label: string; value: string }[] = [];

  for (const def of fieldDefs) {
    const raw = fieldValues[def.id];
    if (raw === undefined || raw === null || raw === "") continue;

    switch (def.type) {
      case "link": {
        const url = typeof raw === "object" && raw?.url ? raw.url : String(raw);
        if (url) linkFields.push({ label: def.name || def.id, url });
        break;
      }
      case "number":
      case "text": {
        const val =
          typeof raw === "object" && raw?.value !== undefined
            ? String(raw.value)
            : String(raw);
        if (val) dataFields.push({ label: def.name || def.id, value: val });
        break;
      }
      case "duration": {
        const val =
          typeof raw === "object" && raw?.value !== undefined ? raw.value : raw;
        if (val)
          dataFields.push({ label: def.name || def.id, value: `${val} min` });
        break;
      }
      default:
        break;
    }
  }

  return (
    <div
      className="flex max-h-full flex-col overflow-hidden rounded-xl border border-bordercl-subtle bg-surface shadow-sm"
      data-testid="presentation-detail-slide"
    >
      <div
        className="flex items-start gap-5 px-8 pb-6 pt-7"
        style={{ borderTop: `3px solid ${color}` }}
      >
        {onBack && (
          <button
            onClick={onBack}
            className="mt-1 flex-shrink-0 rounded-lg p-2 text-foreground-muted transition-colors hover:bg-surface-hover"
            title="Back to overview (Esc)"
            aria-label="Back to overview"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}

        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-foreground-muted">
            <span className="inline-flex items-center gap-2 font-medium" style={{ color }}>
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              {task.task_type_name}
            </span>
            {task.start_end_time && (
              <span className="inline-flex items-center gap-1.5 font-mono text-foreground-secondary">
                <Clock3 className="h-4 w-4 text-foreground-faint" />
                {task.start_end_time.start} - {task.start_end_time.end}
              </span>
            )}
            {task.location_name && (
              <span className="inline-flex items-center gap-1.5 text-foreground-secondary">
                <MapPin className="h-4 w-4 text-foreground-faint" />
                {task.location_name}
              </span>
            )}
          </div>

          <h1 className="max-w-4xl text-4xl font-semibold leading-tight tracking-normal text-foreground">
            {task.name}
          </h1>
        </div>

        <span className="mt-2 flex-shrink-0 text-xs text-foreground-faint">
          {slideIndex + 1}/{totalSlides}
        </span>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-8 pb-8">
        {personGroups.length > 0 && (
          <section>
            <h3 className="mb-3 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-foreground-muted">
              <Users className="h-3.5 w-3.5" />
              People
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {personGroups.map((group, i) => {
                const isLarge = group.persons.length > 3;
                return (
                  <div
                    key={`${group.label}-${i}`}
                    className={`rounded-lg border border-bordercl-subtle bg-surface-alt/70 px-4 py-3 ${
                      isLarge ? "col-span-3" : ""
                    }`}
                  >
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-foreground-faint">
                      {group.label}
                    </div>
                    <div
                      className="gap-x-8 gap-y-1"
                      style={{
                        columns: isLarge
                          ? Math.min(2, Math.ceil(group.persons.length / 4))
                          : 1,
                      }}
                    >
                      {group.persons.map((p) => (
                        <div
                          key={`${p.id}-${p.excluded ? "excluded" : "active"}`}
                          className={`break-inside-avoid text-base leading-relaxed ${
                            p.excluded
                              ? "text-red-600 line-through opacity-75 dark:text-red-300"
                              : "text-foreground-secondary"
                          }`}
                          title={p.tooltip}
                        >
                          {p.first_name} {p.last_name}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {linkFields.length > 0 && (
          <section>
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-foreground-muted">
              Links
            </h3>
            <div className="flex flex-wrap gap-3">
              {linkFields.map((f, i) => (
                <a
                  key={`${f.label}-${i}`}
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-bordercl-subtle bg-surface-alt/70 px-3 py-2 text-sm text-blue-600 transition-colors hover:bg-surface-hover hover:underline dark:text-blue-400"
                  title={f.url}
                >
                  {f.label}
                </a>
              ))}
            </div>
          </section>
        )}

        {dataFields.length > 0 && (
          <section>
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-foreground-muted">
              Details
            </h3>
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              }}
            >
              {dataFields.map((f, i) => (
                <div
                  key={`${f.label}-${i}`}
                  className="rounded-lg border border-bordercl-subtle bg-surface-alt/70 px-4 py-3"
                >
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-foreground-faint">
                    {f.label}
                  </div>
                  <div className="whitespace-pre-wrap text-base leading-relaxed text-foreground-secondary">
                    {f.value}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {personGroups.length === 0 &&
          linkFields.length === 0 &&
          dataFields.length === 0 && (
            <div className="rounded-lg border border-bordercl-subtle bg-surface-alt/60 px-4 py-5 text-sm text-foreground-muted">
              No additional task details are available.
            </div>
          )}
      </div>
    </div>
  );
}
