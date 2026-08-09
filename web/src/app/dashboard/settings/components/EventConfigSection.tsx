"use client";

import React, { useState, useEffect } from "react";
import { Button, Input, Card, SwissDateInput } from "@/components/ui";
import { eventsApi, capabilitiesApi } from "@/lib/api";
import { formatDateWithWeekday } from "@/lib/dateFormat";
import {
  DEFAULT_SCHEDULE_DAY_RANGE,
  formatScheduleHourLabel,
  isValidScheduleDayRange,
  MAX_SCHEDULE_DAY_END_HOUR,
  normaliseScheduleDayRange,
  type ScheduleDayRange,
} from "@/lib/scheduleDayRange";

interface Capability {
  id: number;
  name: string;
  machine_name: string;
  capability_type_id?: number | null;
}

interface CapabilityType {
  id: number;
  name: string;
  sort_order: number;
}

interface EventConfigProps {
  selectedEvent: any;
  onEventUpdated: (event: any) => void;
}

function getDaysArray(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  const current = new Date(start);
  while (current <= end) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, "0");
    const d = String(current.getDate()).padStart(2, "0");
    days.push(`${y}-${m}-${d}`);
    current.setDate(current.getDate() + 1);
  }
  return days;
}

export function EventConfigSection({
  selectedEvent,
  onEventUpdated,
}: EventConfigProps) {
  const [eventForm, setEventForm] = useState({
    name: "",
    location: "",
    start_date: "",
    end_date: "",
  });
  const [dayAliases, setDayAliases] = useState<{ [date: string]: string }>({});
  const [scheduleDayRange, setScheduleDayRange] =
    useState<ScheduleDayRange>(DEFAULT_SCHEDULE_DAY_RANGE);

  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [allCapabilities, setAllCapabilities] = useState<Capability[]>([]);
  const [enabledCapIds, setEnabledCapIds] = useState<number[] | null>(null);
  const [allEnabled, setAllEnabled] = useState(true);

  useEffect(() => {
    if (selectedEvent) {
      setEventForm({
        name: selectedEvent.name || "",
        location: selectedEvent.location || "",
        start_date: selectedEvent.start_date || "",
        end_date: selectedEvent.end_date || "",
      });
      setDayAliases(selectedEvent.meta_data?.day_aliases || {});
      setScheduleDayRange(
        normaliseScheduleDayRange(selectedEvent.meta_data?.schedule_day_range),
      );

      // Capability filtering
      const capIds = selectedEvent.enabled_capability_ids;
      if (capIds === null || capIds === undefined) {
        setAllEnabled(true);
        setEnabledCapIds(null);
      } else {
        setAllEnabled(false);
        setEnabledCapIds(capIds);
      }

      // Load all capabilities (global catalog)
      capabilitiesApi.getAll().then(setAllCapabilities).catch(console.error);
    }
  }, [selectedEvent]);

  const handleSave = async () => {
    if (!selectedEvent) return;
    setIsSaving(true);
    setMessage("");
    try {
      if (!isValidScheduleDayRange(scheduleDayRange)) {
        setMessage("Error: Schedule display range end time must be after start time.");
        return;
      }
      const {
        schedule_day_boundary: _removedScheduleDayBoundary,
        ...existingMetaData
      } = selectedEvent.meta_data || {};

      const updated = await eventsApi.update(selectedEvent.id, {
        name: eventForm.name,
        location: eventForm.location,
        start_date: eventForm.start_date,
        end_date: eventForm.end_date,
        meta_data: {
          ...existingMetaData,
          day_aliases: dayAliases,
          schedule_day_range: scheduleDayRange,
        },
      });

      // Save enabled capabilities
      await eventsApi.updateCapabilities(
        selectedEvent.id,
        allEnabled ? null : enabledCapIds,
      );

      onEventUpdated({
        ...updated,
        enabled_capability_ids: allEnabled ? null : enabledCapIds,
      });
      setMessage("Event settings saved!");
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const days =
    eventForm.start_date && eventForm.end_date
      ? getDaysArray(eventForm.start_date, eventForm.end_date)
      : [];
  const startHourOptions = Array.from({ length: 24 }, (_, hour) => hour);
  const endHourOptions = Array.from(
    { length: MAX_SCHEDULE_DAY_END_HOUR },
    (_, index) => index + 1,
  );

  return (
    <div className="space-y-8">
      {/* Message */}
      {message && (
        <div
          className={`p-3 rounded-lg text-sm ${
            message.startsWith("Error")
              ? "bg-red-50 dark:bg-red-950/30 text-red-800 border border-red-200 dark:border-red-800"
              : "bg-green-50 dark:bg-green-950/30 text-green-800 border border-green-200 dark:border-green-800"
          }`}
        >
          {message}
        </div>
      )}

      {/* Basic Event Info */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-1">
          Event Configuration
        </h3>
        <p className="text-sm text-foreground-muted mb-4">
          Set the participant-visible event identity, date range, and day aliases.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">
              Participant-visible event name
            </label>
            <Input
              value={eventForm.name}
              onChange={(e) =>
                setEventForm({ ...eventForm, name: e.target.value })
              }
              placeholder="e.g. EYP Session Berlin 2026"
            />
            <p className="mt-1 text-xs text-foreground-muted">
              Shown to authorised participants and in published schedule context.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">
              Participant-visible operational event location
            </label>
            <Input
              value={eventForm.location}
              onChange={(e) =>
                setEventForm({ ...eventForm, location: e.target.value })
              }
              placeholder="e.g. Berlin, Germany"
            />
            <p className="mt-1 text-xs text-foreground-muted">
              Use only the location participants need for event operations.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Start Date
              </label>
              <Input
                type="date"
                value={eventForm.start_date}
                onChange={(e) =>
                  setEventForm({ ...eventForm, start_date: e.target.value })
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                End Date
              </label>
              <Input
                type="date"
                value={eventForm.end_date}
                onChange={(e) =>
                  setEventForm({ ...eventForm, end_date: e.target.value })
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* Day Aliases */}
      {days.length > 0 && (
        <div>
          <h4 className="text-base font-semibold text-foreground mb-1">
            Day Aliases
          </h4>
          <p className="text-sm text-foreground-muted mb-3">
            Assign friendly names to each event day.
          </p>
          <div className="space-y-2">
            {days.map((date, index) => {
              const dateObj = new Date(date + "T00:00:00");
              const formatted = formatDateWithWeekday(date);
              return (
                <div key={date} className="flex items-center gap-3">
                  <div className="w-20 text-sm text-foreground-secondary font-medium">
                    Day {index + 1}
                  </div>
                  <input
                    type="text"
                    value={dayAliases[date] || ""}
                    onChange={(e) =>
                      setDayAliases({ ...dayAliases, [date]: e.target.value })
                    }
                    placeholder={formatted}
                    className="flex-1 px-3 py-1.5 text-sm border border-bordercl-strong rounded-lg"
                  />
                  <div className="w-36 text-sm text-foreground-muted">{formatted}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Schedule Display Range */}
      <div>
        <h4 className="text-base font-semibold text-foreground mb-1">
          Schedule Display Range
        </h4>
        <p className="text-sm text-foreground-muted mb-3">
          Choose the default visible hours for this event's schedule views. Use
          a next-day end time when the working day continues after midnight.
          Tasks outside this range are not changed.
        </p>
        <Card>
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-sm font-medium text-foreground-secondary mb-1">
                  Start time
                </span>
                <select
                  value={scheduleDayRange.startHour}
                  onChange={(event) =>
                    setScheduleDayRange((range) => ({
                      ...range,
                      startHour: Number(event.target.value),
                    }))
                  }
                  className="w-full px-3 py-2 text-sm border border-bordercl-strong rounded-lg bg-surface text-foreground"
                >
                  {startHourOptions.map((hour) => (
                    <option key={hour} value={hour}>
                      {formatScheduleHourLabel(hour)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-foreground-secondary mb-1">
                  End time
                </span>
                <select
                  value={scheduleDayRange.endHour}
                  onChange={(event) =>
                    setScheduleDayRange((range) => ({
                      ...range,
                      endHour: Number(event.target.value),
                    }))
                  }
                  className="w-full px-3 py-2 text-sm border border-bordercl-strong rounded-lg bg-surface text-foreground"
                >
                  {endHourOptions.map((hour) => (
                    <option key={hour} value={hour}>
                      {formatScheduleHourLabel(hour)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!isValidScheduleDayRange(scheduleDayRange) && (
              <p className="mt-2 text-sm text-red-600">
                Schedule display range end time must be after start time.
              </p>
            )}
            <p className="mt-2 text-xs text-foreground-muted">
              Example: an end time of 04:00 (next day) means tasks before 04:00
              count towards the previous working day.
            </p>
          </div>
        </Card>
      </div>

      {/* Enabled Capabilities */}
      {allCapabilities.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-foreground mb-2">
            Enabled Capabilities
          </h4>
          <p className="text-sm text-foreground-muted mb-3">
            Choose which capabilities are available for this event. Unchecking a
            capability hides it from person and task dropdowns.
          </p>
          <Card>
            <div className="p-4 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={allEnabled}
                  onChange={(e) => {
                    setAllEnabled(e.target.checked);
                    if (e.target.checked) {
                      setEnabledCapIds(null);
                    } else {
                      setEnabledCapIds(allCapabilities.map((c) => c.id));
                    }
                  }}
                  className="rounded text-blue-600"
                />
                All capabilities enabled
              </label>
              {!allEnabled && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-bordercl-subtle">
                  {allCapabilities.map((cap) => (
                    <label
                      key={cap.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={enabledCapIds?.includes(cap.id) ?? false}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setEnabledCapIds([
                              ...(enabledCapIds || []),
                              cap.id,
                            ]);
                          } else {
                            setEnabledCapIds(
                              (enabledCapIds || []).filter(
                                (id) => id !== cap.id,
                              ),
                            );
                          }
                        }}
                        className="rounded text-blue-600"
                      />
                      {cap.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      <Button variant="primary" onClick={handleSave} disabled={isSaving}>
        {isSaving ? "Saving..." : "Save Event Settings"}
      </Button>
    </div>
  );
}
