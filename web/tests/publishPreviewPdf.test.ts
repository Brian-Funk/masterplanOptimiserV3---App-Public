import { describe, expect, it } from "vitest";
import {
  derivePublishPreview,
  getPublishTargetLabel,
  toPublishPreviewTarget,
} from "@/lib/publishPreview";
import {
  derivePublishingItem,
  type DayPublishStatus,
} from "@/lib/eventStatusSummary";
import type { TaskInstance } from "@/lib/api";

const dayId = "2032-04-21";
const readyDay: DayPublishStatus = {
  dayId,
  label: "Wednesday, 21 April",
  fingerprint: "schedule-fingerprint",
  isPublishable: true,
  isPublished: false,
  hasChangesSincePublish: false,
  publishFailed: false,
  isOptimisedOrFinalised: true,
  conflictCount: 0,
};
const task: TaskInstance = {
  id: 1,
  name: "Opening shift",
  event_id: 12,
  date: dayId,
  is_floating: false,
  is_transfer: false,
  optimised: { start_time: "09:00", end_time: "10:00" },
};

describe("local-document publish previews", () => {
  it("publishes a selected ready day to PDF only", () => {
    const preview = derivePublishPreview({
      publishTarget: ["pdf"],
      scope: "selected_day",
      selectedDayId: dayId,
      dayStatuses: [readyDay],
      taskInstances: [task],
      getDayLabel: () => "Wednesday, 21 April",
    });

    expect(preview.canPublish).toBe(true);
    expect(preview.target).toEqual(["pdf"]);
    expect(preview.targetLabel).toBe("PDF");
    expect(preview.publishDays.map((day) => day.dayId)).toEqual([dayId]);
    expect(preview.summary).toContain("published to PDF");
  });

  it("reports all four destinations in a deterministic order", () => {
    const preview = derivePublishPreview({
      publishTarget: ["excel", "pdf", "mp-backend", "google"],
      scope: "all_days",
      dayStatuses: [readyDay],
      taskInstances: [task],
    });

    expect(preview.target).toEqual(["google", "mp-backend", "pdf", "excel"]);
    expect(preview.targetLabel).toBe(
      "Google Calendar, MP-Backend, PDF, and Excel workbook",
    );
    expect(preview.canPublish).toBe(true);
  });

  it("publishes an Excel workbook without requiring an external target", () => {
    const preview = derivePublishPreview({
      publishTarget: ["excel"],
      scope: "selected_day",
      selectedDayId: dayId,
      dayStatuses: [readyDay],
      taskInstances: [task],
    });

    expect(preview.canPublish).toBe(true);
    expect(preview.targetLabel).toBe("Excel workbook");
    expect(preview.summary).toContain("published to Excel workbook");
  });

  it("blocks publishing when no destination is configured", () => {
    const preview = derivePublishPreview({
      publishTarget: [],
      scope: "selected_day",
      selectedDayId: dayId,
      dayStatuses: [readyDay],
      taskInstances: [task],
    });

    expect(preview.canPublish).toBe(false);
    expect(preview.blockingReasons).toContain("No publish target is configured.");
  });

  it("keeps retired scalar presentation helpers compatible", () => {
    expect(toPublishPreviewTarget("google")).toBe("google_calendar");
    expect(toPublishPreviewTarget("mp-backend")).toBe("mp_backend");
    expect(getPublishTargetLabel("both")).toBe("Google Calendar and MP-Backend");
    expect(getPublishTargetLabel(null)).toBe("No publish target");
    expect(
      derivePublishingItem({ publishTarget: "none", taskInstances: [] } as any),
    ).toMatchObject({ status: "No target", level: "blocked" });
  });
});
