import React from "react";

/** Props for the loading spinner component. */
export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** Render an animated loading spinner. */
export const Spinner: React.FC<SpinnerProps> = ({
  size = "md",
  className = "",
}) => {
  const sizes = {
    sm: "w-4 h-4 border-2",
    md: "w-8 h-8 border-[3px]",
    lg: "w-12 h-12 border-4",
  };

  return (
    <div
      className={`
      ${sizes[size]}
      border-bordercl border-t-blue-600
      rounded-full animate-spin
      ${className}
    `}
    />
  );
};
