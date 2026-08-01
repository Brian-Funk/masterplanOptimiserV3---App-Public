"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { appSettingsApi } from "@/lib/api";
import {
  matchesShortcut as matchesShortcutBinding,
  resolveShortcutBindings,
  type ShortcutBindingMap,
  type ShortcutId,
  type ShortcutOverrideMap,
} from "@/lib/shortcuts";

/** Context value for loaded shortcut overrides and matching helpers. */
export interface ShortcutContextValue {
  loading: boolean;
  error: string | null;
  overrides: ShortcutOverrideMap;
  bindings: ShortcutBindingMap;
  refreshShortcuts: () => Promise<void>;
  saveShortcutOverrides: (shortcuts: ShortcutOverrideMap) => Promise<void>;
  resetShortcutOverrides: () => Promise<void>;
  getShortcutBinding: (id: ShortcutId) => string;
  matchesShortcut: (
    event: KeyboardEvent | React.KeyboardEvent,
    id: ShortcutId,
  ) => boolean;
}

const ShortcutContext = createContext<ShortcutContextValue | undefined>(
  undefined,
);

/** Load, persist, and resolve user-configurable keyboard shortcuts. */
export function ShortcutProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = useState<ShortcutOverrideMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bindings = useMemo(() => resolveShortcutBindings(overrides), [overrides]);

  const refreshShortcuts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await appSettingsApi.getShortcuts();
      setOverrides(response.shortcuts as ShortcutOverrideMap);
    } catch (err: any) {
      setError(err?.message || "Failed to load shortcuts");
      setOverrides({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshShortcuts();
  }, [refreshShortcuts]);

  const saveShortcutOverrides = useCallback(
    async (shortcuts: ShortcutOverrideMap) => {
      const response = await appSettingsApi.setShortcuts(
        shortcuts as Record<string, string>,
      );
      setOverrides(response.shortcuts as ShortcutOverrideMap);
    },
    [],
  );

  const resetShortcutOverrides = useCallback(async () => {
    await appSettingsApi.resetShortcuts();
    setOverrides({});
  }, []);

  const getShortcutBinding = useCallback(
    (id: ShortcutId) => bindings[id] || "",
    [bindings],
  );

  const matchesShortcut = useCallback(
    (event: KeyboardEvent | React.KeyboardEvent, id: ShortcutId) =>
      matchesShortcutBinding(event, bindings[id]),
    [bindings],
  );

  return (
    <ShortcutContext.Provider
      value={{
        loading,
        error,
        overrides,
        bindings,
        refreshShortcuts,
        saveShortcutOverrides,
        resetShortcutOverrides,
        getShortcutBinding,
        matchesShortcut,
      }}
    >
      {children}
    </ShortcutContext.Provider>
  );
}

/** Access resolved shortcut bindings and matching helpers. */
export function useShortcuts() {
  const context = useContext(ShortcutContext);
  if (!context) {
    throw new Error("useShortcuts must be used within a ShortcutProvider");
  }
  return context;
}
