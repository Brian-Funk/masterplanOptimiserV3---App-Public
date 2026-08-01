import React from "react";

/** Props for the shared labelled text input component. */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

/** Render a styled input with optional label, helper text, and error state. */
export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  className = "",
  id,
  ...props
}) => {
  const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-foreground-secondary mb-1.5"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        style={
          {
            "--tw-ring-color": error ? undefined : "var(--color-primary)",
          } as React.CSSProperties
        }
        className={`
          w-full px-3 py-2 
          border rounded-lg
          text-foreground placeholder-foreground-faint
          transition-colors duration-200
          focus:outline-none focus:ring-2 focus:border-transparent
          disabled:bg-surface-alt disabled:text-foreground-muted disabled:cursor-not-allowed
          ${error ? "border-red-300 focus:ring-red-500" : "border-bordercl-strong"}
          ${className}
        `}
        {...props}
      />
      {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
      {helperText && !error && (
        <p className="mt-1.5 text-sm text-foreground-muted">{helperText}</p>
      )}
    </div>
  );
};
