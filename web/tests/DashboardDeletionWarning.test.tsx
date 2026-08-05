import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GlobalPendingDeletionWorkBanner,
  PendingDeletionWorkProvider,
} from "@/contexts/PendingDeletionWorkContext";

const mockPush = vi.hoisted(() => vi.fn());
const mockAddToast = vi.hoisted(() => vi.fn());
const mockEventsApi = vi.hoisted(() => ({ getAll: vi.fn() }));
const mockMpBackendApi = vi.hoisted(() => ({
  getDeletionWorkOrderStatus: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock("@/lib/api", () => ({
  eventsApi: mockEventsApi,
  mpBackendApi: mockMpBackendApi,
}));

describe("global Desktop deletion warning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockEventsApi.getAll.mockResolvedValue([
      { id: 7, name: "Configured event" },
      { id: 8, name: "Unconfigured event" },
    ]);
    mockMpBackendApi.getDeletionWorkOrderStatus.mockImplementation(async (eventId: number) => {
      if (eventId === 7) return { pending: 1 };
      throw new Error("MP-Backend not configured");
    });
  });

  it("checks every event and warns without relying on dashboard event selection", async () => {
    render(
      <PendingDeletionWorkProvider>
        <GlobalPendingDeletionWorkBanner />
      </PendingDeletionWorkProvider>,
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "A Server deletion request is waiting",
    );
    await waitFor(() => {
      expect(mockMpBackendApi.getDeletionWorkOrderStatus).toHaveBeenCalledWith(7);
      expect(mockMpBackendApi.getDeletionWorkOrderStatus).toHaveBeenCalledWith(8);
    });
    expect(mockAddToast).toHaveBeenCalledWith(
      "A Server deletion request is waiting. Open MP-Backend settings to review it.",
      "warning",
    );
  });
});
