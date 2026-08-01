"use client";

import React, { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import { Tooltip } from "@/components/ui";
import { Person, Capability } from "@/lib/metrics/MetricInterface";
import { dedupeMetricIds } from "@/lib/metrics/metricScheduleData";

// 15 preset colors for the color picker
const PRESET_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#10b981", // green
  "#f59e0b", // amber
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#f97316", // orange
  "#6366f1", // indigo
  "#14b8a6", // teal
  "#e11d48", // rose
  "#a855f7", // violet
  "#0ea5e9", // sky
  "#78716c", // stone
];

export interface SelectedResource {
  id: number;
  type: "person" | "capability";
  name: string;
  color: string;
}

interface MetricResourceSelectorProps {
  people: Person[];
  capabilities: Capability[];
  selectedPersonIds: number[];
  selectedCapabilityIds: number[];
  colorMap: Record<string, string>;
  onAddPerson: (personId: number) => void;
  onRemovePerson: (personId: number) => void;
  onAddCapability: (capabilityId: number) => void;
  onRemoveCapability: (capabilityId: number) => void;
  onColorChange: (key: string, color: string) => void;
  onResourceHover?: (type: "person" | "capability", id: number) => void;
  onResourceHoverEnd?: () => void;
  /** When false the person-add dropdown is hidden (Add Filter opens capabilities directly). Default true. */
  showPersonFilter?: boolean;
}

const MetricResourceSelector: React.FC<MetricResourceSelectorProps> = ({
  people,
  capabilities,
  selectedPersonIds,
  selectedCapabilityIds,
  colorMap,
  onAddPerson,
  onRemovePerson,
  onAddCapability,
  onRemoveCapability,
  onColorChange,
  onResourceHover,
  onResourceHoverEnd,
  showPersonFilter = true,
}) => {
  const [showPersonDropdown, setShowPersonDropdown] = useState(false);
  const [showCapabilityDropdown, setShowCapabilityDropdown] = useState(false);
  const [personSearch, setPersonSearch] = useState("");
  const [capabilitySearch, setCapabilitySearch] = useState("");
  const [colorPickerTarget, setColorPickerTarget] = useState<string | null>(
    null,
  );

  const dropdownRef = useRef<HTMLDivElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  // Use requestAnimationFrame to defer state updates so the browser's native
  // focus assignment to the clicked element completes before the re-render.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        requestAnimationFrame(() => {
          setShowPersonDropdown(false);
          setShowCapabilityDropdown(false);
        });
      }
      if (
        colorPickerRef.current &&
        !colorPickerRef.current.contains(e.target as Node)
      ) {
        requestAnimationFrame(() => {
          setColorPickerTarget(null);
        });
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getColor = (key: string, index: number): string => {
    return colorMap[key] || PRESET_COLORS[index % PRESET_COLORS.length];
  };

  const dedupedPersonIds = dedupeMetricIds(selectedPersonIds);
  const dedupedCapabilityIds = dedupeMetricIds(selectedCapabilityIds);

  const filteredPeople = people.filter(
    (p) =>
      !dedupedPersonIds.includes(p.id) &&
      `${p.first_name} ${p.last_name}`
        .toLowerCase()
        .includes(personSearch.toLowerCase()),
  );

  const filteredCapabilities = capabilities.filter(
    (c) =>
      !dedupedCapabilityIds.includes(c.id) &&
      c.name.toLowerCase().includes(capabilitySearch.toLowerCase()),
  );

  // Build selected resources list for pills
  const selectedResources: SelectedResource[] = [
    ...dedupedPersonIds.map((id, i) => {
      const person = people.find((p) => p.id === id);
      const key = `person-${id}`;
      return {
        id,
        type: "person" as const,
        name: person
          ? `${person.first_name} ${person.last_name}`
          : `Person ${id}`,
        color: getColor(key, i),
      };
    }),
    ...dedupedCapabilityIds.map((id, i) => {
      const cap = capabilities.find((c) => c.id === id);
      const key = `capability-${id}`;
      return {
        id,
        type: "capability" as const,
        name: cap?.name || `Capability ${id}`,
        color: getColor(key, dedupedPersonIds.length + i),
      };
    }),
  ];

  return (
    <div className="space-y-2">
      {/* Selected resource pills */}
      {selectedResources.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedResources.map((resource) => {
            const colorKey = `${resource.type}-${resource.id}`;
            return (
              <Tooltip
                key={colorKey}
                content="Double-click to change colour"
                side="top"
              >
                <span
                  className="relative inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white cursor-pointer select-none"
                  style={{ backgroundColor: resource.color }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    setColorPickerTarget(
                      colorPickerTarget === colorKey ? null : colorKey,
                    );
                  }}
                  onMouseEnter={() =>
                    onResourceHover?.(resource.type, resource.id)
                  }
                  onMouseLeave={() => onResourceHoverEnd?.()}
                >
                  <span className="max-w-[80px] truncate">{resource.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (resource.type === "person") {
                        onRemovePerson(resource.id);
                      } else {
                        onRemoveCapability(resource.id);
                      }
                    }}
                    className="ml-0.5 hover:bg-white/30 dark:hover:bg-gray-600/30 rounded-full p-0.5"
                  >
                    <X size={10} />
                  </button>

                  {/* Color picker inline popup */}
                  {colorPickerTarget === colorKey && (
                    <div
                      ref={colorPickerRef}
                      className="absolute z-50 mt-1 p-2 bg-surface border border-bordercl rounded-lg shadow-lg"
                      style={{ top: "100%", left: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="grid grid-cols-5 gap-1">
                        {PRESET_COLORS.map((color) => (
                          <button
                            key={color}
                            className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                            style={{
                              backgroundColor: color,
                              borderColor:
                                resource.color === color
                                  ? "#111"
                                  : "transparent",
                            }}
                            onClick={() => {
                              onColorChange(colorKey, color);
                              setColorPickerTarget(null);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </span>
              </Tooltip>
            );
          })}
        </div>
      )}

      {/* Single Add Filter button - left-click: person, right-click: capability */}
      <div className="relative" ref={dropdownRef}>
        <Tooltip
          content={
            showPersonFilter
              ? "Left-click: add person / Right-click: add capability"
              : "Click to add capability filter"
          }
          side="top"
        >
          <button
            onClick={() => {
              if (showPersonFilter) {
                setShowCapabilityDropdown(false);
                setShowPersonDropdown(!showPersonDropdown);
                setPersonSearch("");
              } else {
                setShowPersonDropdown(false);
                setShowCapabilityDropdown(!showCapabilityDropdown);
                setCapabilitySearch("");
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setShowPersonDropdown(false);
              setShowCapabilityDropdown(!showCapabilityDropdown);
              setCapabilitySearch("");
            }}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-foreground-muted bg-surface-inset hover:bg-surface-inset dark:bg-surface-hover rounded-md transition-colors"
          >
            Add Filter
          </button>
        </Tooltip>

        {/* Person dropdown (left-click) */}
        {showPersonFilter && showPersonDropdown && (
          <div className="absolute z-50 top-full left-0 mt-1 w-52 bg-surface border border-bordercl rounded-lg shadow-lg overflow-hidden">
            <div className="px-2 py-1.5 bg-surface-alt border-b border-bordercl-subtle">
              <span className="text-[10px] font-semibold text-foreground-faint uppercase tracking-wide">
                People
              </span>
            </div>
            <div className="p-2 border-b border-bordercl-subtle">
              <div className="relative">
                <Search
                  size={12}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-foreground-faint"
                />
                <input
                  type="text"
                  value={personSearch}
                  onChange={(e) => setPersonSearch(e.target.value)}
                  placeholder="Search people..."
                  className="w-full pl-7 pr-2 py-1 text-xs border border-bordercl rounded focus:outline-none focus:border-blue-400"
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-36 overflow-y-auto">
              {filteredPeople.length === 0 ? (
                <div className="p-2 text-xs text-foreground-faint text-center">
                  No people available
                </div>
              ) : (
                filteredPeople.map((person) => (
                  <button
                    key={person.id}
                    onClick={() => {
                      onAddPerson(person.id);
                      setShowPersonDropdown(false);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                  >
                    {person.first_name} {person.last_name}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Capability dropdown (right-click) */}
        {showCapabilityDropdown && (
          <div className="absolute z-50 top-full left-0 mt-1 w-52 bg-surface border border-bordercl rounded-lg shadow-lg overflow-hidden">
            <div className="px-2 py-1.5 bg-surface-alt border-b border-bordercl-subtle">
              <span className="text-[10px] font-semibold text-foreground-faint uppercase tracking-wide">
                Capabilities
              </span>
            </div>
            <div className="p-2 border-b border-bordercl-subtle">
              <div className="relative">
                <Search
                  size={12}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-foreground-faint"
                />
                <input
                  type="text"
                  value={capabilitySearch}
                  onChange={(e) => setCapabilitySearch(e.target.value)}
                  placeholder="Search capabilities..."
                  className="w-full pl-7 pr-2 py-1 text-xs border border-bordercl rounded focus:outline-none focus:border-blue-400"
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-36 overflow-y-auto">
              {filteredCapabilities.length === 0 ? (
                <div className="p-2 text-xs text-foreground-faint text-center">
                  No capabilities available
                </div>
              ) : (
                filteredCapabilities.map((cap) => (
                  <button
                    key={cap.id}
                    onClick={() => {
                      onAddCapability(cap.id);
                      setShowCapabilityDropdown(false);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors"
                  >
                    {cap.name}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MetricResourceSelector;
