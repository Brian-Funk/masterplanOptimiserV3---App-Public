"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { getApiUrl } from "@/lib/environment";

/** User preference for light, dark, or system colour scheme. */
export type DarkModePreference = "light" | "dark" | "system";

/** Active theme returned by the local theme API. */
export interface Theme {
  id: number;
  name: string;
  is_active: boolean;
  primary_color_1: string;
  primary_color_2: string | null;
  primary_color_3: string | null;
  success_color: string;
  warning_color: string;
  error_color: string;
  info_color: string;
  dark_mode: DarkModePreference;
  created_at: string;
  updated_at: string | null;
}

/** Context value for the active theme and refresh state. */
export interface ThemeContextType {
  theme: Theme | null;
  isLoading: boolean;
  isDark: boolean;
  refreshTheme: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function resolveIsDark(preference: DarkModePreference): boolean {
  if (preference === "dark") return true;
  if (preference === "light") return false;
  // system
  if (typeof window !== "undefined") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return false;
}

function applyDarkClass(isDark: boolean) {
  const root = document.documentElement;
  if (isDark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

/** Load the active app theme and apply CSS variables to the document. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDark, setIsDark] = useState(false);

  const applyThemeToDocument = useCallback((themeData: Theme) => {
    const root = document.documentElement;

    // Apply primary colours
    root.style.setProperty("--color-primary", themeData.primary_color_1);
    if (themeData.primary_color_2) {
      root.style.setProperty("--color-secondary", themeData.primary_color_2);
    }
    if (themeData.primary_color_3) {
      root.style.setProperty("--color-tertiary", themeData.primary_color_3);
    }

    // Apply semantic colours
    root.style.setProperty("--color-success", themeData.success_color);
    root.style.setProperty("--color-warning", themeData.warning_color);
    root.style.setProperty("--color-error", themeData.error_color);
    root.style.setProperty("--color-info", themeData.info_color);

    // Apply dark mode
    const preference = themeData.dark_mode ?? "light";
    const dark = resolveIsDark(preference);
    setIsDark(dark);
    applyDarkClass(dark);
    // Persist for anti-flash script
    try {
      localStorage.setItem("dark-mode", preference);
    } catch {}
  }, []);

  const fetchTheme = async () => {
    try {
      const response = await fetch(`${getApiUrl()}/api/v1/theme/active`);
      if (response.ok) {
        const data = await response.json();
        setTheme(data);
        applyThemeToDocument(data);
      }
    } catch (error) {
      console.error("Failed to fetch theme:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Listen for system colour scheme changes when preference is 'system'
  useEffect(() => {
    if (!theme || theme.dark_mode !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setIsDark(e.matches);
      applyDarkClass(e.matches);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme?.dark_mode]);

  useEffect(() => {
    fetchTheme();
  }, []);

  return (
    <ThemeContext.Provider
      value={{ theme, isLoading, isDark, refreshTheme: fetchTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

/** Access the active theme and dark-mode state. */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
