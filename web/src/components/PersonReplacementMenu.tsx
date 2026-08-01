"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { Search } from "lucide-react";
import { Person } from "@/lib/api";

interface TaskTimeInfo {
  id: number;
  name: string;
  date: string;
  startTime: number; // minutes from midnight
  endTime: number; // minutes from midnight
  assigned_persons: number[];
}

interface PersonReplacementMenuProps {
  x: number;
  y: number;
  taskId: number;
  currentPersonId: number;
  currentPersonName: string;
  allPersons: Person[];
  allTasks?: TaskTimeInfo[];
  onReplace: (taskId: number, oldPersonId: number, newPersonId: number) => void;
  onClose: () => void;
}

const PersonReplacementMenu: React.FC<PersonReplacementMenuProps> = ({
  x,
  y,
  taskId,
  currentPersonId,
  currentPersonName,
  allPersons,
  allTasks = [],
  onReplace,
  onClose,
}) => {
  const [search, setSearch] = useState("");
  const [hoveredPersonId, setHoveredPersonId] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  // Use requestAnimationFrame to defer the close so the browser's native
  // focus assignment to the clicked element completes before the re-render.
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        requestAnimationFrame(() => {
          onClose();
        });
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onClose]);

  const filteredPersons = useMemo(() => {
    return allPersons.filter(
      (p) =>
        p.id !== currentPersonId &&
        `${p.first_name} ${p.last_name}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  }, [allPersons, currentPersonId, search]);

  // Build a map of which persons are occupied (overlapping tasks)
  const occupiedPersonMap = useMemo(() => {
    const map = new Map<number, string>(); // personId -> task name that occupies them
    if (allTasks.length === 0) return map;

    const currentTask = allTasks.find((t) => t.id === taskId);
    if (!currentTask) return map;

    const curStart = currentTask.startTime;
    const curEnd = currentTask.endTime;

    for (const otherTask of allTasks) {
      if (otherTask.id === taskId) continue;
      if (otherTask.date !== currentTask.date) continue;
      // Check time overlap
      if (otherTask.startTime < curEnd && otherTask.endTime > curStart) {
        for (const pid of otherTask.assigned_persons) {
          if (!map.has(pid)) {
            map.set(pid, otherTask.name);
          }
        }
      }
    }
    return map;
  }, [allTasks, taskId]);

  // BroadcastChannel for sending preview-delta to MetricsBoard
  const previewChannelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    try {
      previewChannelRef.current = new BroadcastChannel("metrics-highlight");
    } catch {}
    return () => {
      // Clear preview and close channel on unmount
      try {
        previewChannelRef.current?.postMessage({ action: "clear-preview" });
      } catch {}
      previewChannelRef.current?.close();
    };
  }, []);

  const handlePersonHover = (personId: number) => {
    setHoveredPersonId(personId);
    previewChannelRef.current?.postMessage({
      action: "preview-delta",
      taskId,
      removePersonIds: [currentPersonId],
      addPersonIds: [personId],
    });
  };

  const handlePersonHoverEnd = () => {
    setHoveredPersonId(null);
    previewChannelRef.current?.postMessage({ action: "clear-preview" });
  };

  // Position adjustment to stay in viewport
  const menuStyle: React.CSSProperties = {
    position: "fixed",
    left: Math.min(x, window.innerWidth - 320),
    top: Math.min(y, window.innerHeight - 400),
    zIndex: 9999,
  };

  return (
    <div
      ref={menuRef}
      style={menuStyle}
      className="w-72 bg-surface border border-bordercl rounded-lg shadow-2xl overflow-hidden"
    >
      <div className="px-3 py-2 bg-surface-alt border-b border-bordercl-subtle">
        <div className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">
          Replace {currentPersonName}
        </div>
      </div>
      <div className="p-2 border-b border-bordercl-subtle">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-foreground-faint"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search persons..."
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-bordercl rounded focus:outline-none focus:border-blue-400"
            autoFocus
          />
        </div>
      </div>
      <div className="max-h-48 overflow-y-auto">
        {filteredPersons.length === 0 ? (
          <div className="p-3 text-xs text-foreground-faint text-center">
            No persons available
          </div>
        ) : (
          filteredPersons.map((person) => {
            const occupiedWith = occupiedPersonMap.get(person.id);
            const isOccupied = !!occupiedWith;
            return (
              <button
                key={person.id}
                onClick={() => {
                  if (isOccupied) return;
                  onReplace(taskId, currentPersonId, person.id);
                  onClose();
                }}
                onMouseEnter={() => !isOccupied && handlePersonHover(person.id)}
                onMouseLeave={handlePersonHoverEnd}
                disabled={isOccupied}
                className={`w-full text-left px-3 py-2 text-xs transition-colors border-b border-bordercl-subtle last:border-b-0 ${
                  isOccupied
                    ? "text-foreground-faint cursor-not-allowed bg-surface-alt"
                    : "hover:bg-blue-50 dark:bg-blue-950/30 dark:hover:bg-blue-950/30 cursor-pointer"
                }`}
              >
                <span>
                  {person.first_name} {person.last_name}
                </span>
                {isOccupied && (
                  <span className="ml-1 text-[10px] text-foreground-faint italic">
                    (occupied with {occupiedWith})
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default PersonReplacementMenu;
