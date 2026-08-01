"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button, Tooltip } from "@/components/ui";
import { Minus, Lock, GripVertical } from "lucide-react";
import { taskTemplatesApi, taskTypesApi, TaskType } from "@/lib/api";
import { getApiUrl } from "@/lib/environment";
import { PermittedDataInputNotice } from "@/components/PermittedDataInputNotice";

/* ── Segmented Toggle ──────────────────────────────────────────── */
function SegmentedToggle({
  value,
  options,
  onChange,
}: {
  value: boolean;
  options: [string, string]; // [falseLabel, trueLabel]
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-bordercl-strong overflow-hidden text-sm">
      {options.map((label, i) => {
        const active = value === (i === 1);
        return (
          <button
            key={label}
            type="button"
            onClick={() => onChange(i === 1)}
            className={`px-3 py-1.5 font-medium transition-colors ${
              active
                ? "bg-blue-600 text-white"
                : "bg-surface text-foreground-muted hover:bg-surface-hover"
            } ${i === 0 ? "border-r border-bordercl-strong" : ""}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Template Field type definition
interface TemplateField {
  id: string;
  name: string;
  type: string;
  category: "arbitrary" | "conditions";
  locked: boolean;
  optimised: boolean;
  config: Record<string, any>;
  purpose?:
    | "assignment"
    | "capability_requirement"
    | "location"
    | "operational_instruction"
    | "reference"
    | "timing";
  visibility?: "organiser" | "participant" | "public" | "never_publish";
  classification_reviewed?: boolean;
  public_visibility_confirmed?: boolean;
}

const FIELD_CATEGORIES = {
  arbitrary: {
    key: "arbitrary",
    label: "Arbitrary",
    icon: Minus,
    description: "Informational fields that don't affect optimisation",
    tooltip: "Do not influence and are not influenced by optimisation",
    types: [
      { value: "number", label: "Number" },
      { value: "text", label: "Text" },
      { value: "link", label: "Link" },
    ],
  },
  conditions: {
    key: "conditions",
    label: "Conditions",
    icon: Lock,
    description: "Constraints that influence optimisation",
    tooltip: "Influence optimisation but are not influenced by it",
    types: [
      { value: "time_range", label: "Time Range" },
      { value: "duration", label: "Duration" },
      { value: "capabilities_list", label: "Required Capabilities" },
      { value: "start_end_time", label: "Start & End Time" },
      { value: "persons_list", label: "List of Persons" },
      { value: "location", label: "Location" },
      {
        value: "dynamic_transfer_allocation",
        label: "Dynamic Transfer Allocation Limit",
      },
      { value: "transferee", label: "Transferee" },
    ],
  },
} as const;

const FIELD_TYPES = [
  ...FIELD_CATEGORIES.arbitrary.types,
  ...FIELD_CATEGORIES.conditions.types,
];

function sortFields(fields: TemplateField[]): TemplateField[] {
  const conditions = fields.filter((f) => f.category === "conditions");
  const arbitrary = fields.filter((f) => f.category !== "conditions");

  // Sort conditions by type priority; arbitrary fields keep array order
  conditions.sort((a, b) => {
    const priority = (f: TemplateField) => {
      if (["time_range", "start_end_time", "duration"].includes(f.type))
        return 1;
      if (f.type === "location") return 2;
      if (f.type === "dynamic_transfer_allocation") return 3;
      if (f.type === "transferee") return 4;
      if (f.type === "capabilities_list") return 5;
      if (f.type === "persons_list") return 6;
      return 7;
    };
    return priority(a) - priority(b);
  });

  return [...conditions, ...arbitrary];
}

export function TaskTemplatesSection() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [formData, setFormData] = useState({
    machine_name: "",
    name: "",
    description: "",
    task_type_id: "",
    is_floating: false,
    is_transfer: false,
  });
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Bulk operations state
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<number>>(
    new Set(),
  );
  const [bulkFieldName, setBulkFieldName] = useState("");
  const [bulkFieldType, setBulkFieldType] = useState("capabilities_list");
  const [bulkFieldCategory, setBulkFieldCategory] = useState<
    "arbitrary" | "conditions"
  >("conditions");
  const [bulkSaving, setBulkSaving] = useState(false);

  // Drag-and-drop state for reordering arbitrary fields
  const [dragFieldId, setDragFieldId] = useState<string | null>(null);
  const [dragOverFieldId, setDragOverFieldId] = useState<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, fieldId: string) => {
    setDragFieldId(fieldId);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, fieldId: string) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (fieldId !== dragOverFieldId) setDragOverFieldId(fieldId);
    },
    [dragOverFieldId],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, targetFieldId: string) => {
      e.preventDefault();
      if (!dragFieldId || dragFieldId === targetFieldId) {
        setDragFieldId(null);
        setDragOverFieldId(null);
        return;
      }
      setFields((prev) => {
        const newFields = [...prev];
        const fromIdx = newFields.findIndex((f) => f.id === dragFieldId);
        const toIdx = newFields.findIndex((f) => f.id === targetFieldId);
        if (fromIdx === -1 || toIdx === -1) return prev;
        const [moved] = newFields.splice(fromIdx, 1);
        newFields.splice(toIdx, 0, moved);
        return newFields;
      });
      setDragFieldId(null);
      setDragOverFieldId(null);
    },
    [dragFieldId],
  );

  const handleDragEnd = useCallback(() => {
    setDragFieldId(null);
    setDragOverFieldId(null);
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [tpls, types] = await Promise.all([
        taskTemplatesApi.getAll(),
        taskTypesApi.getAll(),
      ]);
      setTemplates(tpls);
      setTaskTypes(types.filter((t) => t.is_active));
    } catch (e) {
      console.error("Failed to fetch:", e);
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditingTemplate(null);
    const defaults = {
      machine_name: "",
      name: "",
      description: "",
      task_type_id: "",
      is_floating: false,
      is_transfer: false,
    };
    setFormData(defaults);
    // Preset locked fields for default config (static + task)
    setFields([
      {
        id: `field_time_${Date.now()}`,
        name: "Time",
        type: "start_end_time",
        category: "conditions",
        locked: true,
        optimised: false,
        config: {},
      },
      {
        id: `field_location_${Date.now()}`,
        name: "Location",
        type: "location",
        category: "conditions",
        locked: true,
        optimised: false,
        config: {},
      },
    ]);
    setError("");
    setShowModal(true);
  };

  const openEdit = (template: any) => {
    setEditingTemplate(template);
    setFormData({
      machine_name: template.machine_name,
      name: template.name,
      description: template.description || "",
      task_type_id: template.task_type_id?.toString() || "",
      is_floating: template.is_floating ?? false,
      is_transfer: template.is_transfer ?? false,
    });
    // Sanitize unlocked condition fields: reset any time/location types
    // that should only be set via the Static/Floating and Task/Transfer toggles
    const TIME_LOCATION_TYPES = new Set([
      "time_range",
      "duration",
      "start_end_time",
      "location",
      "dynamic_transfer_allocation",
      "transferee",
    ]);
    const sanitizedFields = (template.fields || []).map((f: TemplateField) => {
      const classified = {
        ...f,
        purpose: f.purpose ?? "operational_instruction",
        visibility: f.visibility ?? "never_publish",
        classification_reviewed: f.classification_reviewed ?? false,
        public_visibility_confirmed: f.public_visibility_confirmed ?? false,
      };
      if (
        classified.category === "conditions" &&
        !classified.locked &&
        TIME_LOCATION_TYPES.has(classified.type)
      ) {
        return { ...classified, type: "capabilities_list" };
      }
      return classified;
    });
    setFields(sanitizedFields);
    setError("");
    setShowModal(true);
  };

  const addField = (category: "arbitrary" | "conditions") => {
    const categoryTypes = FIELD_CATEGORIES[category].types;
    const allowedTypes =
      category === "conditions"
        ? categoryTypes.filter(
            (t) =>
              t.value === "capabilities_list" || t.value === "persons_list",
          )
        : categoryTypes;
    const newField: TemplateField = {
      id: `field_${Date.now()}`,
      name: "",
      type: allowedTypes[0].value,
      category,
      locked: false,
      optimised: false,
      config: {},
      purpose: "operational_instruction",
      visibility: "never_publish",
      classification_reviewed: false,
      public_visibility_confirmed: false,
    };
    setFields([...fields, newField]);
  };

  const updateTaskConfiguration = (updates: Partial<typeof formData>) => {
    const newFormData = { ...formData, ...updates };
    setFormData(newFormData);

    const filteredFields = fields.filter((f) => !f.locked);
    const timeFields: TemplateField[] = [];
    if (newFormData.is_floating) {
      timeFields.push(
        {
          id: `field_time_range_${Date.now()}`,
          name: "Time Window",
          type: "time_range",
          category: "conditions",
          locked: true,
          optimised: false,
          config: {},
        },
        {
          id: `field_duration_${Date.now()}`,
          name: "Duration (minutes)",
          type: "duration",
          category: "conditions",
          locked: true,
          optimised: false,
          config: {},
        },
      );
    } else {
      timeFields.push({
        id: `field_time_${Date.now()}`,
        name: "Time",
        type: "start_end_time",
        category: "conditions",
        locked: true,
        optimised: false,
        config: {},
      });
    }

    const locationFields: TemplateField[] = [];
    if (newFormData.is_transfer) {
      locationFields.push(
        {
          id: `field_start_location_${Date.now()}`,
          name: "Start Location",
          type: "location",
          category: "conditions",
          locked: true,
          optimised: false,
          config: {},
        },
        {
          id: `field_end_location_${Date.now()}`,
          name: "End Location",
          type: "location",
          category: "conditions",
          locked: true,
          optimised: false,
          config: {},
        },
        {
          id: `field_dynamic_allocation_${Date.now()}`,
          name: "Dynamic Allocation Limit",
          type: "dynamic_transfer_allocation",
          category: "conditions",
          locked: true,
          optimised: false,
          config: {},
        },
        {
          id: `field_transferee_${Date.now()}`,
          name: "Transferee",
          type: "transferee",
          category: "conditions",
          locked: true,
          optimised: false,
          config: {},
        },
      );
    } else {
      locationFields.push({
        id: `field_location_${Date.now()}`,
        name: "Location",
        type: "location",
        category: "conditions",
        locked: true,
        optimised: false,
        config: {},
      });
    }

    setFields([...filteredFields, ...timeFields, ...locationFields]);
  };

  const updateField = (index: number, updates: Partial<TemplateField>) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], ...updates };
    setFields(newFields);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    if (!formData.machine_name.trim()) {
      setError("Machine name is required");
      setSaving(false);
      return;
    }
    if (!/^[a-z0-9_]+$/.test(formData.machine_name)) {
      setError(
        "Machine name must only contain lowercase ASCII letters, numbers, and underscores",
      );
      setSaving(false);
      return;
    }
    if (!formData.name.trim()) {
      setError("Display name is required");
      setSaving(false);
      return;
    }
    if (!formData.task_type_id) {
      setError("Task type is required");
      setSaving(false);
      return;
    }
    for (const field of fields) {
      if (!field.name.trim()) {
        setError("All fields must have a name");
        setSaving(false);
        return;
      }
    }

    try {
      const payload: any = {
        machine_name: formData.machine_name,
        name: formData.name,
        description: formData.description || null,
        task_type_id: formData.task_type_id
          ? parseInt(formData.task_type_id)
          : undefined,
        is_floating: formData.is_floating,
        is_transfer: formData.is_transfer,
        fields: fields,
      };

      if (editingTemplate) {
        await taskTemplatesApi.update(editingTemplate.id, payload);
      } else {
        await taskTemplatesApi.create(payload);
      }
      setShowModal(false);
      fetchData();
    } catch (e: any) {
      setError(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (template: any) => {
    if (!confirm(`Delete template "${template.name}"?`)) return;
    try {
      await taskTemplatesApi.delete(template.id);
      fetchData();
    } catch (e: any) {
      alert(e.message || "Failed to delete");
    }
  };

  const toggleTemplateSelection = (id: number) => {
    setSelectedTemplateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedTemplateIds.size === templates.length) {
      setSelectedTemplateIds(new Set());
    } else {
      setSelectedTemplateIds(new Set(templates.map((t) => t.id)));
    }
  };

  const bulkAllowedTypes =
    bulkFieldCategory === "conditions"
      ? FIELD_CATEGORIES.conditions.types.filter(
          (t) => t.value === "capabilities_list" || t.value === "persons_list",
        )
      : FIELD_CATEGORIES.arbitrary.types;

  const handleBulkAddField = async () => {
    if (!bulkFieldName.trim() || selectedTemplateIds.size === 0) return;
    setBulkSaving(true);
    try {
      const updates = templates
        .filter((t) => selectedTemplateIds.has(t.id))
        .map((template) => {
          const existing: TemplateField[] = template.fields || [];
          // Skip if field with same name and type already exists
          if (
            existing.some(
              (f) =>
                f.name === bulkFieldName.trim() && f.type === bulkFieldType,
            )
          )
            return null;
          const newField: TemplateField = {
            id: `field_${Date.now()}_${template.id}`,
            name: bulkFieldName.trim(),
            type: bulkFieldType,
            category: bulkFieldCategory,
            locked: false,
            optimised: false,
            config: {},
            purpose: "operational_instruction",
            visibility: "never_publish",
            classification_reviewed: false,
            public_visibility_confirmed: false,
          };
          return taskTemplatesApi.update(template.id, {
            ...template,
            task_type_id: template.task_type_id,
            fields: [...existing, newField],
          });
        })
        .filter(Boolean);
      await Promise.all(updates);
      setBulkFieldName("");
      setSelectedTemplateIds(new Set());
      fetchData();
    } catch (e: any) {
      alert(e.message || "Bulk add failed");
    } finally {
      setBulkSaving(false);
    }
  };

  const handleBulkRemoveField = async () => {
    if (!bulkFieldName.trim() || selectedTemplateIds.size === 0) return;
    setBulkSaving(true);
    try {
      const updates = templates
        .filter((t) => selectedTemplateIds.has(t.id))
        .map((template) => {
          const existing: TemplateField[] = template.fields || [];
          const filtered = existing.filter(
            (f) =>
              !(
                f.name === bulkFieldName.trim() &&
                f.type === bulkFieldType &&
                !f.locked
              ),
          );
          if (filtered.length === existing.length) return null; // nothing to remove
          return taskTemplatesApi.update(template.id, {
            ...template,
            task_type_id: template.task_type_id,
            fields: filtered,
          });
        })
        .filter(Boolean);
      await Promise.all(updates);
      setBulkFieldName("");
      setSelectedTemplateIds(new Set());
      fetchData();
    } catch (e: any) {
      alert(e.message || "Bulk remove failed");
    } finally {
      setBulkSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 156, g: 163, b: 175 };
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Task Templates
          </h3>
          <p className="text-sm text-foreground-muted mt-1">
            Reusable blueprints with custom fields for building tasks
          </p>
        </div>
        <Button variant="primary" onClick={openAdd}>
          + Add Template
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-12 text-foreground-muted">
          <p>No task templates defined yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Bulk Action Bar */}
          {selectedTemplateIds.size > 0 && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
                {selectedTemplateIds.size} selected
              </span>
              <div className="h-4 w-px bg-blue-300 dark:bg-blue-700" />
              <div className="flex items-center gap-1.5">
                <select
                  value={bulkFieldCategory}
                  onChange={(e) => {
                    const cat = e.target.value as "arbitrary" | "conditions";
                    setBulkFieldCategory(cat);
                    const types =
                      cat === "conditions"
                        ? FIELD_CATEGORIES.conditions.types.filter(
                            (t) =>
                              t.value === "capabilities_list" ||
                              t.value === "persons_list",
                          )
                        : FIELD_CATEGORIES.arbitrary.types;
                    setBulkFieldType(types[0].value);
                  }}
                  className="text-sm border border-bordercl-strong rounded px-2 py-1 bg-surface text-foreground"
                >
                  <option value="conditions">Condition</option>
                  <option value="arbitrary">Arbitrary</option>
                </select>
                <select
                  value={bulkFieldType}
                  onChange={(e) => setBulkFieldType(e.target.value)}
                  className="text-sm border border-bordercl-strong rounded px-2 py-1 bg-surface text-foreground"
                >
                  {bulkAllowedTypes.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={bulkFieldName}
                  onChange={(e) => setBulkFieldName(e.target.value)}
                  placeholder="Field name..."
                  className="text-sm border border-bordercl-strong rounded px-2 py-1 w-36 bg-surface text-foreground"
                />
                <button
                  onClick={handleBulkAddField}
                  disabled={!bulkFieldName.trim() || bulkSaving}
                  className="px-2 py-1 text-xs font-medium rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  + Add
                </button>
                <button
                  onClick={handleBulkRemoveField}
                  disabled={!bulkFieldName.trim() || bulkSaving}
                  className="px-2 py-1 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  &minus; Remove
                </button>
              </div>
              <div className="h-4 w-px bg-blue-300 dark:bg-blue-700" />
              <button
                onClick={() => setSelectedTemplateIds(new Set())}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Clear Selection
              </button>
            </div>
          )}

          {/* Select All header */}
          <div className="flex items-center gap-2 px-3 py-1">
            <input
              type="checkbox"
              checked={
                selectedTemplateIds.size === templates.length &&
                templates.length > 0
              }
              onChange={toggleSelectAll}
              className="rounded border-bordercl-strong"
            />
            <span className="text-xs text-foreground-muted">Select all</span>
          </div>

          {templates
            .sort((a, b) => {
              const ttA = taskTypes.find((t) => t.id === a.task_type_id);
              const ttB = taskTypes.find((t) => t.id === b.task_type_id);
              return (ttA?.sort_order ?? 999999) - (ttB?.sort_order ?? 999999);
            })
            .map((template) => {
              const taskType = taskTypes.find(
                (t) => t.id === template.task_type_id,
              );
              const typeColor = taskType?.color || "#9CA3AF";
              const rgb = hexToRgb(typeColor);

              return (
                <div
                  key={template.id}
                  className="flex items-center gap-3 rounded-lg p-3 border"
                  style={{
                    backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1)`,
                    borderColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedTemplateIds.has(template.id)}
                    onChange={() => toggleTemplateSelection(template.id)}
                    className="rounded border-bordercl-strong flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground text-sm">
                        {template.name}
                      </span>
                      {template.description && (
                        <span className="text-sm text-foreground-muted truncate">
                          - {template.description}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 flex-wrap max-w-[50%] justify-end">
                    {template.fields && template.fields.length > 0 ? (
                      sortFields(template.fields).map(
                        (field: TemplateField) => {
                          const catKey =
                            field.category ||
                            (Object.entries(FIELD_CATEGORIES).find(([_, cat]) =>
                              cat.types.some((t) => t.value === field.type),
                            )?.[0] as "arbitrary" | "conditions") ||
                            "arbitrary";
                          const CategoryIcon =
                            FIELD_CATEGORIES[catKey]?.icon || Minus;

                          return (
                            <Tooltip
                              key={field.id}
                              content={`${field.name} (${FIELD_TYPES.find((t) => t.value === field.type)?.label || field.type})`}
                              side="top"
                            >
                              <div className="px-2 py-0.5 rounded flex items-center gap-1 bg-surface-inset dark:bg-surface-hover text-foreground text-xs font-medium whitespace-nowrap">
                                <CategoryIcon className="w-3 h-3" />
                                <span className="truncate max-w-[100px]">
                                  {field.name}
                                </span>
                              </div>
                            </Tooltip>
                          );
                        },
                      )
                    ) : (
                      <span className="text-xs text-foreground-faint">
                        No fields
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => openEdit(template)}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(template)}
                      className="text-sm text-red-600 hover:text-red-800"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Template Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-5">
              <h3 className="text-base font-semibold mb-3">
                {editingTemplate ? "Edit Template" : "Add Template"}
              </h3>

              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded">
                    {error}
                  </div>
                )}

                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-foreground-secondary mb-1">
                      Machine Name *
                    </label>
                    <input
                      type="text"
                      required
                      pattern="[a-z0-9_]+"
                      title="Lowercase ASCII letters, numbers, and underscores only"
                      value={formData.machine_name}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          machine_name: e.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9_]/g, "_"),
                        })
                      }
                      className="w-full px-2 py-1.5 border border-bordercl-strong rounded-md font-mono text-sm"
                      placeholder="task_template_name"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground-secondary mb-1">
                      Display Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      className="w-full px-2 py-1.5 border border-bordercl-strong rounded-md text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground-secondary mb-1">
                      Task Type *
                    </label>
                    <select
                      value={formData.task_type_id}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          task_type_id: e.target.value,
                        })
                      }
                      className={`w-full px-2 py-1.5 border rounded-md text-sm ${
                        !formData.task_type_id
                          ? "border-amber-300 bg-amber-50 text-foreground dark:bg-amber-950/30 dark:text-foreground"
                          : "border-bordercl-strong bg-surface text-foreground"
                      }`}
                    >
                      <option value="" className="bg-surface text-foreground">
                        Select a task type...
                      </option>
                      {taskTypes.map((type) => (
                        <option
                          key={type.id}
                          value={type.id}
                          className="bg-surface text-foreground"
                        >
                          {type.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <PermittedDataInputNotice />
                    <label className="block text-xs font-medium text-foreground-secondary mb-1">
                      Internal organiser operational template description
                    </label>
                    <input
                      type="text"
                      value={formData.description}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          description: e.target.value,
                        })
                      }
                      className="w-full px-2 py-1.5 border border-bordercl-strong rounded-md text-sm"
                    />
                    <p className="mt-1 text-xs text-foreground-muted">Organisers only. Describe the template purpose, not a participant.</p>
                  </div>
                </div>

                {/* Configuration toggles */}
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground-secondary">
                      Scheduling:
                    </span>
                    <SegmentedToggle
                      value={formData.is_floating || false}
                      options={["Static", "Floating"]}
                      onChange={(checked) =>
                        updateTaskConfiguration({ is_floating: checked })
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground-secondary">
                      Type:
                    </span>
                    <SegmentedToggle
                      value={formData.is_transfer || false}
                      options={["Task", "Transfer"]}
                      onChange={(checked) =>
                        updateTaskConfiguration({ is_transfer: checked })
                      }
                    />
                  </div>
                </div>

                {/* Field Builder */}
                <div className="border-t pt-3">
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-3">
                      <h4 className="font-medium text-sm text-foreground">
                        Fields
                      </h4>
                      <span className="text-xs text-foreground-faint">
                        Time &amp; location auto-managed
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => addField("arbitrary")}
                        className="px-2 py-1 text-xs bg-surface-inset text-foreground rounded hover:bg-surface-inset dark:bg-surface-hover flex items-center gap-1"
                      >
                        <Minus className="w-3 h-3" />
                        <span>Arbitrary</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => addField("conditions")}
                        className="px-2 py-1 text-xs bg-surface-inset text-foreground rounded hover:bg-surface-inset dark:bg-surface-hover flex items-center gap-1"
                      >
                        <Lock className="w-3 h-3" />
                        <span>Condition</span>
                      </button>
                    </div>
                  </div>

                  {fields.length === 0 ? (
                    <div className="text-center py-6 text-foreground-muted border-2 border-dashed border-bordercl-strong rounded-lg">
                      <p className="text-sm">No fields defined yet.</p>
                      <p className="text-xs mt-1">
                        Click buttons above to add fields
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {sortFields(fields).map((field) => {
                        const origIdx = fields.findIndex(
                          (f) => f.id === field.id,
                        );
                        const catKey =
                          field.category ||
                          (Object.entries(FIELD_CATEGORIES).find(([_, cat]) =>
                            cat.types.some((t) => t.value === field.type),
                          )?.[0] as "arbitrary" | "conditions") ||
                          "arbitrary";
                        const catInfo = FIELD_CATEGORIES[catKey];
                        const isLocked = field.locked || false;
                        const isArbitrary = field.category !== "conditions";
                        const isDragging = dragFieldId === field.id;
                        const isDragOver = dragOverFieldId === field.id;

                        return (
                          <div
                            key={field.id}
                            draggable={isArbitrary && !isLocked}
                            onDragStart={
                              isArbitrary && !isLocked
                                ? (e) => handleDragStart(e, field.id)
                                : undefined
                            }
                            onDragOver={
                              isArbitrary && !isLocked
                                ? (e) => handleDragOver(e, field.id)
                                : undefined
                            }
                            onDrop={
                              isArbitrary && !isLocked
                                ? (e) => handleDrop(e, field.id)
                                : undefined
                            }
                            onDragEnd={handleDragEnd}
                            className={`border rounded-md px-3 py-2 ${
                              isLocked
                                ? "border-blue-300 bg-blue-50 dark:bg-blue-950/30"
                                : "border-bordercl bg-surface-alt"
                            } ${isDragging ? "opacity-40" : ""} ${isDragOver && !isDragging ? "border-blue-500 border-dashed" : ""}`}
                          >
                            <div className="flex items-center gap-3">
                              {isArbitrary && !isLocked ? (
                                <GripVertical className="w-4 h-4 text-foreground-muted cursor-grab flex-shrink-0" />
                              ) : (
                                <div className="w-4 flex-shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <input
                                  type="text"
                                  required
                                  value={field.name}
                                  disabled={isLocked}
                                  onChange={(e) =>
                                    updateField(origIdx, {
                                      name: e.target.value,
                                    })
                                  }
                                  className={`w-full px-2 py-1 border border-bordercl-strong rounded text-sm ${
                                    isLocked
                                      ? "bg-surface-inset cursor-not-allowed"
                                      : ""
                                  }`}
                                  placeholder="Field name"
                                />
                              </div>
                              <div className="w-48 flex-shrink-0">
                                <select
                                  value={field.type}
                                  disabled={isLocked}
                                  onChange={(e) =>
                                    updateField(origIdx, {
                                      type: e.target.value,
                                      locked: false,
                                      classification_reviewed: false,
                                      public_visibility_confirmed: false,
                                    })
                                  }
                                  className={`w-full px-2 py-1 border border-bordercl-strong rounded text-sm ${
                                    isLocked
                                      ? "bg-surface-inset cursor-not-allowed"
                                      : ""
                                  }`}
                                >
                                  {catInfo.types
                                    .filter((type) => {
                                      if (
                                        field.category === "conditions" &&
                                        !isLocked
                                      ) {
                                        return (
                                          type.value === "capabilities_list" ||
                                          type.value === "persons_list"
                                        );
                                      }
                                      return true;
                                    })
                                    .map((type) => (
                                      <option
                                        key={type.value}
                                        value={type.value}
                                      >
                                        {type.label}
                                      </option>
                                    ))}
                                </select>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="px-1.5 py-0.5 text-xs rounded bg-surface-inset text-foreground-muted inline-flex items-center gap-1">
                                  <catInfo.icon className="w-3 h-3" />
                                  {catInfo.label}
                                </span>
                                {!isLocked ? (
                                  <button
                                    type="button"
                                    onClick={() => removeField(origIdx)}
                                    className="text-xs text-red-600 hover:text-red-800"
                                  >
                                    Delete
                                  </button>
                                ) : (
                                  <span className="text-xs text-blue-600">
                                    Auto
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="ml-7 mt-2 grid gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/20 sm:grid-cols-3">
                              <label>
                                <span className="mb-1 block font-medium">Operational purpose</span>
                                <select
                                  value={field.purpose ?? "operational_instruction"}
                                  onChange={(event) => updateField(origIdx, {
                                    purpose: event.target.value as TemplateField["purpose"],
                                    classification_reviewed: false,
                                  })}
                                  className="w-full rounded border border-bordercl-strong bg-surface px-2 py-1"
                                >
                                  <option value="assignment">Assignment</option>
                                  <option value="capability_requirement">Capability requirement</option>
                                  <option value="location">Location</option>
                                  <option value="operational_instruction">Operational instruction</option>
                                  <option value="reference">Reference</option>
                                  <option value="timing">Timing</option>
                                </select>
                              </label>
                              <label>
                                <span className="mb-1 block font-medium">Who may receive it</span>
                                <select
                                  value={field.visibility ?? "never_publish"}
                                  onChange={(event) => updateField(origIdx, {
                                    visibility: event.target.value as TemplateField["visibility"],
                                    classification_reviewed: false,
                                    public_visibility_confirmed: false,
                                  })}
                                  className="w-full rounded border border-bordercl-strong bg-surface px-2 py-1"
                                >
                                  <option value="never_publish">Never publish</option>
                                  <option value="organiser">Organisers only</option>
                                  <option value="participant">Authenticated participants</option>
                                  <option value="public">Public</option>
                                </select>
                              </label>
                              <label className="flex items-start gap-2 pt-5">
                                <input
                                  type="checkbox"
                                  checked={field.classification_reviewed ?? false}
                                  onChange={(event) => updateField(origIdx, {
                                    classification_reviewed: event.target.checked,
                                  })}
                                />
                                <span>I reviewed necessity and audience. Do not enter sensitive or unrelated personal information. Exact policy details are shown in MP-Backend settings.</span>
                              </label>
                              {field.visibility === "public" && (
                                <label className="flex items-start gap-2 sm:col-span-3">
                                  <input
                                    type="checkbox"
                                    checked={field.public_visibility_confirmed ?? false}
                                    onChange={(event) => updateField(origIdx, {
                                      public_visibility_confirmed: event.target.checked,
                                      classification_reviewed: false,
                                    })}
                                  />
                                  <span>I explicitly confirm that this field may be disclosed to the public. This classification change is recorded under a pseudonymous local operator identifier.</span>
                                </label>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-3 border-t">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowModal(false)}
                    disabled={saving}
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
                      !formData.task_type_id
                    }
                  >
                    {saving
                      ? "Saving..."
                      : editingTemplate
                        ? "Update Template"
                        : "Create Template"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
