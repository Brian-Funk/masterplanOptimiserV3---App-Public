import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, formatApiErrorMessage, mpBackendApi } from "@/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formatApiErrorMessage", () => {
  it("uses a safe nested FastAPI message instead of stringifying the object", () => {
    expect(
      formatApiErrorMessage(
        {
          detail: {
            code: "desktop_data_policy_acknowledgement_required",
            message: "Review and acknowledge the current exact policy.",
          },
        },
        "Publish failed",
      ),
    ).toBe("Review and acknowledge the current exact policy.");
  });

  it("formats bounded validation errors without exposing an object string", () => {
    expect(
      formatApiErrorMessage(
        {
          detail: [
            { loc: ["body", "tasks", 0], msg: "Published field is invalid" },
            { loc: ["body", "tasks", 1], msg: "Allocation is incomplete" },
          ],
        },
        "Publish failed",
      ),
    ).toBe(
      "body.tasks.0: Published field is invalid; body.tasks.1: Allocation is incomplete",
    );
  });

  it("falls back to the bounded HTTP status message for unknown bodies", () => {
    expect(formatApiErrorMessage({ detail: { unexpected: true } }, "HTTP 500"))
      .toBe("HTTP 500");
  });

  it("preserves the bounded policy code and status for recoverable publish handling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: {
              code: "desktop_data_policy_acknowledgement_required",
              message: "Review the current exact Server policy.",
            },
          }),
          {
            status: 428,
            statusText: "Precondition Required",
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const failure = await mpBackendApi.publish(12).catch((error) => error);
    expect(failure).toBeInstanceOf(ApiRequestError);
    expect(failure).toMatchObject({
      message: "Review the current exact Server policy.",
      status: 428,
      code: "desktop_data_policy_acknowledgement_required",
    });
  });
});
