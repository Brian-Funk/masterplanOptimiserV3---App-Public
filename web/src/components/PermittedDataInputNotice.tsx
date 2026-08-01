"use client";

import { useEffect, useState } from "react";
import { useOptionalEvent } from "@/contexts/EventContext";
import { mpBackendApi, type MpBackendDataPolicy } from "@/lib/api";

export function PermittedDataInputNotice({ eventId }: { eventId?: number | null }) {
  const eventContext = useOptionalEvent();
  const resolvedEventId = eventContext
    ? eventId ?? eventContext.selectedEventId
    : null;
  const [policy, setPolicy] = useState<MpBackendDataPolicy | null>(null);

  useEffect(() => {
    let active = true;
    setPolicy(null);
    if (!resolvedEventId) return () => { active = false; };
    void mpBackendApi.getDataPolicy(resolvedEventId)
      .then((value) => { if (active) setPolicy(value); })
      .catch(() => { if (active) setPolicy(null); });
    return () => { active = false; };
  }, [resolvedEventId]);

  if (policy?.acknowledged) {
    return (
      <div className="space-y-1 text-xs text-foreground-muted">
        <p>
          Operational data only -{" "}
          <a className="underline" href={policy.policy_url} target="_blank" rel="noreferrer">
            View permitted-data rules v{policy.policy_version}
          </a>
          {policy.controller_identity ? ` for ${policy.controller_identity}` : ""}.
          {policy.retention_days ? ` Event data uses the controller-selected ${policy.retention_days}-day grace period.` : ""}
        </p>
        <p>
          <a className="underline" href={policy.privacy_url} target="_blank" rel="noreferrer">View the exact privacy notice</a>.{" "}
          {policy.enabled_optional_features.length > 0 ? `Enabled policy features: ${policy.enabled_optional_features.join(", ")}.` : "No optional policy features are enabled."}
        </p>
        {policy.incident_contact ? (
          <p>
            Report security or privacy incidents to{" "}
            <a className="underline" href={`mailto:${policy.incident_contact}`}>{policy.incident_contact}</a>.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <aside className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
      <p className="font-semibold">Operational information only</p>
      <p className="mt-1">
        Do not enter health, dietary, safeguarding, political, religious, identity,
        disciplinary or unrelated private information.
      </p>
      {policy ? (
        <>
          <a className="mt-1 inline-block underline" href={policy.policy_url} target="_blank" rel="noreferrer">
            View exact permitted-data rules v{policy.policy_version}
            {policy.controller_identity ? ` for ${policy.controller_identity}` : ""}
          </a>
          <p className="mt-1">
            {policy.retention_days ? `Controller-selected event retention grace: ${policy.retention_days} days. ` : ""}
            {policy.enabled_optional_features.length > 0 ? `Enabled policy features: ${policy.enabled_optional_features.join(", ")}.` : "No optional policy features are enabled."}
          </p>
          <a className="mt-1 inline-block underline" href={policy.privacy_url} target="_blank" rel="noreferrer">View the exact privacy notice</a>
          {policy.incident_contact ? (
            <p className="mt-1">
              Report security or privacy incidents to{" "}
              <a className="underline" href={`mailto:${policy.incident_contact}`}>{policy.incident_contact}</a>.
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-1">Select and configure an event to review its exact Server policy.</p>
      )}
    </aside>
  );
}
