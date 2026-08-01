import React from "react";

/** Props for the shared labelled select component. */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string | number; label: string }[];
}

/** Render a styled native select with optional label and error state. */
export const Select: React.FC<SelectProps> = ({
  label,
  error,
  options,
  className = "",
  id,
  ...props
}) => {
  const selectId = id || `select-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={selectId}
          className="block text-sm font-medium text-foreground-secondary mb-1.5"
        >
          {label}
        </label>
      )}
      <select
        id={selectId}
        style={
          {
            "--tw-ring-color": error ? undefined : "var(--color-primary)",
          } as React.CSSProperties
        }
        className={`
          w-full px-3 py-2 
          border rounded-lg
          text-foreground 
          bg-surface
          transition-colors duration-200
          focus:outline-none focus:ring-2 focus:border-transparent
          disabled:bg-surface-alt disabled:text-foreground-muted disabled:cursor-not-allowed
          ${error ? "border-red-300 focus:ring-red-500" : "border-bordercl-strong"}
          ${className}
        `}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
    </div>
  );
};
