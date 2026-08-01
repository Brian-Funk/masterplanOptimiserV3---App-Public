import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { InputSection } from "../types/tabs";

interface InputSidebarProps {
  inputSection: InputSection;
  setInputSection: (section: InputSection) => void;
  tasksExpanded: boolean;
  setTasksExpanded: (expanded: boolean) => void;
}

export default function InputSidebar({
  inputSection,
  setInputSection,
  tasksExpanded,
  setTasksExpanded,
}: InputSidebarProps) {
  return (
    <div className="w-48 bg-surface rounded-lg shadow-sm border border-bordercl p-4 h-fit flex-shrink-0">
      {/* Required Section */}
      <div className="mb-4">
        <h3 className="text-xs font-semibold text-foreground-faint uppercase tracking-wider mb-2">
          Required
        </h3>
        <nav className="space-y-0.5">
          <button
            onClick={() => setInputSection("users")}
            className={`w-full text-left px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              inputSection === "users"
                ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700"
                : "text-foreground-secondary hover:bg-surface-hover"
            }`}
          >
            Users
          </button>
          <button
            onClick={() => setInputSection("locations")}
            className={`w-full text-left px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              inputSection === "locations"
                ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700"
                : "text-foreground-secondary hover:bg-surface-hover"
            }`}
          >
            Locations
          </button>

          {/* Tasks with sub-options */}
          <div>
            <button
              onClick={() => setTasksExpanded(!tasksExpanded)}
              className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                inputSection === "task-builder" ||
                inputSection === "cmi" ||
                inputSection === "dependency-locks"
                  ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700"
                  : "text-foreground-secondary hover:bg-surface-hover"
              }`}
            >
              <span>Tasks</span>
              {tasksExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
            {tasksExpanded && (
              <div className="ml-3 mt-0.5 space-y-0.5">
                <button
                  onClick={() => setInputSection("task-builder")}
                  className={`w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors ${
                    inputSection === "task-builder"
                      ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 font-medium"
                      : "text-foreground-muted hover:bg-surface-hover"
                  }`}
                >
                  Task Builder
                </button>
                <button
                  onClick={() => setInputSection("cmi")}
                  className={`w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors ${
                    inputSection === "cmi"
                      ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 font-medium"
                      : "text-foreground-muted hover:bg-surface-hover"
                  }`}
                >
                  CMI
                </button>
                <button
                  onClick={() => setInputSection("dependency-locks")}
                  className={`w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors ${
                    inputSection === "dependency-locks"
                      ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 font-medium"
                      : "text-foreground-muted hover:bg-surface-hover"
                  }`}
                >
                  Dependency Locks
                </button>
              </div>
            )}
          </div>
        </nav>
      </div>

      {/* Additional Section */}
      <div>
        <h3 className="text-xs font-semibold text-foreground-faint uppercase tracking-wider mb-2">
          Additional
        </h3>
        <nav className="space-y-0.5">
          <button
            onClick={() => setInputSection("groups")}
            className={`w-full text-left px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              inputSection === "groups"
                ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700"
                : "text-foreground-secondary hover:bg-surface-hover"
            }`}
          >
            Groups
          </button>
          <button
            onClick={() => setInputSection("room-allocation")}
            className={`w-full text-left px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              inputSection === "room-allocation"
                ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700"
                : "text-foreground-secondary hover:bg-surface-hover"
            }`}
          >
            Room Allocation
          </button>
        </nav>
      </div>
    </div>
  );
}
