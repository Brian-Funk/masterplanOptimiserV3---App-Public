import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MpBackendSection } from "@/app/dashboard/settings/components/MpBackendSection";

const mockRefreshEvents = vi.hoisted(() => vi.fn());
const mockSetSelectedEventId = vi.hoisted(() => vi.fn());
const mockAddToast = vi.hoisted(() => vi.fn());
const mockMpBackendApi = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getDataPolicy: vi.fn(),
  getDeletionWorkOrderStatus: vi.fn(),
  syncDeletionWorkOrders: vi.fn(),
  exportSetup: vi.fn(),
}));

vi.mock("@/contexts/EventContext", () => ({
  useEvent: () => ({
    selectedEventId: 7,
    setSelectedEventId: mockSetSelectedEventId,
    availableEvents: [{
      id: 7,
      name: "Synthetic Event",
      location: "",
      start_date: "2031-01-01",
      end_date: "2031-01-02",
    }],
    refreshEvents: mockRefreshEvents,
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock("@/lib/api", () => ({
  mpBackendApi: mockMpBackendApi,
}));

describe("MP-Backend deletion work orders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshEvents.mockResolvedValue(undefined);
    mockMpBackendApi.getSettings.mockResolvedValue({
      configured: true,
      server_url: "https://server.example",
      secret_preview: "abc...xyz",
    });
    mockMpBackendApi.getDataPolicy.mockResolvedValue(null);
    mockMpBackendApi.getDeletionWorkOrderStatus.mockResolvedValue({ pending: 0 });
  });

  it("warns about pending deletion requests before the operator processes them", async () => {
    mockMpBackendApi.getDeletionWorkOrderStatus.mockResolvedValue({ pending: 2 });

    render(<MpBackendSection />);

    expect(await screen.findByRole("status")).toHaveTextContent("2 deletion requests are waiting");
    expect(screen.getByRole("button", { name: "Process 2 deletion requests" })).toBeEnabled();
    expect(mockMpBackendApi.syncDeletionWorkOrders).not.toHaveBeenCalled();
  });

  it("clears a deleted event, refreshes the picker, and confirms report delivery", async () => {
    mockMpBackendApi.syncDeletionWorkOrders.mockResolvedValue({
      applied: 1,
      reports_sent: 1,
      reports_pending: 0,
      event_deleted: true,
    });

    const user = userEvent.setup();
    render(<MpBackendSection />);
    await user.click(await screen.findByRole("button", { name: "Process deletion requests" }));

    await waitFor(() => expect(mockSetSelectedEventId).toHaveBeenCalledWith(null));
    expect(mockRefreshEvents).toHaveBeenCalledOnce();
    expect(mockAddToast).toHaveBeenCalledWith(
      "Synthetic Event was deleted from this Desktop and its privacy report was sent.",
      "success",
    );
  });

  it("reports people who need an email after downloading Server setup", async () => {
    mockMpBackendApi.exportSetup.mockResolvedValue({
      event: { name: "Synthetic Event" },
      users: [
        { display_name: "Has Email", email: "person@example.org" },
        { display_name: "Needs Email", email: null },
      ],
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:server-setup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const user = userEvent.setup();
    render(<MpBackendSection />);
    await user.click(
      await screen.findByRole("button", { name: "Export Server Setup" }),
    );

    expect(click).toHaveBeenCalledOnce();
    expect(await screen.findByText(/1 person cannot receive activation/i)).toBeVisible();
  });
});
