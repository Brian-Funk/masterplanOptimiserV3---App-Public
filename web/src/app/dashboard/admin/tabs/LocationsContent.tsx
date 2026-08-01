"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { locationsApi, Location } from "@/lib/api";

interface LocationsContentProps {
  selectedEvent: any;
}

export default function LocationsContent({
  selectedEvent,
}: LocationsContentProps) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"view" | "edit" | "create">(
    "view",
  );
  const [selectedItem, setSelectedItem] = useState<Location | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    address: string;
  }>({
    name: "",
    address: "",
  });

  useEffect(() => {
    if (selectedEvent) {
      fetchLocations();
    }
  }, [selectedEvent]);

  const fetchLocations = async () => {
    if (!selectedEvent) return;
    setIsLoading(true);
    try {
      const data = await locationsApi.getAll(selectedEvent.id);
      setLocations(data);
    } catch (error) {
      console.error("Failed to fetch locations:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = () => {
    setModalMode("create");
    setSelectedItem(null);
    setFormData({ name: "", address: "" });
    setShowModal(true);
  };

  const handleEdit = (item: Location) => {
    setModalMode("edit");
    setSelectedItem(item);
    setFormData({
      name: item.name || "",
      address: item.address || "",
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!selectedEvent) return;

    if (!formData.name.trim() || !formData.address.trim()) {
      return;
    }

    try {
      if (modalMode === "create") {
        await locationsApi.create(selectedEvent.id, {
          name: formData.name,
          address: formData.address || undefined,
        });
      } else if (modalMode === "edit" && selectedItem) {
        await locationsApi.update(selectedEvent.id, selectedItem.id, {
          name: formData.name,
          address: formData.address || undefined,
        });
      }
      await fetchLocations();
      setShowModal(false);
    } catch (error: any) {
      console.error("Failed to save location:", error);
      alert(
        `Failed to save: ${
          error.message || "Unknown error"
        }. Check console for details.`,
      );
    }
  };

  const handleDelete = async () => {
    if (!selectedEvent || !selectedItem) return;

    if (!confirm("Are you sure you want to delete this location?")) {
      return;
    }

    try {
      await locationsApi.delete(selectedEvent.id, selectedItem.id);
      await fetchLocations();
      setShowModal(false);
    } catch (error) {
      console.error("Failed to delete:", error);
      alert("Failed to delete. Please try again.");
    }
  };

  if (!selectedEvent) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Please select an event to manage locations.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            Locations
          </h3>
          <p className="text-sm text-foreground-muted">
            Manage locations where tasks will take place
          </p>
        </div>
        <Button variant="primary" onClick={handleCreate}>
          + Add Location
        </Button>
      </div>

      <DataTable
        columns={[
          {
            header: "Name",
            enableDoubleClick: true,
            render: (location) => location.name,
          },
          {
            header: "Address",
            cellClassName: "px-6 py-4 text-sm text-foreground-muted",
            render: (location) =>
              location.address ? (
                <span>{location.address}</span>
              ) : (
                <span className="text-foreground-faint">-</span>
              ),
          },
        ]}
        data={locations}
        isLoading={isLoading}
        emptyMessage="No locations defined yet."
        emptySubMessage="Add locations where tasks will take place."
        onRowDoubleClick={handleEdit}
        keyExtractor={(location) => location.id}
        wrapperClassName="bg-surface rounded-lg border border-bordercl"
      />

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                {modalMode === "create" ? "Create Location" : "Edit Location"}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground-secondary mb-1">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-bordercl-strong rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter location name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground-secondary mb-1">
                    Address *
                  </label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-bordercl-strong rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter address"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                {modalMode === "edit" && (
                  <Button variant="danger" size="sm" onClick={handleDelete}>
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
                  onClick={handleSave}
                  disabled={!formData.name.trim() || !formData.address.trim()}
                >
                  {modalMode === "create" ? "Create" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
