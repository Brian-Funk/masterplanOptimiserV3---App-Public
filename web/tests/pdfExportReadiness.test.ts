import { describe, expect, it, vi } from "vitest";
import { assertPdfDocumentReady } from "@/lib/pdfExportReadiness";

describe("hidden PDF renderer readiness", () => {
  it("accepts a synchronously completed, measurable day and task layout", () => {
    document.body.innerHTML = `
      <section class="pdf-day">
        <div data-pdf-calendar-frame><div data-task-id="1"></div></div>
        <div data-pdf-task-reference="T01"></div>
      </section>`;
    const frame = document.querySelector<HTMLElement>("[data-pdf-calendar-frame]")!;
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      top: 0,
      right: 800,
      bottom: 600,
      left: 0,
      toJSON: () => ({}),
    });

    expect(() => assertPdfDocumentReady(document, 1, 1)).not.toThrow();
    expect(() => assertPdfDocumentReady(document, 1, 2)).toThrow(
      /visual schedule and detail list are incomplete/i,
    );
  });
});
