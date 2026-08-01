import React, { useState, useRef, useEffect } from "react";

/** Option shown by the searchable select dropdown. */
export interface SearchableSelectOption {
  value: string | number;
  label: string;
  description?: string;
}

/** Props for the searchable select dropdown. */
export interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  emptyMessage?: string;
}

/** Render a searchable dropdown for longer option lists. */
export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = "Select...",
  disabled = false,
  className = "",
  emptyMessage = "No options available",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter options based on search term
  const filteredOptions = options.filter(
    (option) =>
      (option.label || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (option.description &&
        option.description.toLowerCase().includes(searchTerm.toLowerCase())),
  );

  // Get selected option label
  const selectedOption = options.find((opt) => opt.value === value);
  const displayText = selectedOption ? selectedOption.label : "";

  // Close dropdown when clicking outside
  // Use requestAnimationFrame to defer state updates so the browser's native
  // focus assignment to the clicked element completes before the re-render.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        requestAnimationFrame(() => {
          setIsOpen(false);
          setSearchTerm("");
        });
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSelect = (optionValue: string | number) => {
    onChange(String(optionValue));
    setIsOpen(false);
    setSearchTerm("");
  };

  const handleToggle = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
      setSearchTerm("");
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        style={
          { "--tw-ring-color": "var(--color-primary)" } as React.CSSProperties
        }
        className={`
          w-full px-3 py-2 
          border rounded-lg
          text-left text-sm
          bg-surface
          transition-colors duration-200
          focus:outline-none focus:ring-2 focus:border-transparent
          disabled:bg-surface-alt disabled:text-foreground-muted disabled:cursor-not-allowed
          border-bordercl-strong
          ${isOpen ? "ring-2 border-transparent" : ""}
          ${disabled ? "cursor-not-allowed" : "cursor-pointer"}
        `}
      >
        <div className="flex items-center justify-between">
          <span className={displayText ? "text-foreground" : "text-foreground-muted"}>
            {displayText || placeholder}
          </span>
          <svg
            className={`w-4 h-4 text-foreground-faint transition-transform ${
              isOpen ? "transform rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-surface border border-bordercl-strong rounded-lg shadow-lg">
          {/* Search Input */}
          <div className="p-2 border-b border-bordercl">
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search..."
                style={
                  {
                    "--tw-ring-color": "var(--color-primary)",
                  } as React.CSSProperties
                }
                className="w-full px-3 py-2 pl-9 text-sm border border-bordercl-strong rounded-lg focus:outline-none focus:ring-2 focus:border-transparent"
              />
              <svg
                className="absolute left-3 top-2.5 w-4 h-4 text-foreground-faint"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
          </div>

          {/* Options List */}
          <div className="max-h-60 overflow-y-auto">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={`
                    w-full px-3 py-2 text-left text-sm
                    hover:bg-blue-50 dark:bg-blue-950/30 dark:hover:bg-blue-950/30 focus:bg-blue-50 dark:bg-blue-950/30 focus:outline-none
                    transition-colors duration-150
                    ${
                      option.value === value
                        ? "bg-blue-100 text-blue-900 font-medium"
                        : "text-foreground"
                    }
                  `}
                >
                  <div className="flex flex-col">
                    <span>{option.label}</span>
                    {option.description && (
                      <span className="text-xs text-foreground-muted mt-0.5">
                        {option.description}
                      </span>
                    )}
                  </div>
                </button>
              ))
            ) : (
              <div className="px-3 py-6 text-center text-sm text-foreground-muted">
                {searchTerm ? `No results for "${searchTerm}"` : emptyMessage}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
