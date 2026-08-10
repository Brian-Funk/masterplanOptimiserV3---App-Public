"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useOptionalEvent } from "@/contexts/EventContext";
import { mpBackendApi, type MpBackendDataPolicy } from "@/lib/api";

const NOTICE_STORAGE_PREFIX = "mp-opt:permitted-data-notice:";

function noticeStorageKey(policy: MpBackendDataPolicy | null): string {
  const identity = policy?.policy_sha256 ||
    (policy ? `version-${policy.policy_version}` : "policy-unavailable");
  return `${NOTICE_STORAGE_PREFIX}${identity}`;
}

export function PermittedDataInputNotice({ eventId }: { eventId?: number | null }) {
  const eventContext = useOptionalEvent();
  const resolvedEventId = eventContext
    ? eventId ?? eventContext.selectedEventId
    : null;
  const [policy, setPolicy] = useState<MpBackendDataPolicy | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    setPolicy(null);
    setLoaded(false);
    setDismissed(false);
    if (!resolvedEventId) return () => { active = false; };
    void mpBackendApi.getDataPolicy(resolvedEventId)
      .then((value) => {
        if (!active) return;
        setPolicy(value);
        try {
          setDismissed(localStorage.getItem(noticeStorageKey(value)) === "dismissed");
        } catch {
          setDismissed(false);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setPolicy(null);
        try {
          setDismissed(localStorage.getItem(noticeStorageKey(null)) === "dismissed");
        } catch {
          setDismissed(false);
        }
        setLoaded(true);
      });
    return () => { active = false; };
  }, [resolvedEventId]);

  if (!resolvedEventId || !loaded || dismissed) {
    return null;
  }

  const dismiss = () => {
    try {
      localStorage.setItem(noticeStorageKey(policy), "dismissed");
    } catch {
      // The notice remains dismissible for this session when storage is unavailable.
    }
    setDismissed(true);
  };

  return (
    <aside className="mb-5 flex items-start gap-3 rounded-lg border border-bordercl bg-surface px-4 py-3 text-sm text-foreground-secondary shadow-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">Operational data only</p>
        <p className="mt-0.5 text-xs text-foreground-muted">
          Use only necessary scheduling and operational information. Do not enter sensitive or unrelated private information.
        </p>
      {policy ? (
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <a className="underline" href={policy.policy_url} target="_blank" rel="noreferrer">
            Permitted-data rules v{policy.policy_version}
          </a>
          <a className="underline" href={policy.privacy_url} target="_blank" rel="noreferrer">
            Privacy notice
          </a>
        </p>
      ) : (
        <p className="mt-1 text-xs text-foreground-muted">
          Connect this event to the Server to review its exact policy.
        </p>
      )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="rounded-md p-1 text-foreground-muted hover:bg-surface-hover hover:text-foreground"
        aria-label="Dismiss permitted-data guidance"
      >
        <X className="h-4 w-4" />
      </button>
    </aside>
  );
}
