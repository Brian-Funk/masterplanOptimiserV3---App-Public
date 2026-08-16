import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProcessorEvidenceSection } from "@/app/dashboard/settings/components/ProcessorEvidenceSection";

const mockListKeys = vi.hoisted(() => vi.fn());
const mockGenerateKey = vi.hoisted(() => vi.fn());
const mockEnrolKey = vi.hoisted(() => vi.fn());
const mockEraseEventKeys = vi.hoisted(() => vi.fn());

vi.mock("@/contexts/EventContext", () => ({
  useEvent: () => ({
    selectedEventId: 7,
    availableEvents: [{ id: 7, name: "Synthetic event" }],
  }),
}));

vi.mock("@/lib/api", () => ({
  processorEvidenceApi: {
    listKeys: mockListKeys,
    generateKey: mockGenerateKey,
    enrolKey: mockEnrolKey,
    importKey: vi.fn(),
    refreshEventStatus: vi.fn(),
    eraseEventKeys: mockEraseEventKeys,
  },
}));

const activeKey = {
  key_id: "ek-0123456789abcdef",
  public_key: "ssh-ed25519 synthetic",
  public_key_sha256: "a".repeat(64),
  processor_id: "prc-synthetic0001",
  local_event_id: 7,
  event_evidence_id: "4b71e292-0931-460d-a5f1-f536f4ca1f2e",
  display_label: "Event workstation",
  server_instance_id: "93a57418-b6ca-4718-8934-5a0b105c0d7c",
  role: "processor",
  algorithm: "Ed25519",
  state: "active",
  supersedes_key_id: null,
  created_at: "2026-08-16T10:00:00Z",
  retired_at: null,
};

describe("ProcessorEvidenceSection", () => {
  beforeEach(() => {
    mockListKeys.mockReset();
    mockGenerateKey.mockReset();
    mockEnrolKey.mockReset();
    mockEraseEventKeys.mockReset();
  });

  it("erases all local event keys and returns to fresh enrolment", async () => {
    mockListKeys.mockResolvedValueOnce([activeKey]).mockResolvedValueOnce([]);
    mockEraseEventKeys.mockResolvedValue({ status: "erased", erased_key_count: 1 });

    render(<ProcessorEvidenceSection />);

    expect(await screen.findByText("Ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /local signing stops immediately/i }));
    fireEvent.click(screen.getByRole("button", { name: /erase local keys and start again/i }));

    await waitFor(() => expect(mockEraseEventKeys).toHaveBeenCalledWith(7));
    expect(await screen.findByRole("button", { name: "Generate and submit" })).toBeInTheDocument();
    expect(screen.getByText(/Local processor keys erased/i)).toBeInTheDocument();
  });
});
