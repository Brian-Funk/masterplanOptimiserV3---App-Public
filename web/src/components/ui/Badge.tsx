import React from "react";

/** Props for the small status/category badge component. */
export interface BadgeProps {
  children: React.ReactNode;
  variant?:
    | "primary"
    | "secondary"
    | "success"
    | "warning"
    | "danger"
    | "neutral";
  className?: string;
}

/** Render a compact themed badge for status, category, or metadata labels. */
export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "neutral",
  className = "",
}) => {
  const getVariantStyles = () => {
    const baseOpacity = 0.1;
    const textOpacity = 0.8;

    switch (variant) {
      case "primary":
        return {
          backgroundColor: `color-mix(in srgb, var(--color-primary) ${
            baseOpacity * 100
          }%, white)`,
          color: "var(--color-primary)",
        };
      case "secondary":
        return {
          backgroundColor: `color-mix(in srgb, var(--color-secondary) ${
            baseOpacity * 100
          }%, white)`,
          color: "var(--color-secondary)",
        };
      case "success":
        return {
          backgroundColor: `color-mix(in srgb, var(--color-success) ${
            baseOpacity * 100
          }%, white)`,
          color: "var(--color-success)",
        };
      case "warning":
        return {
          backgroundColor: `color-mix(in srgb, var(--color-warning) ${
            baseOpacity * 100
          }%, white)`,
          color: "var(--color-warning)",
        };
      case "danger":
        return {
          backgroundColor: `color-mix(in srgb, var(--color-error) ${
            baseOpacity * 100
          }%, white)`,
          color: "var(--color-error)",
        };
      default:
        return {};
    }
  };

  return (
    <span
      className={`
      inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
      ${variant === "neutral" ? "bg-surface-inset text-foreground" : ""}
      ${className}
    `}
      style={variant !== "neutral" ? getVariantStyles() : {}}
    >
      {children}
    </span>
  );
};
