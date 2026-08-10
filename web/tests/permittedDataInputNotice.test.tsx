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
    localStorage.clear();
  });

  it("shows one compact, dismissible link to the exact policy", async () => {
    mocks.getDataPolicy.mockResolvedValue(policy);
    const user = userEvent.setup();
    render(<PermittedDataInputNotice eventId={11} />);

    expect(await screen.findByText("Operational data only")).toBeInTheDocument();
    expect(screen.getByText(/necessary scheduling and operational information/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /permitted-data rules v4/i });
    expect(link).toHaveAttribute("href", policy.policy_url);
    expect(screen.getByRole("link", { name: "Privacy notice" })).toHaveAttribute("href", policy.privacy_url);

    await user.click(screen.getByRole("button", { name: "Dismiss permitted-data guidance" }));
    expect(screen.queryByText("Operational data only")).not.toBeInTheDocument();
  });

  it("retains a keyboard-accessible compact exact-policy link on a narrow viewport", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    mocks.getDataPolicy.mockResolvedValue({ ...policy, acknowledged: true });
    const user = userEvent.setup();
    render(<PermittedDataInputNotice />);

    const link = await screen.findByRole("link", { name: /permitted-data rules v4/i });
    expect(link).toHaveAttribute("href", policy.policy_url);
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

  it("keeps a dismissal across the dashboard for the same policy digest", async () => {
    mocks.getDataPolicy.mockResolvedValue(policy);
    const user = userEvent.setup();
    const first = render(<PermittedDataInputNotice eventId={11} />);
    await user.click(await screen.findByRole("button", { name: "Dismiss permitted-data guidance" }));
    first.unmount();

    render(<PermittedDataInputNotice eventId={12} />);
    await waitFor(() => expect(mocks.getDataPolicy).toHaveBeenCalledWith(12));
    expect(screen.queryByText("Operational data only")).not.toBeInTheDocument();
  });

  it("shows the notice again when the exact policy digest changes", async () => {
    mocks.getDataPolicy
      .mockResolvedValueOnce(policy)
      .mockResolvedValueOnce({ ...policy, policy_version: 5, policy_sha256: "b".repeat(64) });
    const user = userEvent.setup();
    const { rerender } = render(<PermittedDataInputNotice eventId={11} />);
    await user.click(await screen.findByRole("button", { name: "Dismiss permitted-data guidance" }));

    rerender(<PermittedDataInputNotice eventId={12} />);
    expect(await screen.findByText("Operational data only")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /permitted-data rules v5/i })).toBeInTheDocument();
  });
});

describe("global permitted-data notice placement", () => {
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

  it.each(inventoriedFiles)("does not repeat the notice in %s", (relativePath) => {
    const source = readFileSync(path.resolve(process.cwd(), "tests", relativePath), "utf8");
    expect(source).not.toContain("PermittedDataInputNotice");
  });

  it("places the notice once in the dashboard shell", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "src/app/dashboard/layout.tsx"),
      "utf8",
    );
    expect(source.match(/<PermittedDataInputNotice/g)).toHaveLength(1);
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
    const masterplanSource = readFileSync(
      path.resolve(process.cwd(), "src/app/dashboard/admin/tabs/ScheduleTab.tsx"),
      "utf8",
    );
    expect(eventSource).toContain("Participant-visible event name");
    expect(eventSource).toContain("Participant-visible operational event location");
    expect(scheduleSource).toContain("Public schedule item title");
    expect(scheduleSource).toContain("Public schedule description");
    expect(scheduleSource).toContain("<Globe2");
    expect(masterplanSource).toContain("<LockKeyhole");
    expect(masterplanSource).toContain("Authenticated");
  });
});
