import React, { useEffect } from "react";

/** Props for the shared modal shell. */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "4xl";
  className?: string;
}

/** Render an overlay modal that closes on backdrop click or Escape. */
export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  children,
  maxWidth = "lg",
  className = "",
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const maxWidths = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
    "4xl": "max-w-4xl",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`max-h-[calc(100vh-3rem)] w-full overflow-y-auto rounded-xl border border-bordercl bg-surface shadow-xl ${maxWidths[maxWidth]} ${className}`}
      >
        {children}
      </div>
    </div>
  );
};
