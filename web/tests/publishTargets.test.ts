import { describe, expect, it } from "vitest";
import {
  getPublishTargetsLabel,
  hasPublishDestination,
  normalisePublishTargets,
  type PublishDestination,
} from "@/lib/publishTargets";
import { sanitisePdfTitleForPreview } from "@/lib/pdfExport";

describe("publish destination sets", () => {
  const combinations: PublishDestination[][] = [
    [],
    ["google"],
    ["mp-backend"],
    ["pdf"],
    ["google", "mp-backend"],
    ["google", "pdf"],
    ["mp-backend", "pdf"],
    ["google", "mp-backend", "pdf"],
  ];

  it("round-trips every destination combination in canonical order", () => {
    combinations.forEach((targets) => {
      expect(normalisePublishTargets([...targets].reverse())).toEqual(targets);
    });
  });

  it("translates retired scalar settings", () => {
    expect(normalisePublishTargets("none")).toEqual([]);
    expect(normalisePublishTargets("google")).toEqual(["google"]);
    expect(normalisePublishTargets("mp-backend")).toEqual(["mp-backend"]);
    expect(normalisePublishTargets("both")).toEqual(["google", "mp-backend"]);
  });

  it("deduplicates and ignores unknown values", () => {
    expect(normalisePublishTargets(["pdf", "google", "pdf", "unknown"])).toEqual([
      "google",
      "pdf",
    ]);
  });

  it("labels all destinations without ambiguity", () => {
    expect(getPublishTargetsLabel([])).toBe("No publish target");
    expect(getPublishTargetsLabel(["pdf"])).toBe("PDF");
    expect(getPublishTargetsLabel(["google", "pdf"])).toBe("Google Calendar and PDF");
    expect(getPublishTargetsLabel(["google", "mp-backend", "pdf"])).toBe(
      "Google Calendar, MP-Backend, and PDF",
    );
    expect(hasPublishDestination(["pdf"], "pdf")).toBe(true);
  });

  it("previews the same safe filename stem enforced by Electron", () => {
    expect(sanitisePdfTitleForPreview("  Plan: Zürich / Night.  ")).toBe(
      "Plan_ Zürich _ Night",
    );
    expect(sanitisePdfTitleForPreview("CON")).toBe("Optimised Schedule");
  });
});
