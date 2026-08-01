"use client";

import React, { useState, useEffect } from "react";
import {
  personsApi,
  googleCalendarApi,
  GoogleCalendarConnection,
  CalendarMember,
  Person,
} from "@/lib/api";

interface CalendarPersonLinkingProps {
  eventId: number;
}

export function CalendarPersonLinking({ eventId }: CalendarPersonLinkingProps) {
  const [persons, setPersons] = useState<Person[]>([]);
  const [emailOptions, setEmailOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [customEmail, setCustomEmail] = useState("");

  useEffect(() => {
    loadData();
  }, [eventId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const personsList = await personsApi.getAll(eventId);
      setPersons(personsList);

      // Build email suggestions from persons' own emails + any Google OAuth connections
      const emails = new Set<string>();
      for (const p of personsList) {
        if (p.email) emails.add(p.email);
        if (p.google_email) emails.add(p.google_email);
      }

      // Try to load Google OAuth connections and their calendar members
      try {
        const connections = await googleCalendarApi.getConnections();
        for (const conn of connections) {
          if (conn.account_email) emails.add(conn.account_email);
          if (conn.calendar_id) {
            try {
              const members = await googleCalendarApi.listMembers(
                conn.id,
                conn.calendar_id,
              );
              for (const m of members) {
                if (m.email && !m.email.endsWith("@group.calendar.google.com"))
                  emails.add(m.email);
              }
            } catch {
              // Calendar members may not be available
            }
          }
        }
      } catch {
        // No Google OAuth connections - that's fine, use person emails
      }

      setEmailOptions(Array.from(emails).sort());
    } catch (e: any) {
      console.error("Failed to load data:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleLinkChange = async (person: Person, googleEmail: string) => {
    setSaving(person.id);
    setMessage("");
    try {
      const updated = await personsApi.update(person.id, eventId, {
        google_email: googleEmail || null,
      });
      setPersons((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p)),
      );
      setMessage(`Updated ${person.first_name} ${person.last_name}`);
      setEditingId(null);
      setCustomEmail("");
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="text-sm text-foreground-muted py-4">
        Loading person-calendar links...
      </div>
    );
  }

  if (persons.length === 0) {
    return (
      <div className="text-sm text-foreground-muted py-4">
        No persons found for this event.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-1">
          Link Persons to Google Accounts
        </h3>
        <p className="text-sm text-foreground-muted mb-4">
          Select or type the Google email each person uses. This is used when
          publishing tasks to Google Calendar to add them as attendees.
        </p>
      </div>

      {message && (
        <div
          className={`p-2 rounded text-sm ${
            message.startsWith("Error")
              ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400"
              : "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400"
          }`}
        >
          {message}
        </div>
      )}

      <div className="border border-bordercl rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-alt">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted uppercase">
                Person
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted uppercase">
                Email
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-foreground-muted uppercase">
                Google Account
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bordercl-subtle">
            {persons.map((person) => (
              <tr key={person.id} className="hover:bg-surface-hover">
                <td className="px-4 py-2 font-medium text-foreground">
                  {person.first_name} {person.last_name}
                </td>
                <td className="px-4 py-2 text-foreground-muted">
                  {person.email}
                </td>
                <td className="px-4 py-2">
                  {editingId === person.id ? (
                    <div className="flex gap-1">
                      <input
                        type="email"
                        value={customEmail}
                        onChange={(e) => setCustomEmail(e.target.value)}
                        placeholder="custom@gmail.com"
                        className="flex-1 px-2 py-1 text-sm border border-bordercl-strong rounded-lg"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleLinkChange(person, customEmail);
                          } else if (e.key === "Escape") {
                            setEditingId(null);
                            setCustomEmail("");
                          }
                        }}
                        autoFocus
                      />
                      <button
                        onClick={() => handleLinkChange(person, customEmail)}
                        disabled={saving === person.id}
                        className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(null);
                          setCustomEmail("");
                        }}
                        className="px-2 py-1 text-xs text-foreground-muted hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <select
                        value={person.google_email || ""}
                        onChange={(e) => {
                          if (e.target.value === "__custom__") {
                            setEditingId(person.id);
                            setCustomEmail(
                              person.google_email || person.email || "",
                            );
                          } else {
                            handleLinkChange(person, e.target.value);
                          }
                        }}
                        disabled={saving === person.id}
                        className="flex-1 px-2 py-1.5 text-sm border border-bordercl-strong rounded-lg bg-surface disabled:opacity-50"
                      >
                        <option value="">- Not linked -</option>
                        {emailOptions.map((email) => (
                          <option key={email} value={email}>
                            {email}
                          </option>
                        ))}
                        {/* Show current google_email if not in options */}
                        {person.google_email &&
                          !emailOptions.includes(person.google_email) && (
                            <option value={person.google_email}>
                              {person.google_email}
                            </option>
                          )}
                        <option value="__custom__">Type custom email...</option>
                      </select>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
