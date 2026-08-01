"use client";

import React, { useState } from "react";
import LocationsContent from "./LocationsContent";
import GroupsContent from "./GroupsContent";

interface ResourcesTabProps {
  selectedEvent: any;
}

export default function ResourcesTab({ selectedEvent }: ResourcesTabProps) {
  const [resourceType, setResourceType] = useState<"locations" | "groups">(
    "locations",
  );

  if (!selectedEvent) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Please select an event to manage its resources.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Event Resources
        </h3>
        <p className="text-sm text-foreground-muted">
          Manage locations and groups for this event
        </p>
      </div>

      {/* Resource Type Tabs */}
      <div className="border-b border-bordercl mb-6">
        <nav className="flex space-x-6">
          <button
            onClick={() => setResourceType("locations")}
            className={`pb-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              resourceType === "locations"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-foreground-muted hover:text-foreground-secondary"
            }`}
          >
            Locations
          </button>
          <button
            onClick={() => setResourceType("groups")}
            className={`pb-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              resourceType === "groups"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-foreground-muted hover:text-foreground-secondary"
            }`}
          >
            Groups
          </button>
        </nav>
      </div>

      {/* Resource Content - Use extracted components */}
      {resourceType === "locations" && (
        <LocationsContent selectedEvent={selectedEvent} />
      )}
      {resourceType === "groups" && (
        <GroupsContent selectedEvent={selectedEvent} />
      )}
    </div>
  );
}
