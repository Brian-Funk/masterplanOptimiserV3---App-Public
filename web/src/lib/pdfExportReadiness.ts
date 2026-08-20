export class PdfReadinessError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PdfReadinessError";
    this.code = code;
  }
}

/**
 * Wait for up to two paints, but always resolve after the bounded fallback.
 * Hidden Electron windows can suspend requestAnimationFrame indefinitely.
 */
export function waitForBoundedPaint(
  timeoutMs = 1000,
  requestFrame: (callback: FrameRequestCallback) => number = window.requestAnimationFrame.bind(window),
  setTimer: (callback: () => void, timeout: number) => number = window.setTimeout.bind(window),
  clearTimer: (timer: number) => void = window.clearTimeout.bind(window),
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      resolve();
    };
    timer = setTimer(finish, timeoutMs);
    try {
      requestFrame(() => requestFrame(finish));
    } catch {
      finish();
    }
  });
}

export function assertPdfDocumentReady(
  root: ParentNode,
  expectedDays: number,
  expectedTasks: number,
): void {
  const days = Array.from(root.querySelectorAll<HTMLElement>(".pdf-day"));
  const frames = Array.from(
    root.querySelectorAll<HTMLElement>("[data-pdf-calendar-frame]"),
  );
  const timelineTasks = root.querySelectorAll("[data-pdf-calendar-frame] [data-task-id]");
  const detailEntries = root.querySelectorAll("[data-pdf-task-reference]");

  if (days.length !== expectedDays || frames.length !== expectedDays) {
    throw new PdfReadinessError(
      "PDF_DAY_COUNT_MISMATCH",
      "Not every requested schedule day rendered.",
    );
  }
  if (
    timelineTasks.length !== expectedTasks ||
    detailEntries.length !== expectedTasks
  ) {
    throw new PdfReadinessError(
      "PDF_TASK_COUNT_MISMATCH",
      "The visual schedule and detail list are incomplete.",
    );
  }
  if (
    frames.some(
      (frame) =>
        frame.getBoundingClientRect().width <= 0 ||
        frame.getBoundingClientRect().height <= 0,
    )
  ) {
    throw new PdfReadinessError(
      "PDF_LAYOUT_EMPTY",
      "A schedule calendar has no measurable dimensions.",
    );
  }
}
