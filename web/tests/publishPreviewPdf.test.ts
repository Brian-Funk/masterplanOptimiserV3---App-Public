import { describe, expect, it } from "vitest";
import { derivePublishPreview } from "@/lib/publishPreview";
import type { DayPublishStatus } from "@/lib/eventStatusSummary";
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

describe("PDF publish previews", () => {
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

  it("reports all three destinations in a deterministic order", () => {
    const preview = derivePublishPreview({
      publishTarget: ["pdf", "mp-backend", "google"],
      scope: "all_days",
      dayStatuses: [readyDay],
      taskInstances: [task],
    });

    expect(preview.target).toEqual(["google", "mp-backend", "pdf"]);
    expect(preview.targetLabel).toBe("Google Calendar, MP-Backend, and PDF");
    expect(preview.canPublish).toBe(true);
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
});
