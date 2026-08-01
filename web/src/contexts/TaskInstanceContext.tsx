"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  taskInstancesApi,
  TaskInstance,
  TaskInstanceCreate,
  TaskInstanceUpdate,
} from "@/lib/api";
import { useEvent } from "@/contexts/EventContext";

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

/** Context value for event-scoped task instance operations. */
export interface TaskInstanceContextValue {
  /** All task instances for the currently selected event. */
  instances: TaskInstance[];
  /** True while the initial load or a full refresh is in progress. */
  loading: boolean;

  // CRUD
  /** Reload all instances from the server. */
  refresh: () => Promise<void>;
  /** Create a single task instance. Returns the server-created record. */
  createInstance: (data: TaskInstanceCreate) => Promise<TaskInstance>;
  /** Create many task instances in one call. Returns server-created records. */
  createInstances: (items: TaskInstanceCreate[]) => Promise<TaskInstance[]>;
  /** Partial-update a task instance. Returns the updated record. */
  updateInstance: (
    id: number,
    data: TaskInstanceUpdate,
  ) => Promise<TaskInstance>;
  /** Delete a single task instance by ID. */
  deleteInstance: (id: number) => Promise<void>;
  /** Delete multiple task instances by ID. */
  deleteInstances: (ids: number[]) => Promise<void>;
  /** Write optimisation results to multiple instances. */
  bulkSetOptimised: (
    items: {
      id: number;
      optimised: Record<string, any>;
      final?: Record<string, any>;
    }[],
  ) => Promise<TaskInstance[]>;
  /** Delete all task instances for the current event. */
  clearAll: () => Promise<void>;
}

const TaskInstanceContext = createContext<TaskInstanceContextValue | undefined>(
  undefined,
);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Provide event-scoped task instance CRUD and bulk optimisation updates. */
export function TaskInstanceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { selectedEventId } = useEvent();
  const [instances, setInstances] = useState<TaskInstance[]>([]);
  const [loading, setLoading] = useState(false);

  // Track which event_id we loaded for, to avoid stale-closure issues
  const eventIdRef = useRef<number | null>(null);

  // ------ refresh ------
  const refresh = useCallback(async () => {
    if (!selectedEventId) {
      setInstances([]);
      return;
    }
    setLoading(true);
    try {
      let data = await taskInstancesApi.getAll(selectedEventId);

      // If no instances exist, try to restore from the Tasks table
      // (handles databases where finalise previously deleted instances)
      if (data.length === 0) {
        try {
          data = await taskInstancesApi.restore(selectedEventId);
        } catch {
          // restore endpoint may not exist on older backends - ignore
        }
      }

      // Only update if we're still looking at the same event
      if (eventIdRef.current === selectedEventId) {
        setInstances(data);
      }
    } catch (err) {
      console.error("Failed to load task instances", err);
    } finally {
      setLoading(false);
    }
  }, [selectedEventId]);

  // Auto-load when the selected event changes
  useEffect(() => {
    eventIdRef.current = selectedEventId ?? null;
    refresh();
  }, [selectedEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------ create single ------
  const createInstance = useCallback(async (data: TaskInstanceCreate) => {
    const created = await taskInstancesApi.create(data);
    setInstances((prev) => [...prev, created]);
    return created;
  }, []);

  // ------ create bulk ------
  const createInstances = useCallback(async (items: TaskInstanceCreate[]) => {
    if (items.length === 0) return [];
    const created = await taskInstancesApi.createBulk(items);
    setInstances((prev) => [...prev, ...created]);
    return created;
  }, []);

  // ------ update ------
  const updateInstance = useCallback(
    async (id: number, data: TaskInstanceUpdate) => {
      if (!selectedEventId) throw new Error("No event selected");
      const updated = await taskInstancesApi.update(id, selectedEventId, data);
      setInstances((prev) =>
        prev.map((inst) => (inst.id === id ? updated : inst)),
      );
      return updated;
    },
    [selectedEventId],
  );

  // ------ delete single ------
  const deleteInstance = useCallback(async (id: number) => {
    if (!selectedEventId) throw new Error("No event selected");
    await taskInstancesApi.delete(id, selectedEventId);
    setInstances((prev) => prev.filter((inst) => inst.id !== id));
  }, [selectedEventId]);

  // ------ delete multiple ------
  const deleteInstances = useCallback(async (ids: number[]) => {
    if (!selectedEventId) throw new Error("No event selected");
    await Promise.all(ids.map((id) => taskInstancesApi.delete(id, selectedEventId)));
    const idSet = new Set(ids);
    setInstances((prev) => prev.filter((inst) => !idSet.has(inst.id)));
  }, [selectedEventId]);

  // ------ bulk optimised ------
  const bulkSetOptimised = useCallback(
    async (
      items: {
        id: number;
        optimised: Record<string, any>;
        final?: Record<string, any>;
      }[],
    ) => {
      if (!selectedEventId) throw new Error("No event selected");
      const updated = await taskInstancesApi.bulkSetOptimised(selectedEventId, items);
      const map = new Map(updated.map((u) => [u.id, u]));
      setInstances((prev) => prev.map((inst) => map.get(inst.id) ?? inst));
      return updated;
    },
    [selectedEventId],
  );

  // ------ clear all ------
  const clearAll = useCallback(async () => {
    if (!selectedEventId) return;
    await taskInstancesApi.deleteAll(selectedEventId);
    setInstances([]);
  }, [selectedEventId]);

  return (
    <TaskInstanceContext.Provider
      value={{
        instances,
        loading,
        refresh,
        createInstance,
        createInstances,
        updateInstance,
        deleteInstance,
        deleteInstances,
        bulkSetOptimised,
        clearAll,
      }}
    >
      {children}
    </TaskInstanceContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Access task instances for the currently selected event. */
export function useTaskInstances() {
  const ctx = useContext(TaskInstanceContext);
  if (!ctx) {
    throw new Error(
      "useTaskInstances must be used within a TaskInstanceProvider",
    );
  }
  return ctx;
}
