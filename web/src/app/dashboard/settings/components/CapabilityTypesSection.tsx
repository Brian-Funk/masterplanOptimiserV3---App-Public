"use client";

import React, { useState, useEffect } from "react";
import { Button, Modal } from "@/components/ui";
import { PermittedDataInputNotice } from "@/components/PermittedDataInputNotice";
import { capabilityTypesApi, CapabilityType } from "@/lib/api";

export function CapabilityTypesSection() {
  const [capabilityTypes, setCapabilityTypes] = useState<CapabilityType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CapabilityType | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    color: "#3B82F6",
    sort_order: 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const data = await capabilityTypesApi.getAll();
      setCapabilityTypes(data);
    } catch (e) {
      console.error("Failed to fetch capability types:", e);
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setFormData({ name: "", description: "", color: "#3B82F6", sort_order: 0 });
    setError("");
    setShowModal(true);
  };

  const openEdit = (ct: CapabilityType) => {
    setEditing(ct);
    setFormData({
      name: ct.name,
      description: ct.description || "",
      color: ct.color || "#3B82F6",
      sort_order: ct.sort_order || 0,
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
        color: formData.color,
        sort_order: formData.sort_order,
      };
      if (editing) {
        await capabilityTypesApi.update(editing.id, payload);
      } else {
        await capabilityTypesApi.create(payload as any);
      }
      setShowModal(false);
      fetchData();
    } catch (e: any) {
      setError(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ct: CapabilityType) => {
    if (!confirm(`Delete capability type "${ct.name}"?`)) return;
    try {
      await capabilityTypesApi.delete(ct.id);
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
          <h3 className="text-lg font-semibold text-foreground">
            Capability Types
          </h3>
          <p className="text-sm text-foreground-muted mt-1">
            Categories for organising capabilities with colours and sort order
          </p>
        </div>
        <Button variant="primary" onClick={openAdd}>
          + Add Type
        </Button>
      </div>

      {capabilityTypes.length === 0 ? (
        <div className="text-center py-12 text-foreground-muted">
          <p>No capability types defined yet.</p>
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
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-surface divide-y divide-bordercl">
              {capabilityTypes.map((ct) => (
                <tr key={ct.id}>
                  <td className="px-4 py-3 text-sm text-foreground">
                    {ct.sort_order}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-foreground">
                    {ct.name}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">
                    {ct.description || "-"}
                  </td>
                  <td className="px-4 py-3">
                    {ct.color ? (
                      <div className="flex items-center gap-2">
                        <div
                          className="w-6 h-6 rounded border border-bordercl-strong"
                          style={{ backgroundColor: ct.color }}
                        />
                        <span className="text-xs font-mono text-foreground-muted">
                          {ct.color}
                        </span>
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <button
                      onClick={() => openEdit(ct)}
                      className="text-blue-600 hover:text-blue-800 mr-3"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(ct)}
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
            <h3 className="text-lg font-semibold text-foreground mb-4">
              {editing ? "Edit Capability Type" : "Add Capability Type"}
            </h3>
            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
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
                  placeholder="e.g., Technical, Leadership"
                />
              </div>
              <div>
                <PermittedDataInputNotice />
                <label className="block text-sm font-medium text-foreground-secondary mb-1">
                  Internal organiser operational capability-category description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-bordercl-strong rounded-lg"
                  rows={2}
                />
                <p className="mt-1 text-xs text-foreground-muted">Organisers only. Describe the category, not any individual.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-1">
                  Sort Order *
                </label>
                <input
                  type="number"
                  required
                  value={formData.sort_order}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      sort_order: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3 py-2 border border-bordercl-strong rounded-lg"
                />
                <p className="mt-1 text-xs text-foreground-muted">
                  Lower values appear first
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-1">
                  Colour *
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={formData.color}
                    onChange={(e) =>
                      setFormData({ ...formData, color: e.target.value })
                    }
                    className="h-10 w-16 border border-bordercl-strong rounded-lg cursor-pointer"
                  />
                  <input
                    type="text"
                    required
                    value={formData.color}
                    onChange={(e) =>
                      setFormData({ ...formData, color: e.target.value })
                    }
                    className="flex-1 px-3 py-2 border border-bordercl-strong rounded-lg font-mono text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={
                    saving || !formData.name.trim() || !formData.color.trim()
                  }
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
