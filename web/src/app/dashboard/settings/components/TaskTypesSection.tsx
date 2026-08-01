"use client";

import React, { useState, useEffect } from "react";
import { Button, Modal, Tooltip } from "@/components/ui";
import { taskTypesApi } from "@/lib/api";
import type { TaskType } from "@/lib/api";
import { GCAL_PALETTE, gcalColorLabel } from "@/lib/gcalColors";
import { PermittedDataInputNotice } from "@/components/PermittedDataInputNotice";

/** Manage task-type colour, fatigue, ordering, and working-time policy. */
export function TaskTypesSection() {
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<TaskType | null>(null);
  const [formData, setFormData] = useState<any>({
    name: "",
    description: "",
    color: GCAL_PALETTE[0].background,
    sort_order: 0,
    is_active: true,
    fatigue_score: 0,
    counts_towards_work_time: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const data = await taskTypesApi.getAll();
      setTaskTypes(data);
    } catch (e) {
      console.error("Failed to fetch task types:", e);
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setFormData({
      name: "",
      description: "",
      color: GCAL_PALETTE[0].background,
      sort_order: 0,
      is_active: true,
      fatigue_score: 0,
      counts_towards_work_time: true,
    });
    setError("");
    setShowModal(true);
  };

  const openEdit = (tt: TaskType) => {
    setEditing(tt);
    setFormData({
      name: tt.name,
      description: tt.description || "",
      color: tt.color || GCAL_PALETTE[0].background,
      sort_order: tt.sort_order || 0,
      is_active: tt.is_active,
      fatigue_score: tt.fatigue_score || 0,
      counts_towards_work_time: tt.counts_towards_work_time !== false,
    });
    setError("");
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: formData.name,
        description: formData.description || undefined,
        color: formData.color || undefined,
        sort_order: formData.sort_order,
        is_active: formData.is_active,
        fatigue_score: formData.fatigue_score,
        counts_towards_work_time: formData.counts_towards_work_time,
      };
      if (editing) {
        await taskTypesApi.update(editing.id, payload);
      } else {
        await taskTypesApi.create(payload as any);
      }
      setShowModal(false);
      fetchData();
    } catch (e: any) {
      setError(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (tt: TaskType) => {
    if (!confirm(`Delete task type "${tt.name}"?`)) return;
    try {
      await taskTypesApi.delete(tt.id);
      fetchData();
    } catch (e: any) {
      alert(e.message || "Failed to delete");
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Task Types</h3>
          <p className="text-sm text-foreground-muted mt-1">
            Categories for tasks with colours, fatigue and working-time rules
          </p>
        </div>
        <Button variant="primary" onClick={openAdd}>
          + Add Task Type
        </Button>
      </div>

      {taskTypes.length === 0 ? (
        <div className="text-center py-12 text-foreground-muted">
          <p>No task types defined yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-bordercl">
            <thead className="bg-surface-alt">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">
                  Order
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">
                  Description
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">
                  Colour
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">
                  Fatigue
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">
                  Working Time
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-surface divide-y divide-bordercl">
              {taskTypes.map((tt) => (
                <tr key={tt.id}>
                  <td className="px-4 py-3 text-sm text-foreground">
                    {tt.sort_order}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-foreground">
                    {tt.name}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">
                    {tt.description || "-"}
                  </td>
                  <td className="px-4 py-3">
                    {tt.color ? (
                      <div className="flex items-center gap-2">
                        <div
                          className="w-6 h-6 rounded border border-bordercl-strong"
                          style={{ backgroundColor: tt.color }}
                        />
                        <span className="text-xs font-mono text-foreground-muted">
                          {tt.color}
                        </span>
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground">
                    {tt.fatigue_score}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground">
                    {tt.counts_towards_work_time === false
                      ? "Excluded"
                      : "Counted"}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <button
                      onClick={() => openEdit(tt)}
                      className="text-blue-600 hover:text-blue-800 mr-3"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(tt)}
                      className="text-red-600 hover:text-red-800"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <Modal
          open={showModal}
          onClose={() => setShowModal(false)}
          maxWidth="md"
        >
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-4">
              {editing ? "Edit Task Type" : "Add Task Type"}
            </h3>
            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-bordercl-strong rounded-lg"
                  placeholder="e.g., Workshop"
                />
              </div>
              <div>
                <PermittedDataInputNotice />
                <label className="block text-sm font-medium text-foreground-secondary mb-1">
                  Internal organiser operational task-type description
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-bordercl-strong rounded-lg"
                />
                <p className="mt-1 text-xs text-foreground-muted">Organisers only. Describe scheduling behaviour, not a participant.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-1">
                  Colour
                </label>
                <div className="flex flex-wrap gap-2 justify-center">
                  {GCAL_PALETTE.map((c) => (
                    <Tooltip
                      key={c.id}
                      content={gcalColorLabel(c.id)}
                      side="top"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setFormData({ ...formData, color: c.background })
                        }
                        className={`w-6 h-6 rounded-full transition-all ${
                          formData.color === c.background
                            ? "ring-2 ring-offset-2 scale-110"
                            : "hover:scale-105"
                        }`}
                        style={{
                          background: c.background,
                          ["--tw-ring-color" as string]: c.background,
                        }}
                      />
                    </Tooltip>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-1">
                  Sort Order
                </label>
                <input
                  type="number"
                  value={formData.sort_order}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      sort_order: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3 py-2 border border-bordercl-strong rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-1">
                  Fatigue Score
                </label>
                <input
                  type="number"
                  value={formData.fatigue_score}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      fatigue_score: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3 py-2 border border-bordercl-strong rounded-lg"
                />
                <p className="mt-1 text-xs text-foreground-muted">
                  Fatigue impact per minute (positive = straining, negative =
                  restoring)
                </p>
              </div>
              <label className="flex items-start gap-3 rounded-lg border border-bordercl bg-surface-alt px-3 py-3">
                <input
                  type="checkbox"
                  checked={formData.counts_towards_work_time}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      counts_towards_work_time: e.target.checked,
                    })
                  }
                  className="mt-0.5 h-4 w-4 rounded border-bordercl-strong"
                />
                <span>
                  <span className="block text-sm font-medium text-foreground-secondary">
                    Count towards working-time limit
                  </span>
                  <span className="mt-1 block text-xs text-foreground-muted">
                    Applies to every task of this type. Turn this off for sleep,
                    rest or standby. Assigned people remain reserved and
                    availability and location still apply.
                  </span>
                </span>
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowModal(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={saving || !formData.name.trim()}
                >
                  {saving ? "Saving..." : editing ? "Update" : "Create"}
                </Button>
              </div>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
}
