import React, { useState } from "react";
import { X } from "lucide-react";
import { Tooltip } from "@/components/ui";

type CapabilityProps = {
  name: string;
  description?: string;
  onRemove: () => void;
  size?: "sm" | "md" | "lg";
  color?: string;
};

const Capability: React.FC<CapabilityProps> = ({
  name,
  description,
  onRemove,
  size = "sm",
  color = "#3B82F6",
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const sizeClasses = {
    sm: "min-h-7 text-xs py-1",
    md: "min-h-9 text-sm py-1.5",
    lg: "min-h-11 text-base py-2",
  };

  return (
    <Tooltip content={description || `Remove '${name}'`} side="top">
      <button
        className={`relative group px-2 ${sizeClasses[size]} hover:bg-red-500 text-white rounded-md transition-colors duration-200 inline-flex items-center justify-center whitespace-nowrap`}
        onClick={onRemove}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          backgroundColor: isHovered ? undefined : color,
        }}
        aria-label={`Remove '${name}'`}
      >
        <span className={`leading-tight ${isHovered ? "invisible" : ""}`}>
          {name}
        </span>
        {isHovered && <X size={12} className="absolute" />}
      </button>
    </Tooltip>
  );
};

export default Capability;
