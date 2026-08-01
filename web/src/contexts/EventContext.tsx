"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { getApiUrl } from "@/lib/environment";

/** Event summary loaded into the global event picker. */
export type SelectedEvent = {
  id: number;
  name: string;
  location: string;
  start_date: string;
  end_date: string;
  status?: string;
  google_calendar_id?: string | null;
  enabled_capability_ids?: number[] | null;
  meta_data?: {
    day_aliases?: { [date: string]: string };
    schedule_day_range?: {
      startHour: number;
      endHour: number;
    };
  };
};

/** Context value for selected event state and event list refresh. */
export interface EventContextType {
  selectedEventId: number | null;
  setSelectedEventId: (id: number | null) => void;
  availableEvents: SelectedEvent[];
  isLoadingEvents: boolean;
  refreshEvents: () => Promise<void>;
}

const EventContext = createContext<EventContextType | undefined>(undefined);

const SESSION_KEY = "masterplan_selected_event_id";

/** Provide selected-event state and available-event loading to dashboard pages. */
export function EventProvider({ children }: { children: React.ReactNode }) {
  const [selectedEventId, setSelectedEventIdState] = useState<number | null>(
    () => {
      if (typeof window !== "undefined") {
        const stored = sessionStorage.getItem(SESSION_KEY);
        return stored ? Number(stored) : null;
      }
      return null;
    },
  );
  const [availableEvents, setAvailableEvents] = useState<SelectedEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);

  const setSelectedEventId = useCallback((id: number | null) => {
    setSelectedEventIdState(id);
    if (typeof window !== "undefined") {
      if (id !== null) {
        sessionStorage.setItem(SESSION_KEY, String(id));
      } else {
        sessionStorage.removeItem(SESSION_KEY);
      }
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      setIsLoadingEvents(true);
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/v1/events`);

      if (!response.ok) {
        throw new Error("Failed to load events");
      }

      const data: SelectedEvent[] = await response.json();
      setAvailableEvents(data);

      // If the stored selection is stale (deleted event), clear it
      if (
        selectedEventId !== null &&
        !data.find((e) => e.id === selectedEventId)
      ) {
        setSelectedEventId(null);
      }
    } catch (error) {
      console.error("Error loading events:", error);
    } finally {
      setIsLoadingEvents(false);
    }
  }, [selectedEventId, setSelectedEventId]);

  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <EventContext.Provider
      value={{
        selectedEventId,
        setSelectedEventId,
        availableEvents,
        isLoadingEvents,
        refreshEvents: loadEvents,
      }}
    >
      {children}
    </EventContext.Provider>
  );
}

/** Read and update the current event selection. */
export function useEvent() {
  const context = useOptionalEvent();
  if (context === undefined) {
    throw new Error("useEvent must be used within an EventProvider");
  }
  return context;
}

/** Read the current event selection when a provider may legitimately be absent. */
export function useOptionalEvent() {
  return useContext(EventContext);
}
