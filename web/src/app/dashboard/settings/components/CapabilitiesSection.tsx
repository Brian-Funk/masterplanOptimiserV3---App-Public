"use client";

import React, { useState, useEffect } from "react";
import { Button, Modal } from "@/components/ui";
import { PermittedDataInputNotice } from "@/components/PermittedDataInputNotice";
import {
  capabilitiesApi,
  capabilityTypesApi,
  Capability,
  CapabilityType,
} from "@/lib/api";

export function CapabilitiesSection() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [capabilityTypes, setCapabilityTypes] = useState<CapabilityType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Capability | null>(null);
  const [formData, setFormData] = useState({
    machine_name: "",
    name: "",
    description: "",
    capability_type_id: 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [caps, types] = await Promise.all([
        capabilitiesApi.getAll(),
        capabilityTypesApi.getAll(),
      ]);
      setCapabilities(caps);
      setCapabilityTypes(types);
    } catch (e) {
      console.error("Failed to fetch:", e);
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setFormData({
      machine_name: "",
      name: "",
      description: "",
      capability_type_id: capabilityTypes[0]?.id ?? 0,
    });
    setError("");
    setShowModal(true);
  };

  const openEdit = (cap: Capability) => {
    setEditing(cap);
    setFormData({
      machine_name: cap.machine_name,
      name: cap.name,
      description: cap.description || "",
      capability_type_id:
        (cap.capability_type_id || capabilityTypes[0]?.id) ?? 0,
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
        machine_name: formData.machine_name,
        name: formData.name,
        description: formData.description || undefined,
        capability_type_id: formData.capability_type_id,
      };
      if (editing) {
        await capabilitiesApi.update(editing.id, payload);
      } else {
        await capabilitiesApi.create(payload as any);
      }
      setShowModal(false);
      fetchData();
    } catch (e: any) {
      setError(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (cap: Capability) => {
    if (!confirm(`Delete capability "${cap.name}"?`)) return;
    try {
      await capabilitiesApi.delete(cap.id);
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
            Capabilities
          </h3>
          <p className="text-sm text-foreground-muted mt-1">
            Skills and qualifications that persons can have
          </p>
        </div>
        <Button variant="primary" onClick={openAdd}>
          + Add Capability
        </Button>
      </div>

      {capabilities.length === 0 ? (
        <div className="text-center py-12 text-foreground-muted">
          <p>No capabilities defined yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-bordercl">
            <thead className="bg-surface-alt">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">
                  Machine Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">
                  Description
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-surface divide-y divide-bordercl">
              {capabilities.map((cap) => {
                const ct = capabilityTypes.find(
                  (t) => t.id === cap.capability_type_id,
                );
                return (
                  <tr key={cap.id}>
                    <td className="px-4 py-3 text-sm font-mono text-foreground">
                      {cap.machine_name}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground">
                      {cap.name}
                    </td>
                    <td className="px-4 py-3">
                      {ct ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white"
                          style={{ backgroundColor: ct.color || "#6B7280" }}
                        >
                          {ct.name}
                        </span>
                      ) : (
                        <span className="text-sm text-foreground-faint">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">
                      {cap.description || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <button
                        onClick={() => openEdit(cap)}
                        className="text-blue-600 hover:text-blue-800 mr-3"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(cap)}
                        className="text-red-600 hover:text-red-800"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
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
              {editing ? "Edit Capability" : "Add Capability"}
            </h3>
            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-1">
                  Machine Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.machine_name}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      machine_name: e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9_]/g, "_"),
                    })
                  }
                  className="w-full px-3 py-2 border border-bordercl-strong rounded-lg font-mono text-sm"
                  placeholder="e.g., tech_support"
                  pattern="[a-z0-9_]+"
                  title="Lowercase ASCII letters, numbers, and underscores only"
                />
                <p className="text-xs text-foreground-muted mt-1">
                  Lowercase ASCII letters, numbers, and underscores only
                </p>
              </div>
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
                  placeholder="e.g., Technical Support"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-1">
                  Capability Type *
                </label>
                <select
                  required
                  value={formData.capability_type_id || ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      capability_type_id: parseInt(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border border-bordercl-strong rounded-lg"
                >
                  <option value="" disabled>
                    Select a type
                  </option>
                  {capabilityTypes.map((ct) => (
                    <option key={ct.id} value={ct.id}>
                      {ct.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <PermittedDataInputNotice />
                <label className="block text-sm font-medium text-foreground-secondary mb-1">
                  Internal organiser operational capability description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={2}
                  className="w-full px-3 py-2 border border-bordercl-strong rounded-lg"
                />
                <p className="mt-1 text-xs text-foreground-muted">Organisers only. Describe the operational capability, not a person.</p>
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
                    saving ||
                    !formData.machine_name.trim() ||
                    !formData.name.trim() ||
                    !formData.capability_type_id
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
