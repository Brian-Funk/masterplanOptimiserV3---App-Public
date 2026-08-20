import type { CalendarTask } from "@/components/Calendar";
import {
  normaliseScheduleDayRange,
  type ScheduleDayRange,
} from "@/lib/scheduleDayRange";
import {
  endToWorkingDayMinutes,
  formatWorkingHourLabel,
  toWorkingDayMinutes,
} from "@/lib/workingDayBoundary";

export interface PdfTimelineItem {
  key: string;
  task: CalendarTask;
  top: number;
  height: number;
  left: number;
  width: number;
}

export interface PdfTimelineLayout {
  hourHeight: number;
  totalHeight: number;
  hourLabels: Array<{ label: string; top: number }>;
  items: PdfTimelineItem[];
}

interface PositionedTask {
  index: number;
  task: CalendarTask;
  start: number;
  end: number;
}

function taskInterval(task: CalendarTask, selectedDate: string): [number, number] | null {
  const actualDate = task.date || selectedDate;
  if (task.start_end_time) {
    const start = toWorkingDayMinutes(
      actualDate,
      task.start_end_time.start,
      selectedDate,
    );
    const end = endToWorkingDayMinutes(
      actualDate,
      task.start_end_time.start,
      task.start_end_time.end,
      selectedDate,
    );
    if (start !== null && end !== null) return [start, end];
  }
  if (task.time_range) {
    const start = toWorkingDayMinutes(
      actualDate,
      task.time_range.start,
      selectedDate,
    );
    const end = endToWorkingDayMinutes(
      actualDate,
      task.time_range.start,
      task.time_range.end,
      selectedDate,
    );
    if (start !== null && end !== null) return [start, end];
  }
  if (task.time) {
    const start = toWorkingDayMinutes(actualDate, task.time, selectedDate);
    if (start !== null) return [start, start + 60];
  }
  return null;
}

function overlap(left: PositionedTask, right: PositionedTask): boolean {
  return left.start < right.end && right.start < left.end;
}

/**
 * Build a finite, print-only timeline without mounting the interactive Calendar.
 * Array indexes—not imported task IDs—anchor the overlap graph, so malformed or
 * duplicate legacy IDs cannot create a union-find cycle.
 */
export function buildPdfTimelineLayout(
  tasks: CalendarTask[],
  selectedDate: string,
  scheduleDayRange: Partial<ScheduleDayRange> | null | undefined,
): PdfTimelineLayout {
  const range = normaliseScheduleDayRange(scheduleDayRange);
  const startMinute = range.startHour * 60;
  const endMinute = range.endHour * 60;
  const spanMinutes = Math.max(60, endMinute - startMinute);
  const hourHeight = Math.max(
    32,
    Math.min(62, 520 / Math.max(range.endHour - range.startHour, 1)),
  );
  const minimumDuration = Math.max(1, Math.round(18 * 60 / hourHeight));

  const positioned: PositionedTask[] = tasks.map((task, index) => {
    const interval = taskInterval(task, selectedDate);
    const rawStart = interval?.[0] ?? startMinute;
    const rawEnd = interval?.[1] ?? rawStart + minimumDuration;
    const start = Math.min(Math.max(rawStart, startMinute), endMinute - 1);
    const end = Math.min(
      endMinute,
      Math.max(start + minimumDuration, rawEnd),
    );
    return { index, task, start, end };
  });

  const ordered = [...positioned].sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start) ||
      left.index - right.index,
  );
  const columns: PositionedTask[][] = [];
  const columnByIndex = new Map<number, number>();
  for (const item of ordered) {
    const available = columns.findIndex(
      (column) => !column.some((existing) => overlap(item, existing)),
    );
    const column = available === -1 ? columns.length : available;
    if (!columns[column]) columns[column] = [];
    columns[column].push(item);
    columnByIndex.set(item.index, column);
  }

  const parent = positioned.map((item) => item.index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[leftRoot] = rightRoot;
  };
  for (let left = 0; left < positioned.length; left += 1) {
    for (let right = left + 1; right < positioned.length; right += 1) {
      if (overlap(positioned[left], positioned[right])) {
        union(left, right);
      }
    }
  }

  const columnsPerGroup = new Map<number, number>();
  for (const item of positioned) {
    const root = find(item.index);
    const count = (columnByIndex.get(item.index) ?? 0) + 1;
    columnsPerGroup.set(root, Math.max(columnsPerGroup.get(root) ?? 1, count));
  }

  const items = positioned.map((item) => {
    const column = columnByIndex.get(item.index) ?? 0;
    const totalColumns = columnsPerGroup.get(find(item.index)) ?? 1;
    const width = 100 / totalColumns;
    return {
      key: `${String(item.task._pdf_reference || "task")}-${item.index}`,
      task: item.task,
      top: ((item.start - startMinute) / 60) * hourHeight,
      height: Math.max(18, ((item.end - item.start) / 60) * hourHeight),
      left: column * width,
      width,
    };
  });

  return {
    hourHeight,
    totalHeight: (spanMinutes / 60) * hourHeight,
    hourLabels: Array.from(
      { length: range.endHour - range.startHour + 1 },
      (_, index) => ({
        label: formatWorkingHourLabel(range.startHour + index),
        top: index * hourHeight,
      }),
    ),
    items,
  };
}
