import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui";
import { Tooltip } from "@/components/ui";

type CapabilityBadgeProps = {
  name: string;
  description?: string;
  onRemove: () => void;
  size?: "sm" | "md" | "lg";
};

const CapabilityBadge: React.FC<CapabilityBadgeProps> = ({
  name,
  description,
  onRemove,
  size = "sm",
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [buttonWidth, setButtonWidth] = useState(28);
  const textRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (textRef.current) {
      setButtonWidth(textRef.current.offsetWidth + 20); // Add some padding
    }
  }, [name]);

  return (
    <Tooltip content={description || `Remove '${name}'`} side="top">
      <Button
        className={`relative group p-0 transition-all duration-200 ${
          size === "sm" ? "h-7" : size === "md" ? "h-9" : "h-11"
        }`}
        variant="primary"
        onClick={onRemove}
        onMouseOver={() => setIsHovered(true)}
        onMouseOut={() => setIsHovered(false)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ width: `${buttonWidth}px` }}
        aria-label={`Remove '${name}'`}
      >
        {isHovered ? (
          <div className="flex items-center justify-center gap-2">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span className="text-xs">Remove</span>
          </div>
        ) : (
          <p ref={textRef} className="mx-2">
            {name}
          </p>
        )}
      </Button>
    </Tooltip>
  );
};

export default CapabilityBadge;
