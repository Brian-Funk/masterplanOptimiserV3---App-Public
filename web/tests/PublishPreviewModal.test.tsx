import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PublishPreviewModal } from "@/components/publish/PublishPreviewModal";
import type { MpBackendDataPolicy } from "@/lib/api";
import type { PublishPreview } from "@/lib/publishPreview";

const preview: PublishPreview = {
  target: ["mp-backend"],
  targetLabel: "MP-Backend",
  scope: "selected_day",
  scopeLabel: "Wednesday, 21 April only",
  selectedDayId: "2032-04-21",
  totalDays: 1,
  publishableDays: 1,
  skippedDays: 0,
  totalTasksToPublish: 1,
  manualEditCount: 0,
  conflictCount: 0,
  days: [
    {
      dayId: "2032-04-21",
      dayLabel: "Wednesday, 21 April",
      status: "ready",
      isPublishable: true,
      willPublish: true,
      taskCount: 1,
      manualEditCount: 0,
      conflictCount: 0,
    },
  ],
  publishDays: [],
  canPublish: true,
  blockingReasons: [],
  warnings: [],
  summary: "One day is ready to publish.",
  explanation: "Review the selected day before publishing.",
  actionLabel: "Publish selected day",
};
preview.publishDays = preview.days;

const policy: MpBackendDataPolicy = {
  configured: true,
  policy_version: 2,
  policy_sha256: "a".repeat(64),
  controller_identity: "Synthetic Controller",
  purpose: "Publish necessary event scheduling information.",
  allowed: ["task allocations"],
  unsupported: ["private notes"],
  policy_url: "https://server.example/policy-v2.html",
  privacy_url: "https://server.example/privacy.html",
  retention_days: 90,
  enabled_optional_features: [],
  incident_contact: null,
  acknowledged: false,
  operator_subject: null,
};

describe("PublishPreviewModal permitted-data gate", () => {
  it("blocks publication and records only an explicit acknowledgement", async () => {
    const onAcknowledgePolicy = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <PublishPreviewModal
        open
        preview={preview}
        policyRequired
        dataPolicy={policy}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        onAcknowledgePolicy={onAcknowledgePolicy}
      />,
    );

    expect(screen.getByRole("link", { name: "Open permanent exact policy" }))
      .toHaveAttribute("href", policy.policy_url);
    expect(screen.getByText(/Version 2; SHA-256/)).toHaveTextContent(
      policy.policy_sha256,
    );
    expect(
      screen.getByRole("button", { name: "Publish selected day" }),
    ).toBeDisabled();

    await user.click(
      screen.getByRole("button", {
        name: "I reviewed necessity and permitted audiences",
      }),
    );
    expect(onAcknowledgePolicy).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("enables publication only for the acknowledged current policy", () => {
    render(
      <PublishPreviewModal
        open
        preview={preview}
        policyRequired
        dataPolicy={{ ...policy, acknowledged: true }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Acknowledged by this pseudonymous Desktop installation"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Publish selected day" }),
    ).toBeEnabled();
  });

  it("keeps all publication disabled while the current policy is loading", () => {
    render(
      <PublishPreviewModal
        open
        preview={preview}
        policyRequired
        policyLoading
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText("Verifying the current exact policy...")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Publish selected day" }),
    ).toBeDisabled();
  });
});
