import { readFileSync } from "node:fs";
import path from "node:path";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PermittedDataInputNotice } from "@/components/PermittedDataInputNotice";

const mocks = vi.hoisted(() => ({
  getDataPolicy: vi.fn(),
}));

vi.mock("@/contexts/EventContext", () => ({
  useOptionalEvent: () => ({ selectedEventId: 11 }),
}));

vi.mock("@/lib/api", () => ({
  mpBackendApi: { getDataPolicy: mocks.getDataPolicy },
}));

const policy = {
  acknowledged: false,
  policy_version: 4,
  policy_sha256: "a".repeat(64),
  policy_url: "https://server.example/api/v1/governance/public/versions/4/data-policy.html",
  controller_identity: "Example Association",
  privacy_url: "https://server.example/api/v1/governance/public/versions/4/privacy.html",
  retention_days: 7,
  enabled_optional_features: ["offline_schedule", "public_schedule"],
  incident_contact: "incident@example.org",
};

describe("PermittedDataInputNotice", () => {
  afterEach(() => {
    mocks.getDataPolicy.mockReset();
  });

  it("shows the full prohibited-data warning and exact controller policy before acknowledgement", async () => {
    mocks.getDataPolicy.mockResolvedValue(policy);
    render(<PermittedDataInputNotice eventId={11} />);

    expect(await screen.findByText("Operational information only")).toBeInTheDocument();
    expect(screen.getByText(/Do not enter health, dietary, safeguarding/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /exact permitted-data rules v4 for Example Association/i });
    expect(link).toHaveAttribute("href", policy.policy_url);
    expect(screen.getByText(/Controller-selected event retention grace: 7 days/)).toBeInTheDocument();
    expect(screen.getByText(/Enabled policy features: offline_schedule, public_schedule/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /exact privacy notice/i })).toHaveAttribute("href", policy.privacy_url);
    expect(screen.getByRole("link", { name: policy.incident_contact! })).toHaveAttribute(
      "href",
      `mailto:${policy.incident_contact}`,
    );
  });

  it("retains a keyboard-accessible compact exact-policy link on a narrow viewport", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    mocks.getDataPolicy.mockResolvedValue({ ...policy, acknowledged: true });
    const user = userEvent.setup();
    render(<PermittedDataInputNotice />);

    const link = await screen.findByRole("link", { name: /permitted-data rules v4/i });
    expect(screen.getByText(/Operational data only/)).toBeInTheDocument();
    expect(screen.getByText(/for Example Association/)).toBeInTheDocument();
    expect(link).toHaveAttribute("href", policy.policy_url);
    expect(screen.getByRole("link", { name: /exact privacy notice/i })).toHaveAttribute("href", policy.privacy_url);
    expect(screen.getByText(/Enabled policy features: offline_schedule, public_schedule/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: policy.incident_contact! })).toHaveAttribute(
      "href",
      `mailto:${policy.incident_contact}`,
    );
    await user.tab();
    expect(link).toHaveFocus();
  });

  it("reloads policy state when the selected event changes", async () => {
    mocks.getDataPolicy.mockResolvedValue(policy);
    const { rerender } = render(<PermittedDataInputNotice eventId={11} />);
    await waitFor(() => expect(mocks.getDataPolicy).toHaveBeenCalledWith(11));

    rerender(<PermittedDataInputNotice eventId={12} />);
    await waitFor(() => expect(mocks.getDataPolicy).toHaveBeenCalledWith(12));
  });
});

describe("broad-content notice placement inventory", () => {
  const inventoriedFiles = [
    "../src/app/dashboard/admin/tabs/AudienceTeamsContent.tsx",
    "../src/app/dashboard/admin/tabs/GeneralScheduleTab.tsx",
    "../src/app/dashboard/admin/tabs/TaskBuilderTab.tsx",
    "../src/app/dashboard/admin/tabs/optimised/OptimisedTaskEditModal.tsx",
    "../src/app/dashboard/settings/components/CapabilitiesSection.tsx",
    "../src/app/dashboard/settings/components/CapabilityTypesSection.tsx",
    "../src/app/dashboard/settings/components/EventConfigSection.tsx",
    "../src/app/dashboard/settings/components/TaskTemplatesSection.tsx",
    "../src/app/dashboard/settings/components/TaskTypesSection.tsx",
    "../src/components/TaskEditModal.tsx",
  ];

  it.each(inventoriedFiles)("keeps the reusable notice in %s", (relativePath) => {
    const source = readFileSync(path.resolve(process.cwd(), "tests", relativePath), "utf8");
    expect(source).toContain("<PermittedDataInputNotice");
  });

  it("keeps public-output labels precise in event and schedule editors", () => {
    const eventSource = readFileSync(
      path.resolve(process.cwd(), "src/app/dashboard/settings/components/EventConfigSection.tsx"),
      "utf8",
    );
    const scheduleSource = readFileSync(
      path.resolve(process.cwd(), "src/app/dashboard/admin/tabs/GeneralScheduleTab.tsx"),
      "utf8",
    );
    expect(eventSource).toContain("Participant-visible event name");
    expect(eventSource).toContain("Participant-visible operational event location");
    expect(scheduleSource).toContain("Public schedule item title");
    expect(scheduleSource).toContain("Public schedule description");
  });
});
