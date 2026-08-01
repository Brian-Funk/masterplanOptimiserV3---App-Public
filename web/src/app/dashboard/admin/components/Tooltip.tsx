"use client";

import { useState } from "react";

interface TooltipProps {
  children: React.ReactNode;
  content: string | string[] | React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

export default function Tooltip({
  children,
  content,
  side = "bottom",
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const isStringContent = typeof content === "string" || Array.isArray(content);
  const contentArray = isStringContent
    ? Array.isArray(content)
      ? (content as string[]).filter((line) => line.trim() !== "")
      : [content as string]
    : null;

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div
          className={`absolute z-50 px-3 py-2 text-xs font-medium text-white bg-gray-900 dark:bg-gray-700 rounded-lg shadow-lg w-80 break-words ${
            side === "bottom"
              ? "top-full mt-2 left-1/2 -translate-x-1/2"
              : side === "top"
                ? "bottom-full mb-2 left-1/2 -translate-x-1/2"
                : side === "left"
                  ? "right-full mr-2 top-1/2 -translate-y-1/2"
                  : "left-full ml-2 top-1/2 -translate-y-1/2"
          }`}
        >
          {contentArray
            ? contentArray.map((line, idx) => (
                <div key={idx} className="mb-1 last:mb-0">
                  {line}
                </div>
              ))
            : content}
          <div
            className={`absolute w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45 ${
              side === "bottom"
                ? "bottom-full left-1/2 -translate-x-1/2 translate-y-1"
                : side === "top"
                  ? "top-full left-1/2 -translate-x-1/2 -translate-y-1"
                  : side === "left"
                    ? "left-full top-1/2 -translate-y-1/2 -translate-x-1"
                    : "right-full top-1/2 -translate-y-1/2 translate-x-1"
            }`}
          ></div>
        </div>
      )}
    </div>
  );
}
