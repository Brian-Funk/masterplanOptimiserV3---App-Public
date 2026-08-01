import React from "react";

/** Props for the shared themed button component. */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  children: React.ReactNode;
}

/** Render a themed action button with consistent sizing and variants. */
export const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className = "",
  children,
  disabled,
  ...props
}) => {
  const baseStyles =
    "inline-flex items-center justify-center rounded-md font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50";

  const variants = {
    primary: "text-white shadow-sm hover:brightness-105 active:brightness-95",
    secondary: "text-white shadow-sm hover:brightness-105 active:brightness-95",
    outline: "border border-bordercl-strong bg-surface text-foreground-secondary hover:bg-surface-hover",
    ghost: "text-foreground-secondary hover:bg-surface-hover",
    danger: "text-white shadow-sm hover:brightness-105 active:brightness-95",
  };

  const getVariantStyles = (): React.CSSProperties => {
    switch (variant) {
      case "primary":
        return {
          backgroundColor: "var(--color-primary)",
          borderColor: "var(--color-primary)",
          "--tw-ring-color": "var(--color-primary)",
        } as React.CSSProperties;
      case "secondary":
        return {
          backgroundColor: "var(--color-secondary)",
          borderColor: "var(--color-secondary)",
          "--tw-ring-color": "var(--color-secondary)",
        } as React.CSSProperties;
      case "danger":
        return {
          backgroundColor: "var(--color-error)",
          borderColor: "var(--color-error)",
          "--tw-ring-color": "var(--color-error)",
        } as React.CSSProperties;
      default:
        return {};
    }
  };

  const sizes = {
    sm: "px-3 py-1.5 text-sm gap-1.5",
    md: "min-h-9 px-4 py-2 text-sm gap-2",
    lg: "min-h-10 px-5 py-2.5 text-base gap-2.5",
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${
        fullWidth ? "w-full" : ""
      } ${className}`}
      style={getVariantStyles()}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};
