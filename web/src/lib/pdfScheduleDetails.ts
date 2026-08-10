import type { CalendarTask } from "@/components/Calendar";

export interface PdfTaskField {
  label: string;
  value: string;
}

export interface PdfTaskDetail {
  reference: string;
  title: string;
  taskType: string;
  colour: string;
  time: string;
  location: string;
  allocations: string[];
  fields: PdfTaskField[];
}

export interface PdfDayTaskModel {
  tasks: CalendarTask[];
  details: PdfTaskDetail[];
}

const OMITTED_FIELD_TYPES = new Set([
  "persons_list",
  "capabilities_list",
  "location",
  "time",
]);

function scalarDisplayValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return "";
}

function objectDisplayValue(value: Record<string, unknown>): string {
  const label = scalarDisplayValue(value.label) || scalarDisplayValue(value.name);
  const url = scalarDisplayValue(value.url);
  if (label && url && label !== url) return `${label} - ${url}`;
  if (url) return url;
  if (label) return label;
  return scalarDisplayValue(value.value);
}

/** Convert a user-facing operational field value without serialising raw objects. */
export function formatPdfFieldValue(value: unknown): string {
  if (value == null) return "";
  const scalar = scalarDisplayValue(value);
  if (scalar) return scalar;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          return objectDisplayValue(item as Record<string, unknown>);
        }
        return scalarDisplayValue(item);
      })
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    return objectDisplayValue(value as Record<string, unknown>);
  }
  return "";
}

function taskTime(task: CalendarTask): string {
  if (task.time_range) return `${task.time_range.start} - ${task.time_range.end}`;
  if (task.start_end_time) {
    return `${task.start_end_time.start} - ${task.start_end_time.end}`;
  }
  return task.time || "Not scheduled";
}

function taskSortKey(task: CalendarTask, originalIndex: number): string {
  const start =
    task.start_end_time?.start || task.time_range?.start || task.time || "99:99";
  return `${task.date || "9999-99-99"}T${start}:${String(originalIndex).padStart(5, "0")}`;
}

function allocationLines(task: CalendarTask): string[] {
  const summary = typeof task.resource_info === "string" ? task.resource_info.trim() : "";
  if (!summary) return [];
  return summary.split(/\s+\|\s+/).map((line) => line.trim()).filter(Boolean);
}

function detailFields(task: CalendarTask): PdfTaskField[] {
  const fields: PdfTaskField[] = [];
  const seen = new Set<string>();
  const add = (labelValue: unknown, rawValue: unknown) => {
    const label = typeof labelValue === "string" ? labelValue.trim() : "";
    const value = formatPdfFieldValue(rawValue);
    if (!label || !value) return;
    const identity = `${label.toLocaleLowerCase()}\u0000${value}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    fields.push({ label, value });
  };

  for (const definition of task.field_definitions || []) {
    if (OMITTED_FIELD_TYPES.has(definition.type)) continue;
    add(definition.name, task.fields?.[definition.id]);
  }
  for (const extra of task._extra_card_fields || []) {
    add(extra.label, extra.value);
  }
  return fields;
}

function safeColour(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : "#4f46e5";
}

/** Build deterministic per-day references and printable, user-facing details. */
export function buildPdfDayTaskModel(tasks: CalendarTask[]): PdfDayTaskModel {
  const ordered = tasks
    .map((task, originalIndex) => ({ task, originalIndex }))
    .sort((left, right) =>
      taskSortKey(left.task, left.originalIndex).localeCompare(
        taskSortKey(right.task, right.originalIndex),
      ),
    );

  const referencedTasks = ordered.map(({ task }, index) => ({
    ...task,
    _pdf_reference: `T${String(index + 1).padStart(2, "0")}`,
  }));
  const details = referencedTasks.map((task): PdfTaskDetail => {
    const reference = task._pdf_reference as string;
    return {
      reference,
      title: task.name || "Unnamed task",
      taskType: task.task_type_name || "Operational task",
      colour: safeColour(task.task_type_color),
      time: taskTime(task),
      location: task.location_name?.trim() || "",
      allocations: allocationLines(task),
      fields: detailFields(task),
    };
  });

  return {
    tasks: referencedTasks,
    details,
  };
}
