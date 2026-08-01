"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import {
  generalScheduleApi,
  type AudienceTeam,
} from "@/lib/api";
import { PermittedDataInputNotice } from "@/components/PermittedDataInputNotice";

type AudienceTeamsContentProps = {
  selectedEvent: any;
};

type TeamForm = {
  name: string;
  short_name: string;
  description: string;
};

const blankForm = (): TeamForm => ({
  name: "",
  short_name: "",
  description: "",
});

function teamLabel(team: AudienceTeam): string {
  return team.short_name || team.name;
}

export function AudienceTeamsContent({ selectedEvent }: AudienceTeamsContentProps) {
  const [teams, setTeams] = useState<AudienceTeam[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"view" | "edit" | "create">("view");
  const [selectedItem, setSelectedItem] = useState<AudienceTeam | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [formData, setFormData] = useState<TeamForm>(blankForm());

  const eventId = selectedEvent?.id;

  const fetchTeams = useCallback(async () => {
    if (!eventId) return;
    setIsLoading(true);
    try {
      const teamRows = await generalScheduleApi.getTeams(eventId);
      setTeams(teamRows);
    } catch (error) {
      setValidationMessage(
        error instanceof Error ? error.message : "Failed to load Audience Teams.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void fetchTeams();
  }, [fetchTeams]);

  const openCreate = () => {
    setModalMode("create");
    setSelectedItem(null);
    setValidationMessage(null);
    setFormData(blankForm());
    setShowModal(true);
  };

  const openEdit = (team: AudienceTeam) => {
    setModalMode("edit");
    setSelectedItem(team);
    setValidationMessage(null);
    setFormData({
      name: team.name,
      short_name: team.short_name || "",
      description: team.description || "",
    });
    setShowModal(true);
  };

  const saveTeam = async () => {
    if (!eventId) return;
    if (!formData.name.trim()) {
      setValidationMessage("Name is required.");
      return;
    }

    const payload = {
      name: formData.name.trim(),
      short_name: formData.short_name.trim() || null,
      description: formData.description.trim() || null,
      category_id: null,
    };

    try {
      if (modalMode === "create") {
        await generalScheduleApi.createTeam(eventId, {
          ...payload,
          sort_order: teams.length,
        });
      } else if (modalMode === "edit" && selectedItem) {
        await generalScheduleApi.updateTeam(eventId, selectedItem.id, payload);
      }
      await fetchTeams();
      setShowModal(false);
    } catch (error) {
      setValidationMessage(
        error instanceof Error ? error.message : "Failed to save. Please try again.",
      );
    }
  };

  const deleteTeam = async () => {
    if (!eventId || !selectedItem) return;
    if (!confirm("Are you sure you want to delete this Audience Team?")) return;

    try {
      await generalScheduleApi.deleteTeam(eventId, selectedItem.id);
      await fetchTeams();
      setShowModal(false);
    } catch (error) {
      setValidationMessage(
        error instanceof Error ? error.message : "Failed to delete. Please try again.",
      );
    }
  };

  if (!selectedEvent) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Please select an event to manage Audience Teams.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h3 className="mb-2 text-lg font-semibold text-foreground">Audience Teams</h3>
          <p className="text-sm text-foreground-muted">
            Create target audience labels for Session Elements.
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          + Add Audience Team
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : teams.length === 0 ? (
        <div className="py-12 text-center text-foreground-muted">
          <p>No Audience Teams defined yet.</p>
          <p className="mt-2 text-sm">
            Create audience labels to describe who each Session Element is for.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-bordercl bg-surface">
          <table className="min-w-full divide-y divide-bordercl">
            <thead className="bg-surface-alt">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted">
                  Description
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bordercl bg-surface">
              {teams.map((team) => (
                <tr
                  key={team.id}
                  className="cursor-pointer hover:bg-surface-hover"
                  onDoubleClick={() => openEdit(team)}
                >
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-foreground">
                    {teamLabel(team)}
                    {team.short_name && team.short_name !== team.name && (
                      <span className="ml-2 text-xs font-normal text-foreground-muted">
                        {team.name}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-foreground-muted">
                    {team.description || <span className="text-foreground-faint">None</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-surface shadow-xl">
            <div className="p-6">
              <h3 className="mb-4 text-lg font-semibold text-foreground">
                {modalMode === "create"
                  ? "Create Audience Team"
                  : modalMode === "edit"
                    ? "Edit Audience Team"
                    : "View Audience Team"}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground-secondary">
                    Name *
                  </label>
                  {modalMode === "view" ? (
                    <p className="text-sm text-foreground">{formData.name}</p>
                  ) : (
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(event) =>
                        setFormData({ ...formData, name: event.target.value })
                      }
                      className="w-full rounded-lg border border-bordercl-strong px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                      placeholder="Enter name"
                    />
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground-secondary">
                    Short name
                  </label>
                  {modalMode === "view" ? (
                    <p className="text-sm text-foreground">
                      {formData.short_name || <span className="text-foreground-muted">None</span>}
                    </p>
                  ) : (
                    <input
                      type="text"
                      value={formData.short_name}
                      onChange={(event) =>
                        setFormData({ ...formData, short_name: event.target.value })
                      }
                      className="w-full rounded-lg border border-bordercl-strong px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                      placeholder="Optional short label"
                    />
                  )}
                </div>

                <div>
                  <PermittedDataInputNotice eventId={eventId} />
                  <label className="mb-1 block text-sm font-medium text-foreground-secondary">
                    Internal organiser operational audience-team description
                  </label>
                  {modalMode === "view" ? (
                    <p className="text-sm text-foreground">
                      {formData.description || (
                        <span className="text-foreground-muted">No description</span>
                      )}
                    </p>
                  ) : (
                    <textarea
                      value={formData.description}
                      onChange={(event) =>
                        setFormData({ ...formData, description: event.target.value })
                      }
                      className="min-h-24 w-full rounded-lg border border-bordercl-strong px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                      placeholder="Optional description"
                    />
                  )}
                  <p className="mt-1 text-xs text-foreground-muted">Organisers only. Describe the team's scheduling purpose, not its members.</p>
                </div>

                {validationMessage && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                    {validationMessage}
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-end gap-2">
                {modalMode === "view" ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowModal(false)}
                    >
                      Close
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setModalMode("edit")}
                    >
                      Edit
                    </Button>
                  </>
                ) : (
                  <>
                    {modalMode === "edit" && (
                      <Button variant="danger" size="sm" onClick={deleteTeam}>
                        Delete
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowModal(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={saveTeam}
                      disabled={!formData.name.trim()}
                    >
                      Save
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
