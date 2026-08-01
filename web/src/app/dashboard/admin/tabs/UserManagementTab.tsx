"use client";

import { useState, useEffect } from "react";
import { Button, SearchableSelect, Tooltip } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import CapabilityComponent from "@/components/Capability";
import { getApiUrl } from "../utils";
import { capabilitiesApi, locationsApi, Location } from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";
import { formatDateTime, formatLocalDateTime } from "@/lib/dateFormat";
import {
  getScheduleDayBoundaryFromRange,
  getWorkingDayEndDateTimeLimit,
} from "@/lib/workingDayBoundary";

export function PersonManagementTab({ selectedEvent }: { selectedEvent: any }) {
  const { addToast } = useToast();
  const [persons, setPersons] = useState<any[]>([]);
  const [capabilities, setCapabilities] = useState<any[]>([]);
  const [capabilityTypes, setCapabilityTypes] = useState<any[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    capabilities: [] as string[],
    max_hours_per_day: "",
    home_location_id: "" as string | number,
    unavailabilities: [] as Array<{ starts_at: string; ends_at: string }>,
  });
  const [newCapability, setNewCapability] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Bulk selection state
  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<number>>(
    new Set(),
  );
  const [bulkCapability, setBulkCapability] = useState("");
  const [bulkLocationId, setBulkLocationId] = useState<string>("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const unavailabilityMax = selectedEvent?.end_date
    ? getWorkingDayEndDateTimeLimit(
        selectedEvent.end_date,
        getScheduleDayBoundaryFromRange(
          selectedEvent?.meta_data?.schedule_day_range,
        ),
      )
    : undefined;

  const togglePersonSelection = (id: number) => {
    setSelectedPersonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedPersonIds.size === persons.length) {
      setSelectedPersonIds(new Set());
    } else {
      setSelectedPersonIds(new Set(persons.map((p) => p.id)));
    }
  };

  const handleBulkAddCapability = async () => {
    if (!bulkCapability || selectedPersonIds.size === 0) return;
    setBulkSaving(true);
    try {
      const updates = persons
        .filter((p) => selectedPersonIds.has(p.id))
        .map((person) => {
          const existing: string[] = person.capabilities || [];
          if (existing.includes(bulkCapability)) return null;
          const newCaps = [...existing, bulkCapability];
          return fetch(
            `${getApiUrl()}/api/v1/persons/${person.id}?event_id=${selectedEvent.id}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                first_name: person.first_name,
                last_name: person.last_name,
                capabilities: newCaps,
              }),
            },
          );
        })
        .filter(Boolean);
      await Promise.all(updates);
      const capName =
        capabilities.find((c) => c.machine_name === bulkCapability)?.name ||
        bulkCapability;
      addToast(`Added "${capName}" to ${updates.length} person(s)`, "success");
      setBulkCapability("");
      setSelectedPersonIds(new Set());
      fetchData();
    } catch (e) {
      console.error("Bulk capability error:", e);
      addToast("Failed to add capability", "error");
    } finally {
      setBulkSaving(false);
    }
  };

  const handleBulkRemoveCapability = async () => {
    if (!bulkCapability || selectedPersonIds.size === 0) return;
    setBulkSaving(true);
    try {
      const updates = persons
        .filter((p) => selectedPersonIds.has(p.id))
        .map((person) => {
          const existing: string[] = person.capabilities || [];
          if (!existing.includes(bulkCapability)) return null;
          const newCaps = existing.filter((c) => c !== bulkCapability);
          return fetch(
            `${getApiUrl()}/api/v1/persons/${person.id}?event_id=${selectedEvent.id}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                first_name: person.first_name,
                last_name: person.last_name,
                capabilities: newCaps,
              }),
            },
          );
        })
        .filter(Boolean);
      await Promise.all(updates);
      const capName =
        capabilities.find((c) => c.machine_name === bulkCapability)?.name ||
        bulkCapability;
      addToast(
        `Removed "${capName}" from ${updates.length} person(s)`,
        "success",
      );
      setBulkCapability("");
      setSelectedPersonIds(new Set());
      fetchData();
    } catch (e) {
      console.error("Bulk remove capability error:", e);
      addToast("Failed to remove capability", "error");
    } finally {
      setBulkSaving(false);
    }
  };

  const handleBulkSetLocation = async () => {
    if (!bulkLocationId || selectedPersonIds.size === 0) return;
    setBulkSaving(true);
    try {
      const updates = persons
        .filter((p) => selectedPersonIds.has(p.id))
        .map((person) =>
          fetch(
            `${getApiUrl()}/api/v1/persons/${person.id}?event_id=${selectedEvent.id}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                first_name: person.first_name,
                last_name: person.last_name,
                home_location_id: parseInt(bulkLocationId),
              }),
            },
          ),
        );
      await Promise.all(updates);
      const locName =
        locations.find((l) => l.id === parseInt(bulkLocationId))?.name ||
        bulkLocationId;
      addToast(
        `Set home location to "${locName}" for ${updates.length} person(s)`,
        "success",
      );
      setBulkLocationId("");
      setSelectedPersonIds(new Set());
      fetchData();
    } catch (e) {
      console.error("Bulk location error:", e);
      addToast("Failed to set location", "error");
    } finally {
      setBulkSaving(false);
    }
  };

  useEffect(() => {
    if (selectedEvent) {
      fetchData();
      fetchCapabilities();
      fetchCapabilityTypes();
      fetchLocations();
    }
  }, [selectedEvent]);

  const fetchCapabilityTypes = async () => {
    try {
      const response = await fetch(`${getApiUrl()}/api/v1/capability-types`);
      if (response.ok) {
        const data = await response.json();
        setCapabilityTypes(data);
      }
    } catch (error) {
      console.error("Error fetching capability types:", error);
    }
  };

  const fetchLocations = async () => {
    try {
      const data = await locationsApi.getAll(selectedEvent.id);
      setLocations(data);
    } catch (error) {
      console.error("Error fetching locations:", error);
    }
  };

  const fetchCapabilities = async () => {
    try {
      const data = await capabilitiesApi.getAll(selectedEvent.id);
      setCapabilities(data);
    } catch (error) {
      console.error("Error fetching capabilities:", error);
    }
  };

  const fetchData = async () => {
    if (!selectedEvent) return;
    setLoading(true);
    try {
      const personsRes = await fetch(
        `${getApiUrl()}/api/v1/persons?event_id=${selectedEvent.id}`,
      );

      if (personsRes.ok) {
        const personsData = await personsRes.json();
        setPersons(personsData);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const openDetailModal = (person: any) => {
    setSelectedPerson(person);
    setFormData({
      first_name: person.first_name || "",
      last_name: person.last_name || "",
      phone: person.phone || "",
      capabilities: person.capabilities || [],
      max_hours_per_day: person.max_hours_per_day?.toString() || "",
      home_location_id: person.home_location_id || "",
      unavailabilities: person.unavailabilities || [],
    });
    setIsEditing(false);
    setError("");
    setShowDetailModal(true);
  };

  const openCreateModal = () => {
    setSelectedPerson(null);
    setFormData({
      first_name: "",
      last_name: "",
      phone: "",
      capabilities: [],
      max_hours_per_day: "",
      home_location_id: "",
      unavailabilities: [],
    });
    setIsEditing(true);
    setError("");
    setShowDetailModal(true);
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    if (selectedPerson) {
      // Reset form to original person data
      setFormData({
        first_name: selectedPerson.first_name || "",
        last_name: selectedPerson.last_name || "",
        phone: selectedPerson.phone || "",
        capabilities: selectedPerson.capabilities || [],
        max_hours_per_day: selectedPerson.max_hours_per_day?.toString() || "",
        home_location_id: selectedPerson.home_location_id || "",
        unavailabilities: selectedPerson.unavailabilities || [],
      });
      setIsEditing(false);
      setError("");
    } else {
      // Close modal if creating new
      setShowDetailModal(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");

    // Client-side validation
    if (!formData.first_name.trim()) {
      setError("First name is required");
      setSaving(false);
      return;
    }

    if (!formData.last_name.trim()) {
      setError("Last name is required");
      setSaving(false);
      return;
    }

    if (!formData.home_location_id) {
      setError("Home location is required");
      setSaving(false);
      return;
    }

    try {
      const personData = {
        first_name: formData.first_name,
        last_name: formData.last_name,
        phone: formData.phone || null,
        capabilities: formData.capabilities,
        unavailabilities: formData.unavailabilities,
        max_hours_per_day: formData.max_hours_per_day
          ? parseFloat(formData.max_hours_per_day)
          : null,
        home_location_id: formData.home_location_id
          ? parseInt(formData.home_location_id.toString())
          : null,
      };

      const url = selectedPerson
        ? `${getApiUrl()}/api/v1/persons/${selectedPerson.id}?event_id=${
            selectedEvent.id
          }`
        : `${getApiUrl()}/api/v1/persons?event_id=${selectedEvent.id}`;

      const method = selectedPerson ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(personData),
      });

      if (!response.ok) {
        if (response.status === 422) {
          const errorData = await response.json();

          // Handle validation errors from backend
          if (errorData.detail) {
            if (Array.isArray(errorData.detail)) {
              // FastAPI validation errors are arrays
              const emailError = errorData.detail.find(
                (err: any) => err.loc && err.loc.includes("email"),
              );
              if (emailError) {
                setError(
                  "Invalid email format. Please enter a valid email address.",
                );
              } else {
                // Generic validation error
                const errorMessages = errorData.detail
                  .map((err: any) => err.msg || JSON.stringify(err))
                  .join(", ");
                setError(`Validation error: ${errorMessages}`);
              }
            } else if (typeof errorData.detail === "string") {
              setError(errorData.detail);
            } else {
              setError("Please check your input and try again.");
            }
          } else {
            setError("Please check your input and try again.");
          }
        } else {
          const errorData = await response.json();
          throw new Error(errorData.detail || "Failed to save person");
        }
        setSaving(false);
        return;
      }

      setShowDetailModal(false);
      fetchData();
    } catch (error: any) {
      setError(error.message || "Error saving person");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedPerson) return;

    if (
      !confirm(
        `Are you sure you want to delete ${selectedPerson.first_name} ${selectedPerson.last_name}?`,
      )
    ) {
      return;
    }

    setDeleting(true);
    setError("");

    try {
      const response = await fetch(
        `${getApiUrl()}/api/v1/persons/${selectedPerson.id}?event_id=${
          selectedEvent.id
        }`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to delete person");
      }

      setShowDetailModal(false);
      fetchData();
    } catch (error: any) {
      setError(error.message || "Error deleting person");
    } finally {
      setDeleting(false);
    }
  };

  const addCapability = () => {
    if (newCapability && !formData.capabilities.includes(newCapability)) {
      setFormData({
        ...formData,
        capabilities: [...formData.capabilities, newCapability],
      });
      setNewCapability("");
    }
  };

  // Get available capabilities (not yet added to person)
  const availableCapabilities = capabilities.filter(
    (cap) => !formData.capabilities.includes(cap.machine_name),
  );

  const removeCapability = (cap: string) => {
    setFormData({
      ...formData,
      capabilities: formData.capabilities.filter((c) => c !== cap),
    });
  };

  // Helper to sort capability machine names by type, then canonical identifier
  const sortCapabilities = (capabilityMachineNames: string[]) => {
    return [...capabilityMachineNames].sort((a, b) => {
      const capA = capabilities.find((c) => c.machine_name === a);
      const capB = capabilities.find((c) => c.machine_name === b);

      const typeA = capA?.capability_type_id
        ? capabilityTypes.find((ct) => ct.id === capA.capability_type_id)
        : null;
      const typeB = capB?.capability_type_id
        ? capabilityTypes.find((ct) => ct.id === capB.capability_type_id)
        : null;

      const sortOrderA = typeA?.sort_order ?? Number.NEGATIVE_INFINITY;
      const sortOrderB = typeB?.sort_order ?? Number.NEGATIVE_INFINITY;

      if (sortOrderA !== sortOrderB) {
        return sortOrderA - sortOrderB;
      }

      return a.localeCompare(b);
    });
  };

  // Helper to get color for a capability based on its type
  const getCapabilityColor = (capabilityMachineName: string) => {
    const capability = capabilities.find(
      (c) => c.machine_name === capabilityMachineName,
    );
    if (!capability || !capability.capability_type_id) return "#3B82F6"; // Default blue
    const capabilityType = capabilityTypes.find(
      (ct) => ct.id === capability.capability_type_id,
    );
    return capabilityType?.color || "#3B82F6";
  };

  if (!selectedEvent) {
    return (
      <div className="p-6 text-center text-foreground-muted">
        Please select an event to manage persons.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            Person Management
          </h3>
          <p className="text-sm text-foreground-muted">
            Manage people and their capabilities for this event
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={openCreateModal}>
            + Add Person
          </Button>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {selectedPersonIds.size > 0 && (
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-blue-800">
            {selectedPersonIds.size} selected
          </span>
          <div className="h-4 w-px bg-blue-300" />

          {/* Bulk Add Capability */}
          <div className="flex items-center gap-1.5">
            <select
              value={bulkCapability}
              onChange={(e) => setBulkCapability(e.target.value)}
              className="text-sm border border-bordercl-strong rounded px-2 py-1"
            >
              <option value="">Capability…</option>
              {capabilities.map((cap) => (
                <option key={cap.machine_name} value={cap.machine_name}>
                  {cap.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleBulkAddCapability}
              disabled={!bulkCapability || bulkSaving}
              className="px-2 py-1 text-xs font-medium rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-40"
            >
              + Add
            </button>
            <button
              onClick={handleBulkRemoveCapability}
              disabled={!bulkCapability || bulkSaving}
              className="px-2 py-1 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
            >
              − Remove
            </button>
          </div>
          <div className="h-4 w-px bg-blue-300" />

          {/* Bulk Set Location */}
          <div className="flex items-center gap-1.5">
            <select
              value={bulkLocationId}
              onChange={(e) => setBulkLocationId(e.target.value)}
              className="text-sm border border-bordercl-strong rounded px-2 py-1"
            >
              <option value="">Location…</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleBulkSetLocation}
              disabled={!bulkLocationId || bulkSaving}
              className="px-2 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
            >
              Set
            </button>
          </div>
          <div className="h-4 w-px bg-blue-300" />
          <button
            onClick={() => setSelectedPersonIds(new Set())}
            className="px-2 py-1 text-xs font-medium rounded border border-bordercl-strong bg-surface hover:bg-surface-hover"
          >
            Clear Selection
          </button>
        </div>
      )}

      <DataTable
        columns={[
          {
            header: (
              <input
                type="checkbox"
                checked={
                  persons.length > 0 &&
                  selectedPersonIds.size === persons.length
                }
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-bordercl-strong text-blue-600 cursor-pointer"
              />
            ),
            headerClassName: "px-3 py-3 text-center w-10",
            cellClassName: "px-3 py-4 text-center w-10",
            render: (person) => (
              <input
                type="checkbox"
                checked={selectedPersonIds.has(person.id)}
                onChange={() => togglePersonSelection(person.id)}
                onClick={(e) => e.stopPropagation()}
                className="h-4 w-4 rounded border-bordercl-strong text-blue-600 cursor-pointer"
              />
            ),
          },
          {
            header: "Name",
            enableDoubleClick: true,
            render: (person) => `${person.first_name} ${person.last_name}`,
          },
          {
            header: "Capabilities",
            cellClassName: "px-6 py-4 text-sm text-foreground-muted",
            render: (person) => {
              const personCapabilities = person.capabilities || [];

              if (personCapabilities.length === 0) {
                return <span className="text-foreground-faint">None</span>;
              }

              return (
                <div className="flex flex-wrap gap-1">
                  {sortCapabilities(personCapabilities).map((cap: string) => {
                    const capData = capabilities.find(
                      (c) => c.machine_name === cap,
                    );
                    const color = getCapabilityColor(cap);
                    return (
                      <Tooltip
                        key={cap}
                        content={capData?.description}
                        side="top"
                      >
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white"
                          style={{ backgroundColor: color }}
                        >
                          {capData?.name || cap}
                        </span>
                      </Tooltip>
                    );
                  })}
                </div>
              );
            },
          },
          {
            header: "",
            headerClassName:
              "px-6 py-3 text-right text-xs font-medium text-foreground-muted uppercase w-12",
            cellClassName: "px-6 py-4 text-right",
            render: (person) => (
              <div className="flex gap-1">
                {person.unavailabilities?.length > 0 && (
                  <Tooltip
                    content={`${person.unavailabilities.length} unavailability period(s)`}
                    side="top"
                  >
                    <span>
                      <svg
                        className="w-5 h-5 inline-block"
                        style={{ color: "var(--color-warning)" }}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </span>
                  </Tooltip>
                )}
              </div>
            ),
          },
        ]}
        data={persons}
        isLoading={loading}
        emptyMessage="No persons added yet."
        emptySubMessage='Click "Add Person" to get started.'
        onRowDoubleClick={openDetailModal}
        keyExtractor={(person) => person.id}
      />

      {/* Person Detail Modal */}
      {showDetailModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                {isEditing
                  ? selectedPerson
                    ? "Edit Person"
                    : "Create Person"
                  : "Person Details"}
              </h3>

              {error && (
                <div className="mb-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded">
                  {error}
                </div>
              )}

              <div className="space-y-6">
                {/* Basic Information */}
                <div>
                  <h3 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
                    Basic Information
                  </h3>
                  <div className="bg-surface-alt rounded-lg p-4 space-y-3">
                    {isEditing ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-foreground-muted uppercase mb-1">
                              First Name *
                            </label>
                            <input
                              type="text"
                              required
                              value={formData.first_name}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  first_name: e.target.value,
                                })
                              }
                              className="w-full px-3 py-2 border border-bordercl-strong rounded-lg text-sm"
                              placeholder="John"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-foreground-muted uppercase mb-1">
                              Last Name *
                            </label>
                            <input
                              type="text"
                              required
                              value={formData.last_name}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  last_name: e.target.value,
                                })
                              }
                              className="w-full px-3 py-2 border border-bordercl-strong rounded-lg text-sm"
                              placeholder="Doe"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-foreground-muted uppercase mb-1">
                            Phone
                          </label>
                          <input
                            type="tel"
                            value={formData.phone}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                phone: e.target.value,
                              })
                            }
                            className="w-full px-3 py-2 border border-bordercl-strong rounded-lg text-sm"
                            placeholder="+41 12 345 56 78"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div>
                          <span className="text-xs font-medium text-foreground-muted uppercase block mb-1">
                            Full Name
                          </span>
                          <span className="text-sm text-foreground font-semibold">
                            {selectedPerson.first_name}{" "}
                            {selectedPerson.last_name}
                          </span>
                        </div>
                        {selectedPerson.phone && (
                          <div>
                            <span className="text-xs font-medium text-foreground-muted uppercase block mb-1">
                              Phone
                            </span>
                            <span className="text-sm text-foreground">
                              {selectedPerson.phone}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Availability & Working Constraints */}
                <div>
                  <h3 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
                    Availability & Constraints
                  </h3>
                  <div className="bg-surface-alt rounded-lg p-4 space-y-3">
                    {isEditing ? (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-foreground-muted uppercase mb-1">
                            Max Hours Per Day
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="24"
                            value={formData.max_hours_per_day}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                max_hours_per_day: e.target.value,
                              })
                            }
                            className="w-full px-3 py-2 border border-bordercl-strong rounded-lg text-sm"
                            placeholder="e.g., 8"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-foreground-muted uppercase mb-1">
                            Home Location (Starting Point) *
                          </label>
                          <select
                            value={formData.home_location_id}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                home_location_id: e.target.value,
                              })
                            }
                            className="w-full px-3 py-2 border border-bordercl-strong rounded-lg text-sm"
                            required
                          >
                            <option value="">Select a location</option>
                            {locations.map((location) => (
                              <option key={location.id} value={location.id}>
                                {location.name}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-foreground-muted mt-1">
                            Default starting location each day for optimisation
                          </p>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-foreground-muted uppercase mb-2">
                            Unavailability Periods
                          </label>
                          {formData.unavailabilities.map((unavail, index) => (
                            <div key={index} className="flex gap-2 mb-2">
                              <input
                                type="datetime-local"
                                value={unavail.starts_at}
                                min={
                                  selectedEvent?.start_date
                                    ? `${selectedEvent.start_date}T00:00`
                                    : undefined
                                }
                                max={unavailabilityMax}
                                onChange={(e) => {
                                  const newUnavails = [
                                    ...formData.unavailabilities,
                                  ];
                                  newUnavails[index].starts_at = e.target.value;
                                  setFormData({
                                    ...formData,
                                    unavailabilities: newUnavails,
                                  });
                                }}
                                className="flex-1 px-3 py-2 border border-bordercl-strong rounded-lg text-sm"
                              />
                              <span className="flex items-center text-foreground-muted">
                                to
                              </span>
                              <input
                                type="datetime-local"
                                value={unavail.ends_at}
                                min={
                                  selectedEvent?.start_date
                                    ? `${selectedEvent.start_date}T00:00`
                                    : undefined
                                }
                                max={unavailabilityMax}
                                onChange={(e) => {
                                  const newUnavails = [
                                    ...formData.unavailabilities,
                                  ];
                                  newUnavails[index].ends_at = e.target.value;
                                  setFormData({
                                    ...formData,
                                    unavailabilities: newUnavails,
                                  });
                                }}
                                className="flex-1 px-3 py-2 border border-bordercl-strong rounded-lg text-sm"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const newUnavails =
                                    formData.unavailabilities.filter(
                                      (_, i) => i !== index,
                                    );
                                  setFormData({
                                    ...formData,
                                    unavailabilities: newUnavails,
                                  });
                                }}
                                className="px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              setFormData({
                                ...formData,
                                unavailabilities: [
                                  ...formData.unavailabilities,
                                  { starts_at: "", ends_at: "" },
                                ],
                              });
                            }}
                            className="mt-2 px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm"
                          >
                            + Add Unavailability Period
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {selectedPerson.max_hours_per_day ? (
                          <div>
                            <span className="text-xs font-medium text-foreground-muted uppercase block mb-1">
                              Max Hours Per Day
                            </span>
                            <span className="text-sm text-foreground">
                              {selectedPerson.max_hours_per_day} hours
                            </span>
                          </div>
                        ) : null}
                        {selectedPerson.home_location_id ? (
                          <div>
                            <span className="text-xs font-medium text-foreground-muted uppercase block mb-1">
                              Home Location
                            </span>
                            <span className="text-sm text-foreground">
                              {locations.find(
                                (l) => l.id === selectedPerson.home_location_id,
                              )?.name || "Unknown"}
                            </span>
                          </div>
                        ) : null}
                        {selectedPerson.unavailabilities?.length >
                        0 ? (
                          <div>
                            <span className="text-xs font-medium text-foreground-muted uppercase block mb-1">
                              Unavailability Periods
                            </span>
                            <div className="space-y-1">
                              {selectedPerson.unavailabilities.map(
                                (unavail: any, index: number) => (
                                  <div
                                    key={index}
                                    className="text-sm text-foreground"
                                  >
                                    {unavail.starts_at
                                      ? formatLocalDateTime(unavail.starts_at)
                                      : "Not set"}{" "}
                                    -{" "}
                                    {unavail.ends_at
                                      ? formatLocalDateTime(unavail.ends_at)
                                      : "Not set"}
                                  </div>
                                ),
                              )}
                            </div>
                          </div>
                        ) : null}
                        {!selectedPerson.max_hours_per_day &&
                          (!selectedPerson.unavailabilities ||
                            selectedPerson.unavailabilities
                              .length === 0) && (
                            <p className="text-sm text-foreground-muted italic">
                              No constraints set
                            </p>
                          )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Capabilities */}
                <div>
                  <h3 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
                    Capabilities
                  </h3>
                  <div className="bg-surface-alt rounded-lg p-4">
                    {isEditing ? (
                      <div>
                        {capabilities.length === 0 ? (
                          <div className="mb-3 p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm text-yellow-800 dark:text-yellow-300">
                            No capabilities defined yet. Create capabilities in
                            Settings first.
                          </div>
                        ) : (
                          <div className="flex gap-2 mb-3">
                            <SearchableSelect
                              value={newCapability}
                              onChange={(value: string) =>
                                setNewCapability(value)
                              }
                              options={[
                                {
                                  value: "",
                                  label:
                                    availableCapabilities.length === 0
                                      ? "All capabilities assigned"
                                      : "Select a capability...",
                                },
                                ...availableCapabilities.map((cap) => ({
                                  value: cap.machine_name,
                                  label: cap.name,
                                  description: cap.description || undefined,
                                })),
                              ]}
                              placeholder="Select a capability..."
                              disabled={availableCapabilities.length === 0}
                              className="flex-1"
                              emptyMessage="All capabilities assigned"
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={addCapability}
                              disabled={!newCapability}
                            >
                              Add
                            </Button>
                          </div>
                        )}
                        {formData.capabilities.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {sortCapabilities(formData.capabilities).map(
                              (cap) => {
                                const capData = capabilities.find(
                                  (c) => c.machine_name === cap,
                                );
                                return (
                                  <CapabilityComponent
                                    key={cap}
                                    name={capData?.name || cap}
                                    description={capData?.description}
                                    onRemove={() => removeCapability(cap)}
                                    size="sm"
                                    color={getCapabilityColor(cap)}
                                  />
                                );
                              },
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-foreground-faint italic">
                            No capabilities assigned yet
                          </p>
                        )}
                      </div>
                    ) : formData.capabilities.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {sortCapabilities(formData.capabilities).map(
                          (cap: string) => {
                            const capData = capabilities.find(
                              (c) => c.machine_name === cap,
                            );
                            const color = getCapabilityColor(cap);
                            return (
                              <Tooltip
                                key={cap}
                                content={capData?.description}
                                side="top"
                              >
                                <span
                                  className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium text-white"
                                  style={{ backgroundColor: color }}
                                >
                                  {capData?.name || cap}
                                </span>
                              </Tooltip>
                            );
                          },
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-foreground-muted italic">
                        No capabilities assigned
                      </p>
                    )}
                  </div>
                </div>

                {/* Timestamps - Only show when not editing and person exists */}
                {!isEditing && selectedPerson && selectedPerson.created_at && (
                  <div>
                    <h3 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
                      Record Information
                    </h3>
                    <div className="bg-surface-alt rounded-lg p-4 space-y-2 text-sm">
                      <div>
                        <span className="font-medium text-foreground-secondary">
                          Created:
                        </span>{" "}
                        <span className="text-foreground">
                          {formatDateTime(selectedPerson.created_at)}
                        </span>
                      </div>
                      {selectedPerson.updated_at && (
                        <div>
                          <span className="font-medium text-foreground-secondary">
                            Last Updated:
                          </span>{" "}
                          <span className="text-foreground">
                            {formatDateTime(selectedPerson.updated_at)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-2 mt-6">
                {!isEditing && selectedPerson ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowDetailModal(false)}
                    >
                      Close
                    </Button>
                    <Button variant="primary" size="sm" onClick={handleEdit}>
                      Edit
                    </Button>
                  </>
                ) : (
                  <>
                    {selectedPerson && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={handleDelete}
                        disabled={deleting}
                      >
                        {deleting ? "Deleting..." : "Delete"}
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleCancelEdit}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleSave}
                      disabled={
                        saving ||
                        !formData.first_name.trim() ||
                        !formData.last_name.trim() ||
                        !formData.home_location_id
                      }
                    >
                      {saving
                        ? "Saving..."
                        : selectedPerson
                          ? "Save"
                          : "Create"}
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
