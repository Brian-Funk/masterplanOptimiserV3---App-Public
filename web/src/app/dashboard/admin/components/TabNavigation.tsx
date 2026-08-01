import React from "react";
import type { MainTab } from "../types/tabs";

interface TabNavigationProps {
  mainTab: MainTab;
  setMainTab: (tab: MainTab) => void;
}

export default function TabNavigation({
  mainTab,
  setMainTab,
}: TabNavigationProps) {
  return (
    <div className="bg-surface rounded-lg shadow-sm border border-bordercl mb-3">
      <nav className="flex space-x-8 px-4 border-b border-bordercl">
        <button
          onClick={() => setMainTab("input")}
          className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
            mainTab === "input"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-foreground-muted hover:text-foreground-secondary hover:border-bordercl-strong"
          }`}
        >
          Input
        </button>
        <button
          onClick={() => setMainTab("optimisation")}
          className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
            mainTab === "optimisation"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-foreground-muted hover:text-foreground-secondary hover:border-bordercl-strong"
          }`}
        >
          Optimisation
        </button>
        <button
          onClick={() => setMainTab("masterplan")}
          className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
            mainTab === "masterplan"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-foreground-muted hover:text-foreground-secondary hover:border-bordercl-strong"
          }`}
        >
          Masterplan
        </button>
      </nav>
    </div>
  );
}
