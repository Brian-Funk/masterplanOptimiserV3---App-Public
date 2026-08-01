"use client";

import React, { useState, useEffect } from "react";
import { optimizationApi } from "@/lib/optimizationApi";
import { getApiUrl } from "../utils";
import type { OptimizationJob, JobSummary } from "@/types/optimization";
import type { TaskType, Location, Person } from "@/lib/api";
import OptimizationStatusCard from "./optimization/OptimizationStatusCard";
import DaysOverview from "./optimization/DaysOverview";
import Calendar, { CalendarTask } from "@/components/Calendar";
import { SelectedTasksPanel } from "./optimization/SelectedTasksPanel";
import { useTaskInstances } from "@/contexts/TaskInstanceContext";
import { useShortcuts } from "@/contexts/ShortcutContext";
import { isEditableTarget } from "@/lib/shortcuts";
import { formatDateShort } from "@/lib/dateFormat";
import {
  getScheduleDayBoundaryFromRange,
  minutesToClockTime,
} from "@/lib/workingDayBoundary";

interface OptimisationTabProps {
  selectedEvent: any;
}

export default function OptimisationTab({
  selectedEvent,
}: OptimisationTabProps) {
  const { instances: contextInstances } = useTaskInstances();
  const { matchesShortcut } = useShortcuts();
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [currentJob, setCurrentJob] = useState<OptimizationJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [calendarTasks, setCalendarTasks] = useState<CalendarTask[]>([]);

  // Data needed for calendar display
  const [taskInstances, setTaskInstances] = useState<any[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const scheduleDayBoundary = getScheduleDayBoundaryFromRange(
    selectedEvent?.meta_data?.schedule_day_range,
  );

  // Initialize selected date
  useEffect(() => {
    if (selectedEvent?.start_date && !selectedDate) {
      setSelectedDate(selectedEvent.start_date);
    }
  }, [selectedEvent, selectedDate]);

  // Derive task instances from context
  useEffect(() => {
    setTaskInstances(contextInstances);
  }, [contextInstances]);

  // Load task types from API
  useEffect(() => {
    const fetchTaskTypes = async () => {
      try {
        const response = await fetch(`${getApiUrl()}/api/v1/task-types`);
        if (response.ok) {
          const data = await response.json();
          setTaskTypes(data);
        }
      } catch (error) {
        console.error("Error fetching task types:", error);
      }
    };
    fetchTaskTypes();
  }, []);

  // Load locations from API
  useEffect(() => {
    if (!selectedEvent?.id) return;
    const fetchLocations = async () => {
      try {
        const response = await fetch(
          `${getApiUrl()}/api/v1/locations?event_id=${selectedEvent.id}`,
        );
        if (response.ok) {
          const data = await response.json();
          setLocations(data);
        }
      } catch (error) {
        console.error("Error fetching locations:", error);
      }
    };
    fetchLocations();
  }, [selectedEvent?.id]);

  // Load persons from API
  useEffect(() => {
    if (!selectedEvent?.id) return;
    const fetchPersons = async () => {
      try {
        const response = await fetch(
          `${getApiUrl()}/api/v1/persons?event_id=${selectedEvent.id}`,
        );
        if (response.ok) {
          const data = await response.json();
          setPersons(data);
        }
      } catch (error) {
        console.error("Error fetching persons:", error);
      }
    };
    fetchPersons();
  }, [selectedEvent?.id]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      if (matchesShortcut(e, "optimisation.clearSelection")) {
        if (selectedTaskIds.length > 0) {
          e.preventDefault();
          setSelectedTaskIds([]);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [matchesShortcut, selectedTaskIds]);

  // Fetch all jobs for event
  const fetchJobs = async () => {
    if (!selectedEvent) return;

    try {
      const response = await optimizationApi.getJobsForEvent(selectedEvent.id);
      setJobs(response.jobs);
    } catch (error) {
      console.error("Error fetching jobs:", error);
    }
  };

  // Convert optimization result to calendar tasks
  const convertResultToCalendarTasks = (
    job: OptimizationJob,
  ): CalendarTask[] => {
    if (!job.result_data) return [];

    const result = job.result_data;
    const tasks: CalendarTask[] = [];
    const taskDetails = result.task_details || {};
    const formatResultTime = (value: unknown) =>
      typeof value === "number" ? minutesToClockTime(value) : String(value || "");

    // Process regular task assignments - group by task_id
    if (result.assignments) {
      const grouped: Record<string, number[]> = {};
      for (const a of result.assignments) {
        const key = String(a.task_id);
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(a.person_id);
      }

      Object.entries(grouped).forEach(([taskIdStr, personIds]) => {
        const details = taskDetails[taskIdStr];

        if (!details) return; // Skip if no details available

        // For floating task candidates, use original_id if available
        const actualTaskId = details.original_id || parseInt(taskIdStr);

        // Find the task template/type info
        const taskInstance = taskInstances.find(
          (t: any) => t.id === actualTaskId,
        );
        const taskType = taskTypes.find(
          (tt) => tt.id === taskInstance?.task_type_id,
        );

        tasks.push({
          id: parseInt(taskIdStr), // Use the unique candidate ID as the display ID
          name: taskInstance?.name || `Task ${actualTaskId}`,
          task_type_id: taskInstance?.task_type_id || 0,
          task_type_name: taskType?.name || "Unknown",
          task_type_color: taskType?.color || "#6B7280",
          location_id: details.location_id,
          location_name: locations.find((l) => l.id === details.location_id)
            ?.name,
          date: job.date,
          start_end_time: {
            start: formatResultTime(details.start_time),
            end: formatResultTime(details.end_time),
          },
          fields: {
            assigned_persons: personIds
              .map((pid) => {
                const p = persons.find((p) => p.id === pid);
                return p ? `${p.first_name} ${p.last_name}` : `Person ${pid}`;
              })
              .join(", "),
          },
          field_definitions: [],
        });
      });
    }

    // Process transfer assignments
    if (result.transfer_assignments) {
      Object.entries(result.transfer_assignments).forEach(
        ([transferIdStr, personIds]) => {
          const details = taskDetails[transferIdStr];

          if (!details) return; // Skip if no details available

          // Find transfer type (usually has "Transfer" in the name)
          const transferType = taskTypes.find((tt) =>
            tt.name.toLowerCase().includes("transfer"),
          );

          const startLoc = locations.find(
            (l) => l.id === details.start_location_id,
          );
          const endLoc = locations.find(
            (l) => l.id === details.end_location_id,
          );

          // Extract numeric ID from transfer string (e.g., "transfer_123" -> 123)
          // Add a large offset to avoid collision with task IDs
          const transferNumericId = transferIdStr.includes("_")
            ? parseInt(transferIdStr.split("_")[1]) + 1000000
            : parseInt(transferIdStr) + 1000000;

          tasks.push({
            id: transferNumericId,
            name: `Transfer: ${startLoc?.name || "?"} → ${endLoc?.name || "?"}`,
            task_type_id: transferType?.id || 0,
            task_type_name: transferType?.name || "Transfer",
            task_type_color: transferType?.color || "#10B981",
            location_name: `${startLoc?.name || "?"} → ${endLoc?.name || "?"}`,
            date: job.date,
            start_end_time: {
              start: formatResultTime(details.start_time),
              end: formatResultTime(details.end_time),
            },
            fields: {
              assigned_persons: (personIds as number[])
                .map((pid) => {
                  const p = persons.find((p) => p.id === pid);
                  return p ? `${p.first_name} ${p.last_name}` : `Person ${pid}`;
                })
                .join(", "),
            },
            field_definitions: [],
          });
        },
      );
    }

    return tasks;
  };

  // Fetch specific job for selected date
  const fetchCurrentJob = async () => {
    if (!selectedDate) return;

    const job = jobs.find((j) => j.date === selectedDate);
    if (!job) {
      setCurrentJob(null);
      setCalendarTasks([]);
      return;
    }

    setLoading(true);
    try {
      const detailedJob = await optimizationApi.getJobStatus(
        job.id,
        selectedEvent.id,
      );
      setCurrentJob(detailedJob);

      // Convert optimization results to calendar tasks
      const tasks = convertResultToCalendarTasks(detailedJob);
      setCalendarTasks(tasks);
    } catch (error) {
      console.error("Error fetching job:", error);
    } finally {
      setLoading(false);
    }
  };

  // Handle task selection with Shift-click
  const handleTaskShiftClick = (task: CalendarTask) => {
    setSelectedTaskIds((prev) => {
      const newSelection = prev.includes(task.id)
        ? prev.filter((id) => id !== task.id)
        : [...prev, task.id];
      return newSelection;
    });
  };

  // Handle task drag and drop - updates the final field (cosmetic adjustments)
  const handleTaskDrop = (
    task: CalendarTask,
    newTime: string,
    referenceTask?: CalendarTask,
  ) => {
    // Not yet implemented for optimisation results
  };

  // Poll for updates
  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 3000); // Poll every 3s
    return () => clearInterval(interval);
  }, [selectedEvent]);

  useEffect(() => {
    fetchCurrentJob();

    // If current job is running, poll more frequently
    if (currentJob?.status === "running" || currentJob?.status === "pending") {
      const interval = setInterval(fetchCurrentJob, 2000);
      return () => clearInterval(interval);
    }
  }, [selectedDate, jobs]);

  // Navigation
  const handlePreviousDay = () => {
    if (!selectedEvent || selectedDate <= selectedEvent.start_date) return;
    const date = new Date(selectedDate + "T00:00:00");
    date.setDate(date.getDate() - 1);
    setSelectedDate(date.toISOString().split("T")[0]);
  };

  const handleNextDay = () => {
    if (!selectedEvent || selectedDate >= selectedEvent.end_date) return;
    const date = new Date(selectedDate + "T00:00:00");
    date.setDate(date.getDate() + 1);
    setSelectedDate(date.toISOString().split("T")[0]);
  };

  if (!selectedEvent) {
    return (
      <div className="p-6 text-center text-foreground-muted">
        Please select an event to view optimisations.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header with date navigation */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">
          Optimisation Status
        </h3>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePreviousDay}
            disabled={selectedDate <= selectedEvent.start_date}
            className="px-3 py-1 text-sm font-medium text-foreground-secondary bg-surface-inset rounded hover:bg-surface-inset dark:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>
          <span className="px-4 py-1 text-sm font-medium text-foreground bg-surface-alt rounded border border-bordercl">
            {formatDateShort(selectedDate)}
          </span>
          <button
            onClick={handleNextDay}
            disabled={selectedDate >= selectedEvent.end_date}
            className="px-3 py-1 text-sm font-medium text-foreground-secondary bg-surface-inset rounded hover:bg-surface-inset dark:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      </div>

      {/* Status Card */}
      <OptimizationStatusCard job={currentJob} loading={loading} />

      {/* Selected Tasks Panel */}
      {currentJob?.status === "completed" && (
        <SelectedTasksPanel
          selectedCount={selectedTaskIds.length}
          onClear={() => setSelectedTaskIds([])}
        />
      )}

      {/* Calendar view - show optimized schedule */}
      {currentJob?.status === "completed" && calendarTasks.length > 0 && (
        <div className="bg-surface rounded-lg shadow p-4">
          <div className="mb-4">
            <h4 className="text-md font-semibold text-foreground">
              Optimised Schedule
            </h4>
            <p className="text-xs text-foreground-muted mt-1">
              Shift-click to select tasks • Drag to adjust times • Double-click
              to edit details
            </p>
          </div>
          <Calendar
            tasks={calendarTasks}
            viewType="daily"
            selectedDate={selectedDate}
            scheduleDayRange={selectedEvent?.meta_data?.schedule_day_range}
            scheduleDayBoundary={scheduleDayBoundary}
            selectedTaskIds={selectedTaskIds}
            onTaskEdit={(task) => {
              // Not yet implemented
            }}
            onTaskShiftClick={(task) => {
              handleTaskShiftClick(task);
            }}
            onTaskDrop={handleTaskDrop}
          />
        </div>
      )}

      {/* All Days Overview */}
      <DaysOverview
        startDate={selectedEvent.start_date}
        endDate={selectedEvent.end_date}
        jobs={jobs}
        selectedDate={selectedDate}
        onDateSelect={setSelectedDate}
      />
    </div>
  );
}
