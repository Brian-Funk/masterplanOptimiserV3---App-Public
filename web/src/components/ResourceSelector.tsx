import React, { useState, useRef, useEffect } from "react";
import { X, Plus, MapPin, Users, Zap, User, Search } from "lucide-react";
import { Tooltip } from "@/components/ui";

type Resource = {
  id: number;
  name: string;
  description?: string;
};

type SelectedResource = {
  id: number;
  name: string;
  description?: string;
  quantity?: number;
  type?: "person" | "group"; // Add type to distinguish persons from groups
};

/** Sentinel ID used to represent "Any Location" in the resource selector. */
export const ANY_LOCATION_ID = -1;

type ResourceSelectorProps = {
  type: "location" | "group" | "capability" | "person";
  availableResources: Resource[];
  availableGroups?: Resource[]; // Optional groups for person type
  selectedResources: SelectedResource[];
  onAdd: (resource: Resource, quantity?: number) => void;
  onAddGroup?: (group: Resource) => void; // For adding groups (right-click)
  onRemove: (resourceId: number, resourceType?: "person" | "group") => void;
  onChangeQuantity?: (resourceId: number, newQuantity: number) => void;
  allowMultiple?: boolean;
  allowQuantity?: boolean;
  supportsGroups?: boolean; // Enable group support for person type
  customColor?: string; // Hex color for custom styling
  isCondition?: boolean; // True for conditions (normal saturation), false for arbitrary (less saturated)
  onItemHover?: (resourceId: number, operation: "add" | "remove") => void;
  onItemHoverEnd?: () => void;
  allowAnyLocation?: boolean; // Show an "Any Location" option for location selectors
};

const ResourceSelector: React.FC<ResourceSelectorProps> = ({
  type,
  availableResources,
  availableGroups = [],
  selectedResources,
  onAdd,
  onAddGroup,
  onRemove,
  onChangeQuantity,
  allowMultiple = false,
  allowQuantity = false,
  supportsGroups = false,
  customColor,
  isCondition = true,
  onItemHover,
  onItemHoverEnd,
  allowAnyLocation = false,
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false);
  const [editingQuantity, setEditingQuantity] = useState<number | null>(null);
  const [tempQuantity, setTempQuantity] = useState<number>(1);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [groupSearchTerm, setGroupSearchTerm] = useState<string>("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const groupDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  // Use requestAnimationFrame to defer state updates so the browser's native
  // focus assignment to the clicked element completes before the re-render.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        requestAnimationFrame(() => {
          setIsDropdownOpen(false);
          setSearchTerm("");
        });
      }
      if (
        groupDropdownRef.current &&
        !groupDropdownRef.current.contains(event.target as Node)
      ) {
        requestAnimationFrame(() => {
          setIsGroupDropdownOpen(false);
          setGroupSearchTerm("");
        });
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Helper to convert hex to RGB
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

  const getIcon = () => {
    switch (type) {
      case "location":
        return <MapPin className="w-4 h-4" />;
      case "group":
        return <Users className="w-4 h-4" />;
      case "capability":
        return <Zap className="w-4 h-4" />;
      case "person":
        return <User className="w-4 h-4" />;
    }
  };

  const getColor = () => {
    if (customColor) {
      const rgb = hexToRgb(customColor);
      const opacity = isCondition ? 0.1 : 0.05;
      const borderOpacity = isCondition ? 0.3 : 0.15;

      return {
        bg: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`,
        border: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${borderOpacity})`,
        text: customColor,
        hoverBg: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity * 2})`,
        buttonBg: customColor,
        buttonHover: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.9)`,
      };
    }

    // Default gray colors
    return {
      bg: "bg-surface-alt",
      border: "border-bordercl-strong",
      text: "text-foreground-secondary",
      hoverBg: "hover:bg-surface-hover",
      buttonBg: "bg-gray-600",
      buttonHover: "hover:bg-gray-700",
    };
  };

  const colors = getColor();
  // For single-select location with allowAnyLocation, always allow changing
  const canReplace =
    !allowMultiple && allowAnyLocation && selectedResources.length > 0;
  const canAddMore =
    allowMultiple || selectedResources.length === 0 || canReplace;
  // When "Any Location" is selected, hide the + button (no regular location needed)
  const hasAnyLocation = selectedResources.some(
    (s) => s.id === ANY_LOCATION_ID,
  );
  const availableToAdd = availableResources.filter(
    (r) =>
      canReplace ||
      !selectedResources.some(
        (s) => s.id === r.id && (type === "person" ? s.type !== "group" : true),
      ),
  );
  const availableGroupsToAdd = availableGroups.filter(
    (g) => !selectedResources.some((s) => s.id === g.id && s.type === "group"),
  );

  // Filter available resources based on search term
  const filteredResources = availableToAdd.filter((r) =>
    (r.name || "").toLowerCase().includes(searchTerm.toLowerCase()),
  );

  // Filter available groups based on search term
  const filteredGroups = availableGroupsToAdd.filter((g) =>
    (g.name || "").toLowerCase().includes(groupSearchTerm.toLowerCase()),
  );

  const handleAddResource = (resource: Resource) => {
    // For single-select replace mode: remove current selection before adding new one
    if (canReplace && selectedResources.length > 0) {
      onRemove(selectedResources[0].id, selectedResources[0].type);
    }
    if (allowQuantity) {
      onAdd(resource, 1);
    } else {
      onAdd(resource);
    }
    setIsDropdownOpen(false);
    setSearchTerm("");
  };

  const handleAddGroup = (group: Resource) => {
    if (onAddGroup) {
      onAddGroup(group);
    }
    setIsGroupDropdownOpen(false);
    setGroupSearchTerm("");
  };

  const handleQuantityClick = (resourceId: number, currentQuantity: number) => {
    setEditingQuantity(resourceId);
    setTempQuantity(currentQuantity);
  };

  const handleQuantitySave = (resourceId: number) => {
    if (onChangeQuantity && tempQuantity > 0) {
      onChangeQuantity(resourceId, tempQuantity);
    }
    setEditingQuantity(null);
  };

  return (
    <div className="rounded-lg border-2 border-bordercl-strong bg-surface p-3">
      <div className="flex flex-wrap gap-2 items-center">
        {/* Selected Resources */}
        {selectedResources.map((resource) => (
          <div
            key={`${resource.type || "resource"}-${resource.id}`}
            className={`flex items-center gap-1.5 ${colors.bg} border-2 ${colors.border} rounded-full px-3 py-1.5 text-sm shadow-sm`}
            onMouseEnter={() => onItemHover?.(resource.id, "remove")}
            onMouseLeave={() => onItemHoverEnd?.()}
          >
            {/* Show group icon for group type */}
            {resource.type === "group" && <Users className="w-3.5 h-3.5" />}
            <Tooltip content={resource.description} side="top">
              <span className={colors.text}>{resource.name}</span>
            </Tooltip>

            {allowQuantity && resource.quantity !== undefined && (
              <>
                <div className={`w-px h-4 ${colors.border}`}></div>
                {editingQuantity === resource.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="1"
                      value={tempQuantity}
                      onChange={(e) =>
                        setTempQuantity(parseInt(e.target.value) || 1)
                      }
                      onBlur={() => handleQuantitySave(resource.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleQuantitySave(resource.id);
                        if (e.key === "Escape") setEditingQuantity(null);
                      }}
                      className="w-12 px-1 py-0.5 text-xs border border-bordercl-strong rounded"
                      autoFocus
                    />
                  </div>
                ) : (
                  <Tooltip content="Click to edit quantity" side="top">
                    <button
                      onClick={() =>
                        handleQuantityClick(resource.id, resource.quantity!)
                      }
                      className={`px-1.5 py-0.5 text-xs bg-surface border ${colors.border} rounded ${colors.hoverBg} transition-colors`}
                    >
                      {resource.quantity}
                    </button>
                  </Tooltip>
                )}
              </>
            )}

            <Tooltip content="Remove" side="top">
              <button
                onClick={() => onRemove(resource.id, resource.type)}
                className={`${colors.text} hover:opacity-70 transition-opacity`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          </div>
        ))}

        {/* Add Button with Dropdown */}
        {canAddMore &&
          (availableToAdd.length > 0 ||
            (allowAnyLocation && !hasAnyLocation)) && (
            <div className="relative" ref={dropdownRef}>
              <Tooltip
                content={
                  supportsGroups
                    ? `Left-click: Add ${type} | Right-click: Add group`
                    : `Add ${type}`
                }
                side="top"
              >
                <button
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  onContextMenu={(e) => {
                    if (supportsGroups && availableGroupsToAdd.length > 0) {
                      e.preventDefault();
                      setIsGroupDropdownOpen(!isGroupDropdownOpen);
                      setIsDropdownOpen(false);
                    }
                  }}
                  className="flex items-center justify-center w-7 h-7 bg-gray-600 hover:bg-gray-700 text-white rounded-md transition-colors shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </Tooltip>

              {isDropdownOpen && (
                <div className="absolute top-8 left-0 z-20 bg-surface border border-bordercl rounded-lg shadow-lg min-w-48 max-h-60 overflow-hidden flex flex-col">
                  {/* Search input */}
                  <div className="p-2 border-b border-bordercl">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-foreground-faint" />
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder={`Search ${type}s...`}
                        className="w-full pl-8 pr-3 py-1.5 text-sm border border-bordercl-strong rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoFocus
                      />
                    </div>
                  </div>
                  {/* Resource list */}
                  <div className="overflow-y-auto max-h-48">
                    {/* Any Location option - shown at top for location selectors */}
                    {allowAnyLocation &&
                      type === "location" &&
                      !selectedResources.some(
                        (s) => s.id === ANY_LOCATION_ID,
                      ) &&
                      "any location".includes(searchTerm.toLowerCase()) && (
                        <button
                          onClick={() =>
                            handleAddResource({
                              id: ANY_LOCATION_ID,
                              name: "Any Location",
                            })
                          }
                          className="w-full px-3 py-2 text-left text-sm hover:bg-surface-hover transition-colors"
                        >
                          Any Location
                        </button>
                      )}
                    {filteredResources.length > 0 ? (
                      filteredResources.map((resource) => (
                        <button
                          key={resource.id}
                          onClick={() => handleAddResource(resource)}
                          onMouseEnter={() => onItemHover?.(resource.id, "add")}
                          onMouseLeave={() => onItemHoverEnd?.()}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-surface-hover transition-colors"
                        >
                          {resource.name}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-foreground-muted italic">
                        No matches found
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

        {/* Group Dropdown */}
        {supportsGroups &&
          availableGroupsToAdd.length > 0 &&
          isGroupDropdownOpen && (
            <div className="relative" ref={groupDropdownRef}>
              <div className="absolute top-8 left-0 z-20 bg-surface border border-bordercl rounded-lg shadow-lg min-w-48 max-h-60 overflow-hidden flex flex-col">
                <div className="px-3 py-2 text-xs text-foreground-muted border-b border-bordercl-subtle font-medium">
                  Add Group
                </div>
                {/* Search input */}
                <div className="p-2 border-b border-bordercl">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-foreground-faint" />
                    <input
                      type="text"
                      value={groupSearchTerm}
                      onChange={(e) => setGroupSearchTerm(e.target.value)}
                      placeholder="Search groups..."
                      className="w-full pl-8 pr-3 py-1.5 text-sm border border-bordercl-strong rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                  </div>
                </div>
                {/* Group list */}
                <div className="overflow-y-auto max-h-36">
                  {filteredGroups.length > 0 ? (
                    filteredGroups.map((group) => (
                      <button
                        key={group.id}
                        onClick={() => handleAddGroup(group)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-surface-hover transition-colors flex items-center gap-2"
                      >
                        <Users className="w-3.5 h-3.5 text-foreground-muted" />
                        {group.name}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-foreground-muted italic">
                      No matches found
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        {selectedResources.length === 0 && availableToAdd.length === 0 && (
          <span className="text-xs text-foreground-muted italic">
            None available
          </span>
        )}
      </div>
    </div>
  );
};

export default ResourceSelector;
