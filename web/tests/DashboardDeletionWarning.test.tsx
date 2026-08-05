import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NavBar } from "@/app/dashboard/layout";

const mockPush = vi.hoisted(() => vi.fn());
const mockAddToast = vi.hoisted(() => vi.fn());
const mockMpBackendApi = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getDeletionWorkOrderStatus: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/dashboard/admin",
}));

vi.mock("@/contexts/EventContext", () => ({
  useEvent: () => ({
    selectedEventId: null,
    setSelectedEventId: vi.fn(),
    availableEvents: [
      { id: 7, name: "Configured event" },
      { id: 8, name: "Unconfigured event" },
    ],
    refreshEvents: vi.fn(),
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock("@/lib/api", () => ({
  googleCalendarApi: { getConnections: vi.fn().mockResolvedValue([]) },
  appSettingsApi: {},
  eventsApi: {},
  dataManagementApi: {},
  mpBackendApi: mockMpBackendApi,
}));

vi.mock("@/components/ThemedLogo", () => ({
  default: () => <div>Masterplan</div>,
}));

describe("global Desktop deletion warning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMpBackendApi.getSettings.mockImplementation(async (eventId: number) => ({
      configured: eventId === 7,
    }));
    mockMpBackendApi.getDeletionWorkOrderStatus.mockResolvedValue({ pending: 1 });
  });

  it("checks configured events and warns even when no event is selected", async () => {
    render(<NavBar />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "A Server deletion request is waiting",
    );
    await waitFor(() => {
      expect(mockMpBackendApi.getDeletionWorkOrderStatus).toHaveBeenCalledWith(7);
    });
    expect(mockMpBackendApi.getDeletionWorkOrderStatus).not.toHaveBeenCalledWith(8);
    expect(mockAddToast).toHaveBeenCalledWith(
      "A Server deletion request is waiting. Open MP-Backend settings to review it.",
      "warning",
    );
  });
});
