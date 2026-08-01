import React from "react";

/** Props for the compact binary switch control. */
export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  leftLabel?: string;
  rightLabel?: string;
  disabled?: boolean;
  className?: string;
}

/** Render a labelled on/off switch. */
export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  leftLabel,
  rightLabel,
  disabled = false,
  className = "",
}) => {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {leftLabel && (
        <span
          className={`text-sm font-medium ${
            checked ? "text-foreground-muted" : "text-foreground"
          }`}
        >
          {leftLabel}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
          checked ? "bg-blue-600" : "bg-bordercl-strong dark:bg-gray-600"
        }`}
        style={{
          backgroundColor: checked ? "var(--color-primary)" : undefined,
        }}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
      {rightLabel && (
        <span
          className={`text-sm font-medium ${
            checked ? "text-foreground" : "text-foreground-muted"
          }`}
        >
          {rightLabel}
        </span>
      )}
    </div>
  );
};
