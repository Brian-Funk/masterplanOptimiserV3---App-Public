import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutSettingsSection } from "@/app/dashboard/settings/components/ShortcutSettingsSection";

vi.mock("@/contexts/ShortcutContext", () => {
  const bindings = {};
  return {
    useShortcuts: () => ({
      bindings,
      loading: false,
      error: null,
      saveShortcutOverrides: vi.fn(),
      resetShortcutOverrides: vi.fn(),
    }),
  };
});

describe("ShortcutSettingsSection optimisation hint", () => {
  afterEach(() => cleanup());

  it("shows the fixed Shift-click all-days gesture", () => {
    render(<ShortcutSettingsSection />);

    const row = screen.getByTestId(
      "shortcut-row-cmi.optimiseAllDaysModifier",
    );
    expect(row).toHaveTextContent("Optimise all days");
    expect(row).toHaveTextContent("Shift + click");
    expect(row).toHaveTextContent("Built in");
  });
});
