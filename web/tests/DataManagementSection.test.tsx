import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DataManagementSection } from "@/app/dashboard/settings/components/DataManagementSection";

const mockExportData = vi.hoisted(() => vi.fn());
const mockRefreshEvents = vi.hoisted(() => vi.fn());
const mockSetSelectedEventId = vi.hoisted(() => vi.fn());
const mockRefreshTasks = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/contexts/EventContext", () => ({
  useEvent: () => ({
    selectedEventId: 7,
    availableEvents: [{
      id: 7,
      name: "Synthetic Event",
      location: "",
      start_date: "2032-01-01",
      end_date: "2032-01-02",
    }],
    refreshEvents: mockRefreshEvents,
    setSelectedEventId: mockSetSelectedEventId,
  }),
}));

vi.mock("@/contexts/TaskInstanceContext", () => ({
  useTaskInstances: () => ({ refresh: mockRefreshTasks }),
}));

vi.mock("@/lib/api", () => ({
  dataManagementApi: {
    exportData: mockExportData,
    previewImport: vi.fn(),
    importData: vi.fn(),
    copyFromEvent: vi.fn(),
    previewCopiedTaskDateRepair: vi.fn(),
    repairCopiedTaskDates: vi.fn(),
    deleteEvent: vi.fn(),
    factoryReset: vi.fn(),
  },
}));

describe("DataManagementSection shareable setup export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExportData.mockResolvedValue({
      version: 2,
      type: "app_settings",
      profile: "shareable_setup",
      global_data: {},
      shareable_setup_report: {
        included_counts: { capabilities: 3, task_templates: 2 },
        redactions: 1,
      },
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shareable-setup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  it("exports the fourth privacy-safe scope with a distinct filename", async () => {
    const user = userEvent.setup();
    render(<DataManagementSection />);

    await user.click(screen.getByRole("radio", { name: "Shareable Setup" }));
    expect(screen.getByText(/Projects, people, groups, locations/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(mockExportData).toHaveBeenCalledWith(
      "shareable",
      undefined,
    ));
    expect(await screen.findByText(/5 reusable records and 1 automatic redaction/i)).toBeVisible();
  });
});
