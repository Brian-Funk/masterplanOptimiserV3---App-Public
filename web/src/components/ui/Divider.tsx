import React from "react";

/** Render a themed horizontal divider. */
export const Divider: React.FC<{ className?: string }> = ({
  className = "",
}) => {
  return <hr className={`border-bordercl ${className}`} />;
};
