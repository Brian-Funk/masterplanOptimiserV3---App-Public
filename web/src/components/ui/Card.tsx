import React from "react";

/** Props for the shared card container. */
export interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

/** Render a themed bordered panel for grouped content. */
export const Card: React.FC<CardProps> = ({
  children,
  className = "",
  hover = false,
}) => {
  return (
    <div
      className={`
      bg-surface rounded-lg border border-bordercl
      ${hover ? "hover:border-bordercl-strong hover:shadow-sm transition-[border-color,box-shadow] duration-150" : ""}
      ${className}
    `}
    >
      {children}
    </div>
  );
};
