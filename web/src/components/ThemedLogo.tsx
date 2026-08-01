"use client";

import { useTheme } from "@/contexts/ThemeContext";
import { BRAND } from "@/lib/brand";

interface ThemedLogoProps {
  width?: number;
  height?: number;
  className?: string;
  href?: string;
}

export default function ThemedLogo({
  width = 120,
  height = 40,
  className = "",
  href,
}: ThemedLogoProps) {
  const { isDark } = useTheme();

  const inner = (
    <div className={`relative inline-block ${className}`} style={{ height }}>
      {/* Gradient layer, masked by mask.svg (white=show, black=hide) */}
      <div
        className="absolute inset-0"
        style={
          {
            background: `linear-gradient(135deg, ${
              BRAND.color1
            } 0%, ${BRAND.color2} 100%)`,
            maskImage: `url(/mask.png)`,
            maskSize: "contain",
            maskRepeat: "no-repeat",
            maskPosition: "center",
            WebkitMaskImage: `url(/mask.png)`,
            WebkitMaskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
          } as React.CSSProperties
        }
      />

      {/* Logo artwork on top - switch between normal and dark variants */}
      <img
        src={isDark ? "/logo_dark.svg" : "/logo_normal.svg"}
        alt="Logo"
        style={{ height }}
        className="relative z-10 h-full w-auto object-contain"
      />
    </div>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  }

  return inner;
}
