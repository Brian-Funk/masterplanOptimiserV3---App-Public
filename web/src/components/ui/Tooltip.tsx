"use client";

import { useState, useRef, useEffect } from "react";

/** Props for the hover tooltip wrapper. */
export interface TooltipProps {
  children: React.ReactNode;
  content?: string | null;
  side?: "top" | "bottom" | "left" | "right";
}

/** Render children with an optional delayed hover tooltip. */
export function Tooltip({ children, content, side = "top" }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    timeoutRef.current = setTimeout(() => setIsVisible(true), 150);
  };

  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!content) return <>{children}</>;

  const positionClasses =
    side === "top"
      ? "bottom-full mb-2 left-1/2 -translate-x-1/2"
      : side === "bottom"
        ? "top-full mt-2 left-1/2 -translate-x-1/2"
        : side === "left"
          ? "right-full mr-2 top-1/2 -translate-y-1/2"
          : "left-full ml-2 top-1/2 -translate-y-1/2";

  const arrowClasses =
    side === "top"
      ? "top-full left-1/2 -translate-x-1/2 -translate-y-1"
      : side === "bottom"
        ? "bottom-full left-1/2 -translate-x-1/2 translate-y-1"
        : side === "left"
          ? "left-full top-1/2 -translate-y-1/2 -translate-x-1"
          : "right-full top-1/2 -translate-y-1/2 translate-x-1";

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {isVisible && (
        <div
          className={`absolute z-50 px-2.5 py-1.5 text-xs font-medium text-white bg-gray-900 dark:bg-gray-700 rounded-lg shadow-lg whitespace-nowrap pointer-events-none ${positionClasses}`}
        >
          {content}
          <div
            className={`absolute w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45 ${arrowClasses}`}
          />
        </div>
      )}
    </div>
  );
}
