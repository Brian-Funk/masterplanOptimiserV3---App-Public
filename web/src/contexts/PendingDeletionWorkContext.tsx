"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { eventsApi, mpBackendApi } from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";

interface PendingDeletionWorkState {
  configured: boolean;
  pending: number;
  pendingEventIds: number[];
  refresh: () => Promise<void>;
}

const PendingDeletionWorkContext = createContext<PendingDeletionWorkState>({
  configured: false,
  pending: 0,
  pendingEventIds: [],
  refresh: async () => {},
});

export function PendingDeletionWorkProvider({ children }: { children: React.ReactNode }) {
  const { addToast } = useToast();
  const [configured, setConfigured] = useState(false);
  const [pending, setPending] = useState(0);
  const [pendingEventIds, setPendingEventIds] = useState<number[]>([]);
  const lastNoticeCount = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const events = await eventsApi.getAll();
      if (!Array.isArray(events)) return;
      const statuses = await Promise.all(
        events.map(async (event) => {
          try {
            const status = await mpBackendApi.getDeletionWorkOrderStatus(event.id);
            return { eventId: event.id, configured: true, pending: status.pending };
          } catch {
            // An event without MP-Backend configuration is not an error for the
            // global poll. Configured events are checked by the status endpoint.
            return { eventId: event.id, configured: false, pending: 0 };
          }
        }),
      );
      const nextPending = statuses.reduce((total, status) => total + status.pending, 0);
      const nextEventIds = statuses
        .filter((status) => status.pending > 0)
        .map((status) => status.eventId);
      setConfigured(statuses.some((status) => status.configured));
      setPending(nextPending);
      setPendingEventIds(nextEventIds);
      if (nextPending > 0 && lastNoticeCount.current === 0) {
        addToast(
          nextPending === 1
            ? "A Server deletion request is waiting. Open MP-Backend settings to review it."
            : `${nextPending} Server deletion requests are waiting. Open MP-Backend settings to review them.`,
          "warning",
        );
      }
      lastNoticeCount.current = nextPending;
    } catch {
      // Normal Desktop operation must continue if the read-only global poll is
      // temporarily unavailable. The next interval or focus event retries it.
    }
  }, [addToast]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const onFocus = () => void refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  return (
    <PendingDeletionWorkContext.Provider
      value={{ configured, pending, pendingEventIds, refresh }}
    >
      {children}
    </PendingDeletionWorkContext.Provider>
  );
}

export function usePendingDeletionWork() {
  return useContext(PendingDeletionWorkContext);
}

export function GlobalPendingDeletionWorkBanner() {
  const router = useRouter();
  const { pending, pendingEventIds } = usePendingDeletionWork();

  if (pending === 0) return null;

  const openSettings = () => {
    if (pendingEventIds.length > 0) {
      sessionStorage.setItem("masterplan_selected_event_id", String(pendingEventIds[0]));
    }
    router.push("/dashboard/settings?section=mp-backend");
  };

  return (
    <div
      role="status"
      className="border-b border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <button
        type="button"
        onClick={openSettings}
        className="flex w-full items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:bg-amber-100 dark:hover:bg-amber-950/60"
      >
        <ShieldAlert className="h-4 w-4 shrink-0" />
        {pending === 1
          ? "A Server deletion request is waiting. Review it in MP-Backend settings."
          : `${pending} Server deletion requests are waiting. Review them in MP-Backend settings.`}
      </button>
    </div>
  );
}
