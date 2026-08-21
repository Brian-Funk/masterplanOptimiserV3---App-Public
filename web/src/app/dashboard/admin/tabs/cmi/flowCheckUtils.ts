import { capabilitiesApi, flowApi, Capability } from "@/lib/api";
import {
  normaliseScheduleDayBoundary,
  type ScheduleDayBoundary,
} from "@/lib/workingDayBoundary";
import type { FeasibilityDiagnostics } from "@/types/optimization";
import { prepareSolverTasksForWorkingDay } from "./solverTaskPreparation";

interface Person {
  id: number;
  first_name: string;
  last_name: string;
  capabilities?: string[];
  unavailabilities?: Array<{ starts_at: string; ends_at: string }>;
}

interface Location {
  id: number;
  name: string;
}

interface Template {
  id: number;
  name: string;
  is_floating?: boolean;
  is_transfer?: boolean;
  fields?: Array<{
    id: number;
    type: string;
    name: string;
  }>;
}

interface TaskTypePolicy {
  id: number;
  counts_towards_work_time?: boolean;
}

interface FlowCheckParams {
  selectedEvent: { id: number };
  selectedDate: string;
  templates: Template[];
  taskTypes?: TaskTypePolicy[];
  persons: Person[];
  locations: Location[];
  taskInstances: any[]; // from TaskInstanceContext
  scheduleDayBoundary?: Partial<ScheduleDayBoundary> | null;
  silent?: boolean;
  signal?: AbortSignal;
  skipFloating?: boolean; // When true, exclude floating tasks for faster auto-checks
  ignoredTaskIds?: ReadonlySet<number>;
}

export interface FlowCheckResult {
  status: "checking" | "valid" | "invalid" | "empty";
  errors: string[];
  infeasibleTaskIds: Set<number>;
  infeasibleTaskErrors: Map<number, string[]>;
  diagnostics: FeasibilityDiagnostics | null;
  emptyMessage?: string;
}

/** Build and submit a flow check while preserving task-type work policies. */
export async function performFlowCheck(
  params: FlowCheckParams,
): Promise<FlowCheckResult> {
  const {
    selectedEvent,
    selectedDate,
    templates,
    taskTypes = [],
    persons,
    locations,
    taskInstances,
    scheduleDayBoundary,
    silent = false,
    signal,
    skipFloating = false,
    ignoredTaskIds = new Set<number>(),
  } = params;

  try {
    const boundary = normaliseScheduleDayBoundary(scheduleDayBoundary);
    const prepared = prepareSolverTasksForWorkingDay({
      eventId: selectedEvent.id,
      selectedDate,
      templates,
      taskTypes,
      taskInstances,
      ignoredTaskIds,
      scheduleDayBoundary: boundary,
      skipFloating,
    });
    if (prepared.allTaskInstances.length === 0) {
      return {
        status: "empty",
        errors: [],
        infeasibleTaskIds: new Set(),
        infeasibleTaskErrors: new Map(),
        diagnostics: null,
        emptyMessage: "Nothing to check because this day has no tasks.",
      };
    }
    if (prepared.activeTaskInstances.length === 0) {
      return {
        status: "empty",
        errors: [],
        infeasibleTaskIds: new Set(),
        infeasibleTaskErrors: new Map(),
        diagnostics: null,
        emptyMessage: "Nothing to check — all tasks are ignored.",
      };
    }
    if (prepared.solverTasks.length === 0) {
      return {
        status: "empty",
        errors: [],
        infeasibleTaskIds: new Set(),
        infeasibleTaskErrors: new Map(),
        diagnostics: null,
        emptyMessage: skipFloating
          ? "No fixed tasks are available for this quick check."
          : "No tasks with valid locations are available to check.",
      };
    }

    // Fetch capabilities from API
    const capabilities = await capabilitiesApi.getAll(selectedEvent.id);

    // Sanitize persons: only send fields the backend Pydantic model expects
    const sanitizedPersons = persons.map((p: any) => ({
      id: typeof p.id === "number" ? Math.floor(p.id) : parseInt(p.id) || 0,
      first_name: p.first_name || null,
      last_name: p.last_name || null,
      email: p.email || null,
      home_location_id:
        p.home_location_id != null ? Number(p.home_location_id) : null,
      max_hours_per_day: p.max_hours_per_day ?? null,
      capabilities: p.capabilities || [],
      unavailabilities: p.unavailabilities || [],
    }));

    // Sanitize locations: only send fields the backend model expects
    const sanitizedLocations = locations
      .filter((loc: any) => loc.id != null && loc.name)
      .map((loc: any) => ({
        id: typeof loc.id === "number" ? loc.id : parseInt(loc.id) || 0,
        name: loc.name || "Unknown",
      }));

    // Sanitize capabilities: ensure required fields present
    const sanitizedCapabilities = capabilities
      .filter(
        (cap: Capability) => cap.id != null && cap.machine_name && cap.name,
      )
      .map((cap: Capability) => ({
        id: cap.id,
        machine_name: cap.machine_name,
        name: cap.name,
      }));

    // Prepare data for flow check
    const flowCheckData = {
      event_id: selectedEvent.id,
      tasks: prepared.solverTasks,
      persons: sanitizedPersons,
      locations: sanitizedLocations,
      capabilities: sanitizedCapabilities,
      working_day_date: selectedDate,
      working_day_boundary_offset_hour: boundary.offsetHour,
    };

    const result = await flowApi.check(flowCheckData, signal, skipFloating);

    if (result.feasible) {
      return {
        status: "valid",
        errors: [],
        infeasibleTaskIds: new Set(),
        infeasibleTaskErrors: new Map(),
        diagnostics: result.diagnostics,
      };
    } else {
      // Fetch capabilities to get human-readable names
      const capabilitiesData = await capabilitiesApi.getAll(selectedEvent.id);

      // Build person lookup: id -> "First Last"
      const personNameById = new Map<number, string>();
      for (const p of persons) {
        const name =
          [p.first_name, p.last_name].filter(Boolean).join(" ") ||
          `Person ${p.id}`;
        personNameById.set(p.id, name);
      }

      // Build location lookup: id -> name
      const locationNameById = new Map<number, string>();
      for (const loc of locations) {
        locationNameById.set(loc.id, loc.name);
      }

      const formatError = (error: string): string => {
        let formattedError = error;

        // Replace ALL location IDs with location names (both "Location 3" and "location 3")
        formattedError = formattedError.replace(
          /\b[Ll]ocation\s+(\d+)/g,
          (_match, idStr) => {
            const id = parseInt(idStr);
            return locationNameById.get(id) || `Location ${id}`;
          },
        );

        // Replace "persons [5, 14]" or "persons [5]" with person names
        formattedError = formattedError.replace(
          /persons\s*\[([^\]]+)\]/g,
          (_match, idsStr) => {
            const ids = idsStr
              .split(",")
              .map((s: string) => parseInt(s.trim()))
              .filter((n: number) => !isNaN(n));
            const names = ids.map(
              (id: number) => personNameById.get(id) || `Person ${id}`,
            );
            return names.join(", ");
          },
        );

        // Replace "person ID 5" with person name
        formattedError = formattedError.replace(
          /person\s+ID\s+(\d+)/gi,
          (_match, idStr) => {
            const id = parseInt(idStr);
            return personNameById.get(id) || `Person ${id}`;
          },
        );

        // Replace "Preassigned person 5" or "person 5" with person name
        formattedError = formattedError.replace(
          /(?:Preassigned\s+)?person\s+(\d+)/gi,
          (_match, idStr) => {
            const id = parseInt(idStr);
            return personNameById.get(id) || `Person ${id}`;
          },
        );

        // Replace capability machine names with human-readable names
        capabilitiesData.forEach((cap: Capability) => {
          const escapedMachineName = cap.machine_name.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
          );
          formattedError = formattedError
            .replace(new RegExp(`['\"]${escapedMachineName}['\"]`, "g"), cap.name)
            .replace(
              new RegExp(`\\b${escapedMachineName}\\b`, "g"),
              cap.name,
            );
        });

        // Remove remaining single quotes around capability names
        formattedError = formattedError.replace(/'([^']+)'/g, "$1");

        // Remove ID: prefix
        formattedError = formattedError.replace(/\(ID:\s*\d+\)/g, "");
        formattedError = formattedError.replace(/ID:\s*\d+/g, "");

        // Clean up extra whitespace and parentheses
        formattedError = formattedError
          .replace(/\s+/g, " ")
          .replace(/\(\s*\)/g, "")
          .replace(/\s+:/g, ":")
          .replace(/:\s+/g, ": ")
          .trim();

        return formattedError;
      };

      // Format errors to be human-readable
      const humanReadableErrors = result.errors.map(formatError);
      const humanReadableDiagnostics = result.diagnostics
        ? {
            ...result.diagnostics,
            issues: result.diagnostics.issues.map((issue) => ({
              ...issue,
              message: formatError(issue.message),
              facts: issue.facts.map((fact) => ({
                ...fact,
                value: formatError(fact.value),
              })),
              suggestions: issue.suggestions.map(formatError),
            })),
          }
        : null;

      // Use structured task provenance. Keep the legacy message scan only for
      // compatibility with an older server during a rolling upgrade.
      const failedTaskIds = new Set<number>();
      const taskErrorMap = new Map<number, string[]>();
      humanReadableDiagnostics?.issues.forEach((issue) => {
        for (const taskId of issue.task_ids) {
          failedTaskIds.add(taskId);
          if (!taskErrorMap.has(taskId)) {
            taskErrorMap.set(taskId, []);
          }
          taskErrorMap.get(taskId)!.push(issue.message);
        }
      });
      if (failedTaskIds.size === 0) {
        result.errors.forEach((error: string, idx: number) => {
          const matches = error.matchAll(/ID:\s*(\d+)/g);
          for (const match of matches) {
            const taskId = parseInt(match[1]);
            failedTaskIds.add(taskId);
            if (!taskErrorMap.has(taskId)) taskErrorMap.set(taskId, []);
            taskErrorMap.get(taskId)!.push(humanReadableErrors[idx]);
          }
        });
      }

      return {
        status: "invalid",
        errors: humanReadableErrors,
        infeasibleTaskIds: failedTaskIds,
        infeasibleTaskErrors: taskErrorMap,
        diagnostics: humanReadableDiagnostics,
      };
    }
  } catch (error: any) {
    // Re-throw abort errors so the caller can handle them
    if (error?.name === "AbortError") throw error;

    console.error("Flow check error:", error);
    if (!silent) {
      console.error("Error details:", error.message, error.response);
      alert(`${error.message || error}`);
    }
    return {
      status: "invalid",
      errors: [error.message || "Unknown error"],
      infeasibleTaskIds: new Set(),
      infeasibleTaskErrors: new Map(),
      diagnostics: null,
    };
  }
}
