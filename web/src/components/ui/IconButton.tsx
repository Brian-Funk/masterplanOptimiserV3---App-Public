import React from "react";

/** Props for icon-only buttons used in toolbars and compact controls. */
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
}

/** Render a square themed button intended for icon-only actions. */
export const IconButton: React.FC<IconButtonProps> = ({
  variant = "ghost",
  size = "md",
  className = "",
  children,
  ...props
}) => {
  const baseStyles =
    "inline-flex items-center justify-center rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";

  const variants = {
    primary: "text-white",
    secondary: "text-white",
    ghost: "text-foreground-muted hover:bg-surface-hover focus:ring-foreground-muted",
  };

  const getVariantStyles = (): React.CSSProperties => {
    switch (variant) {
      case "primary":
        return {
          backgroundColor: "var(--color-primary)",
          "--tw-ring-color": "var(--color-primary)",
        } as React.CSSProperties;
      case "secondary":
        return {
          backgroundColor: "var(--color-secondary)",
          "--tw-ring-color": "var(--color-secondary)",
        } as React.CSSProperties;
      default:
        return {};
    }
  };

  const sizes = {
    sm: "w-8 h-8 text-sm",
    md: "w-10 h-10 text-base",
    lg: "w-12 h-12 text-lg",
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      style={getVariantStyles()}
      {...props}
    >
      {children}
    </button>
  );
};
