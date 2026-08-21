import { describe, expect, it } from "vitest";

import {
  detectShortcutConflicts,
  isEditableTarget,
  matchesShortcut,
  resolveShortcutBindings,
} from "@/lib/shortcuts";

describe("CMI ignored-task shortcut", () => {
  it("defaults to I and accepts a configured replacement", () => {
    expect(resolveShortcutBindings()["cmi.toggleIgnored"]).toBe("I");
    expect(
      resolveShortcutBindings({ "cmi.toggleIgnored": "Ctrl+J" })[
        "cmi.toggleIgnored"
      ],
    ).toBe("Ctrl+J");
    expect(
      matchesShortcut(
        new KeyboardEvent("keydown", { key: "j", ctrlKey: true }),
        "Ctrl+J",
      ),
    ).toBe(true);
  });

  it("supports unassigning and conflict detection within the CMI scope", () => {
    const bindings = resolveShortcutBindings({ "cmi.toggleIgnored": "" });
    expect(bindings["cmi.toggleIgnored"]).toBe("");
    expect(matchesShortcut(new KeyboardEvent("keydown", { key: "i" }), "")).toBe(
      false,
    );

    const conflicts = detectShortcutConflicts({
      ...resolveShortcutBindings(),
      "cmi.toggleIgnored": "D",
    });
    expect(conflicts.has("cmi.toggleIgnored")).toBe(true);
    expect(conflicts.has("cmi.duplicateSelected")).toBe(true);
  });

  it("recognises editable targets that suppress CMI shortcuts", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
  });
});
