"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useShortcuts } from "@/contexts/ShortcutContext";
import { isEditableTarget } from "@/lib/shortcuts";

export function GlobalShortcuts() {
  const router = useRouter();
  const { matchesShortcut } = useShortcuts();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (matchesShortcut(event, "global.openSettings")) {
        event.preventDefault();
        router.push("/dashboard/settings?section=shortcuts");
        return;
      }

      if (matchesShortcut(event, "global.backToDashboard")) {
        event.preventDefault();
        router.push("/dashboard/admin");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [matchesShortcut, router]);

  return null;
}
