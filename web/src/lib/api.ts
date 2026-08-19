/**
 * API Client for Backend Communication
 * Desktop-only GC variant - no authentication needed
 */

import { getApiUrl } from "@/lib/environment";
import type {
  PublishDestination,
  PublishTarget,
} from "@/lib/publishTargets";
export type { PublishDestination, PublishTarget } from "@/lib/publishTargets";

const API_BASE = getApiUrl();

import type {
  FinalizeRequest,
  FinalizeResponse,
  MasterplanLayout,
  MasterplanLayoutUpdate,
  PersonSwapRequest,
  BackendTask,
  EventStatus,
} from "@/types/masterplan";

/**
 * Thin fetch wrapper - no auth headers needed in the GC desktop app.
 */
async function apiFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(url, options);
}

const MAX_API_ERROR_MESSAGE_LENGTH = 1000;

function boundedApiMessage(value: string): string {
  return value.trim().slice(0, MAX_API_ERROR_MESSAGE_LENGTH);
}

/** Convert FastAPI error bodies into a bounded, human-readable message. */
export function formatApiErrorMessage(
  payload: unknown,
  fallback: string,
): string {
  const body =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  const detail = body?.detail;

  if (typeof detail === "string" && detail.trim()) {
    return boundedApiMessage(detail);
  }
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const message = (detail as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) {
      return boundedApiMessage(message);
    }
  }
  if (Array.isArray(detail)) {
    const messages = detail.slice(0, 10).flatMap((issue) => {
      if (!issue || typeof issue !== "object") return [];
      const record = issue as Record<string, unknown>;
      if (typeof record.msg !== "string" || !record.msg.trim()) return [];
      const location = Array.isArray(record.loc)
        ? record.loc
            .filter((part) => ["string", "number"].includes(typeof part))
            .map(String)
            .join(".")
        : "";
      return [`${location ? `${location}: ` : ""}${record.msg}`];
    });
    if (messages.length > 0) {
      return boundedApiMessage(messages.join("; "));
    }
  }
  if (typeof body?.message === "string" && body.message.trim()) {
    return boundedApiMessage(body.message);
  }
  return boundedApiMessage(fallback) || "The request failed.";
}

function apiStatusFallback(response: Response, action: string): string {
  const status = response.status ? `HTTP ${response.status}` : "request failed";
  const statusText = response.statusText?.trim();
  return `${action} (${status}${statusText ? ` ${statusText}` : ""})`;
}

/** HTTP failure with the bounded Server code needed for recoverable UI flows. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

/** Stable notification copy for a publish blocked by the legal policy gate. */
export function dataPolicyAcknowledgementGuidance(
  policyAvailable: boolean,
): string {
  return policyAvailable
    ? "Publication blocked: permitted-data policy not acknowledged. In this Publish preview, review the exact policy and click ‘I reviewed necessity and permitted audiences’, then publish again."
    : "Publication blocked: permitted-data policy acknowledgement is required, but the current policy could not be loaded. Retry the policy check before publishing.";
}

function apiRequestError(
  payload: unknown,
  response: Response,
  action: string,
): ApiRequestError {
  const body =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  const detail =
    body?.detail && typeof body.detail === "object" && !Array.isArray(body.detail)
      ? (body.detail as Record<string, unknown>)
      : null;
  const code = typeof detail?.code === "string" ? detail.code.slice(0, 100) : null;
  return new ApiRequestError(
    formatApiErrorMessage(payload, apiStatusFallback(response, action)),
    response.status,
    code,
  );
}

export interface Event {
  id: number;
  name: string;
  location: string;
  start_date?: string;
  end_date?: string;
  google_calendar_id?: string | null;
  mp_backend_url?: string | null;
  meta_data?: {
    day_aliases?: Record<string, string>;
    schedule_day_range?: {
      startHour: number;
      endHour: number;
    };
    pdf_export_title?: string;
    [key: string]: any;
  };
}

/** Structured issue produced by import preview validation. */
export interface ImportValidationIssue {
  id: string;
  severity: "error" | "warning" | "info";
  title: string;
  message: string;
  path?: string | null;
}

/** Import preview counts and metadata shown before applying imported data. */
export interface ImportPreviewSummary {
  projectName?: string | null;
  eventName?: string | null;
  dateRange?: string | null;
  sourceVersion?: string | null;
  exportedAt?: string | null;
  peopleCount: number;
  locationCount: number;
  groupCount: number;
  taskCount: number;
  templateCount: number;
  taskTypeCount: number;
  assignmentCount: number;
  hasOptimisedSchedule: boolean;
  hasFinalSchedule: boolean;
  hasPublishMetadata: boolean;
  hasAppSettings: boolean;
  importType: string;
}

/** Import validation response used by the safe preview flow. */
export interface ImportValidationResult {
  isValid: boolean;
  errors: ImportValidationIssue[];
  warnings: ImportValidationIssue[];
  info: ImportValidationIssue[];
  summary: ImportPreviewSummary;
}

export interface Person {
  id: number;
  evidence_subject_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  google_email?: string | null;
  home_location_id?: number | null;
  max_hours_per_day?: number | null;
  capabilities: string[];
  unavailabilities: Array<{ starts_at: string; ends_at: string }>;
}

// Task Capability relationship
export interface TaskCapability {
  id: number;
  task_id: number;
  capability_id: number;
  quantity: number;
}

// Task Person relationship
export interface TaskPerson {
  id: number;
  task_id: number;
  person_id: number;
}

// Task instance interface (with hardcoded fields + template inheritance)
export interface Task {
  id: number;
  event_id: number;
  task_template_id: number;
  task_type_id: number;

  // Basic info
  title: string;
  description?: string | null;

  // Task classification
  is_floating: boolean;
  is_transfer: boolean;

  // HARDCODED OPTIMIZATION FIELDS (can override template values)
  location_id?: number | null;
  start_location_id?: number | null;
  end_location_id?: number | null;
  task_start_time?: string | null; // HH:MM format
  task_end_time?: string | null; // HH:MM format
  time_range_start?: string | null;
  time_range_end?: string | null;
  task_duration_minutes?: number | null;
  dynamic_allocation_limit?: number | null;

  // RELATIONSHIPS
  task_capabilities?: TaskCapability[];
  task_persons?: TaskPerson[];

  // CUSTOM FIELDS (instance values)
  custom_fields: CustomField[];

  // Optimisation results
  optimized_start_time?: string | null;
  optimized_end_time?: string | null;
  assigned_person_id?: number | null;

  // Legacy fields (preserved)
  field_values?: any;
  start_time?: string; // Legacy DATETIME field
  end_time?: string; // Legacy DATETIME field

  // 4-field task model (JSON blobs)
  constraints: Record<string, any>;
  optimised: Record<string, any>;
  final: Record<string, any>;
  additional: Record<string, any>;

  // Metadata
  created_at?: string;
  updated_at?: string;
}

// Task Create payload
export interface TaskCreatePayload {
  event_id: number;
  task_template_id: number;
  title: string;
  description?: string | null;

  // Override template values (optional)
  location_id?: number | null;
  start_location_id?: number | null;
  end_location_id?: number | null;
  task_start_time?: string | null;
  task_end_time?: string | null;
  time_range_start?: string | null;
  time_range_end?: string | null;
  task_duration_minutes?: number | null;
  dynamic_allocation_limit?: number | null;

  // Override relationships (optional)
  capability_ids?: number[];
  person_ids?: number[];

  // Override custom field values (optional)
  custom_fields?: CustomField[];
}

// Task Update payload
export interface TaskUpdatePayload {
  title?: string;
  description?: string | null;
  location_id?: number | null;
  start_location_id?: number | null;
  end_location_id?: number | null;
  task_start_time?: string | null;
  task_end_time?: string | null;
  time_range_start?: string | null;
  time_range_end?: string | null;
  task_duration_minutes?: number | null;
  dynamic_allocation_limit?: number | null;
  capability_ids?: number[];
  person_ids?: number[];
  custom_fields?: CustomField[];
}

// Events API
/** Client wrapper for event records and event-scoped capability settings. */
export const eventsApi = {
  /** Fetch all events known to the local backend. */
  getAll: async (): Promise<Event[]> => {
    const response = await apiFetch(`${API_BASE}/api/v1/events`);
    return response.json();
  },

  /** Fetch one event by id. */
  getById: async (id: number): Promise<Event> => {
    const response = await apiFetch(`${API_BASE}/api/v1/events/${id}`);
    return response.json();
  },

  /** Create a new event. */
  create: async (data: Partial<Event>): Promise<Event> => {
    const response = await apiFetch(`${API_BASE}/api/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return response.json();
  },

  /** Replace core fields for an existing event. */
  update: async (id: number, data: Partial<Event>): Promise<Event> => {
    const response = await apiFetch(`${API_BASE}/api/v1/events/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok)
      throw new Error(`Failed to update event: ${response.statusText}`);
    return response.json();
  },

  /** Delete an event and its scoped data. */
  delete: async (id: number): Promise<void> => {
    const response = await apiFetch(`${API_BASE}/api/v1/events/${id}`, {
      method: "DELETE",
    });
    if (!response.ok)
      throw new Error(`Failed to delete event: ${response.statusText}`);
  },

  /** Update the set of capabilities enabled for one event. */
  updateCapabilities: async (
    eventId: number,
    enabledCapabilityIds: number[] | null,
  ): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/events/${eventId}/capabilities`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled_capability_ids: enabledCapabilityIds }),
      },
    );
    if (!response.ok)
      throw new Error(
        `Failed to update event capabilities: ${response.statusText}`,
      );
  },

  /** Read the event-specific title used for local PDF schedule exports. */
  getPdfExportSettings: async (
    eventId: number,
  ): Promise<{ title: string; customised: boolean }> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/events/${eventId}/pdf-export-settings`,
    );
    if (!response.ok)
      throw new Error(`Failed to fetch PDF settings: ${response.statusText}`);
    return response.json();
  },

  /** Save the event-specific PDF title without replacing other event metadata. */
  setPdfExportSettings: async (
    eventId: number,
    title: string,
  ): Promise<{ title: string; customised: boolean }> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/events/${eventId}/pdf-export-settings`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      },
    );
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.detail || "Failed to save PDF settings");
    }
    return response.json();
  },
};

// Persons API
/** Client wrapper for event-scoped people. */
export const personsApi = {
  /** Fetch all people for an event. */
  getAll: async (eventId: number): Promise<Person[]> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/persons?event_id=${eventId}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch persons: ${response.statusText}`);
    }
    return response.json();
  },
  /** Update one person. */
  update: async (
    personId: number,
    eventId: number,
    data: Partial<Omit<Person, "id">>,
  ): Promise<Person> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/persons/${personId}?event_id=${eventId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to update person: ${response.statusText}`);
    }
    return response.json();
  },
};

// Tasks API
/** Client wrapper for legacy task records and finalisation actions. */
export const tasksApi = {
  /** Fetch legacy task records for an event. */
  getAll: async (eventId: number): Promise<Task[]> => {
    const url = `${API_BASE}/api/v1/tasks?event_id=${eventId}`;
    const response = await apiFetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch tasks: ${response.statusText}`);
    }
    return response.json();
  },

  /** Fetch one task by id within an event. */
  getById: async (id: number, eventId: number): Promise<Task> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/tasks/${id}?event_id=${eventId}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch task: ${response.statusText}`);
    }
    return response.json();
  },

  /** Create one legacy task record. */
  create: async (data: TaskCreatePayload): Promise<Task> => {
    const response = await apiFetch(`${API_BASE}/api/v1/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(
        `Failed to create task: ${error.detail || response.statusText}`,
      );
    }
    return response.json();
  },

  /** Update one legacy task record. */
  update: async (
    id: number,
    eventId: number,
    data: TaskUpdatePayload,
  ): Promise<Task> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/tasks/${id}?event_id=${eventId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(
        `Failed to update task: ${error.detail || response.statusText}`,
      );
    }
    return response.json();
  },

  /** Delete one legacy task record. */
  delete: async (id: number, eventId: number): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/tasks/${id}?event_id=${eventId}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(
        `Failed to delete task: ${error.detail || response.statusText}`,
      );
    }
  },

  /** Replace a person assignment on a legacy task. */
  swapPerson: async (
    taskId: number,
    eventId: number,
    data: PersonSwapRequest,
  ): Promise<{ status: string; message: string }> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/tasks/${taskId}/swap-person?event_id=${eventId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok)
      throw new Error(`Failed to swap person: ${response.statusText}`);
    return response.json();
  },

  /** Finalise the current schedule for an event. */
  finalize: async (data: FinalizeRequest): Promise<FinalizeResponse> => {
    const response = await apiFetch(`${API_BASE}/api/v1/tasks/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      const detail = error.detail;
      const message = Array.isArray(detail)
        ? detail
            .map((e: any) => `${(e.loc || []).join(".")}: ${e.msg}`)
            .join("; ")
        : typeof detail === "string"
          ? detail
          : JSON.stringify(detail);
      throw new Error(`Failed to finalise: ${message || response.statusText}`);
    }
    return response.json();
  },
};

// Location interface
export interface Location {
  id: number;
  event_id: number;
  name: string;
  address?: string | null;
  details?: Record<string, any> | null;
  created_at?: string;
  updated_at?: string;
}

// Locations API
/** Client wrapper for event-scoped locations. */
export const locationsApi = {
  /** Fetch all locations for an event. */
  getAll: async (eventId: number): Promise<Location[]> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/locations?event_id=${eventId}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch locations: ${response.statusText}`);
    }
    return response.json();
  },

  /** Fetch one location by id within an event. */
  getById: async (id: number, eventId: number): Promise<Location> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/locations/${id}?event_id=${eventId}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch location: ${response.statusText}`);
    }
    return response.json();
  },

  /** Create a location for an event. */
  create: async (
    eventId: number,
    data: {
      name: string;
      address?: string;
      details?: Record<string, any>;
    },
  ): Promise<Location> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/locations?event_id=${eventId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to create location: ${response.statusText}`);
    }
    return response.json();
  },

  /** Update a location for an event. */
  update: async (
    eventId: number,
    id: number,
    data: {
      name?: string;
      address?: string;
      details?: Record<string, any>;
    },
  ): Promise<Location> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/locations/${id}?event_id=${eventId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to update location: ${response.statusText}`);
    }
    return response.json();
  },

  /** Delete a location from an event. */
  delete: async (eventId: number, id: number): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/locations/${id}?event_id=${eventId}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      throw new Error(`Failed to delete location: ${response.statusText}`);
    }
  },
};

// Group interface
/** A direct group member, either a person or another included group. */
export interface GroupMember {
  type: "person" | "group";
  id: number;
}

export interface Group {
  id: number;
  event_id: number;
  name: string;
  group_type_id?: number;
  attributes: Record<string, string>;
  members: GroupMember[];
  created_at?: string;
  updated_at?: string;
}

// Groups API
/** Client wrapper for event-scoped groups and memberships. */
export const groupsApi = {
  /** Fetch all groups for an event. */
  getAll: async (eventId: number): Promise<Group[]> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/groups?event_id=${eventId}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch groups: ${response.statusText}`);
    }
    return response.json();
  },

  /** Fetch one group by id within an event. */
  getById: async (id: number, eventId: number): Promise<Group> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/groups/${id}?event_id=${eventId}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch group: ${response.statusText}`);
    }
    return response.json();
  },

  /** Create a group for an event. */
  create: async (
    eventId: number,
    data: {
      name: string;
      group_type_id?: number;
      attributes?: Record<string, string>;
      members?: GroupMember[];
    },
  ): Promise<Group> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/groups?event_id=${eventId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to create group: ${response.statusText}`);
    }
    return response.json();
  },

  /** Update a group for an event. */
  update: async (
    eventId: number,
    id: number,
    data: {
      name?: string;
      group_type_id?: number;
      attributes?: Record<string, string>;
      members?: GroupMember[];
    },
  ): Promise<Group> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/groups/${id}?event_id=${eventId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to update group: ${response.statusText}`);
    }
    return response.json();
  },

  /** Delete a group from an event. */
  delete: async (eventId: number, id: number): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/groups/${id}?event_id=${eventId}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      throw new Error(`Failed to delete group: ${response.statusText}`);
    }
  },
};

export interface AudienceCategory {
  id: number;
  event_id: number;
  name: string;
  sort_order?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AudienceTeam {
  id: number;
  event_id: number;
  category_id?: number | null;
  name: string;
  short_name?: string | null;
  description?: string | null;
  colour?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Public schedule view that controls where Session Elements are published. */
export interface ScheduleView {
  id: number;
  event_id: number;
  name: string;
  sort_order?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SessionElementType {
  id: number;
  event_id: number;
  name: string;
  description?: string | null;
  colour?: string | null;
  sort_order?: number | null;
  copy_template_html?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SessionElement {
  id: number;
  event_id: number;
  session_element_type_id?: number | null;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  location_id?: number | null;
  responsible_person_id?: number | null;
  responsible_text?: string | null;
  location_text?: string | null;
  location_note?: string | null;
  attendee_team_ids: number[];
  schedule_view_ids: number[];
  visibility: "public" | "internal";
  description?: string | null;
  category?: string | null;
  colour?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Add, remove, or replace one ID-backed assignment in a bulk schedule edit. */
export interface BulkScheduleAssignmentChange {
  operation: "add" | "remove" | "replace";
  ids: number[];
}

/** Changes that can be applied atomically to selected public schedule items. */
export interface BulkSessionElementChanges {
  session_element_type_id?: number;
  location_id?: number | null;
  working_date?: string;
  shift_minutes?: number;
  schedule_view_change?: BulkScheduleAssignmentChange;
  attendee_team_change?: BulkScheduleAssignmentChange;
  /** Backwards-compatible replacement form. */
  schedule_view_ids?: number[];
  /** Backwards-compatible replacement form. */
  attendee_team_ids?: number[];
}

export interface GeneralSchedulePublishState {
  event_id: number;
  fingerprint?: string | null;
  published_at?: string | null;
  publish_failed_at?: string | null;
  item_count: number;
  last_error?: string | null;
  day_records: Record<string, GeneralScheduleDayPublishRecord>;
}

/** Publish confidence metadata retained for one General Schedule working day. */
export interface GeneralScheduleDayPublishRecord {
  fingerprint?: string | null;
  published_at?: string | null;
  publish_failed_at?: string | null;
  failure_message?: string | null;
  item_count: number;
}

export const generalScheduleApi = {
  getCategories: async (eventId: number): Promise<AudienceCategory[]> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/categories?event_id=${eventId}`,
    );
    if (!response.ok) throw new Error("Failed to fetch Audience Categories");
    return response.json();
  },
  createCategory: async (
    eventId: number,
    data: Partial<AudienceCategory> & { name: string },
  ): Promise<AudienceCategory> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/categories?event_id=${eventId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) throw new Error("Failed to create Audience Category");
    return response.json();
  },
  updateCategory: async (
    eventId: number,
    id: number,
    data: Partial<AudienceCategory>,
  ): Promise<AudienceCategory> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/categories/${id}?event_id=${eventId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) throw new Error("Failed to update Audience Category");
    return response.json();
  },
  deleteCategory: async (eventId: number, id: number): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/categories/${id}?event_id=${eventId}`,
      { method: "DELETE" },
    );
    if (!response.ok) throw new Error("Failed to delete Audience Category");
  },
  getSessionElementTypes: async (
    eventId: number,
  ): Promise<SessionElementType[]> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/session-element-types?event_id=${eventId}`,
    );
    if (!response.ok) throw new Error("Failed to fetch Session Element Types");
    return response.json();
  },
  createSessionElementType: async (
    eventId: number,
    data: Partial<SessionElementType> & { name: string },
  ): Promise<SessionElementType> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/session-element-types?event_id=${eventId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) throw new Error("Failed to create Session Element Type");
    return response.json();
  },
  updateSessionElementType: async (
    eventId: number,
    id: number,
    data: Partial<SessionElementType>,
  ): Promise<SessionElementType> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/session-element-types/${id}?event_id=${eventId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) throw new Error("Failed to update Session Element Type");
    return response.json();
  },
  deleteSessionElementType: async (eventId: number, id: number): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/session-element-types/${id}?event_id=${eventId}`,
      { method: "DELETE" },
    );
    if (!response.ok) throw new Error("Failed to delete Session Element Type");
  },
  getTeams: async (eventId: number): Promise<AudienceTeam[]> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/teams?event_id=${eventId}`,
    );
    if (!response.ok) throw new Error("Failed to fetch Audience Teams");
    return response.json();
  },
  createTeam: async (
    eventId: number,
    data: Partial<AudienceTeam> & { name: string },
  ): Promise<AudienceTeam> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/teams?event_id=${eventId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) throw new Error("Failed to create Audience Team");
    return response.json();
  },
  updateTeam: async (
    eventId: number,
    id: number,
    data: Partial<AudienceTeam>,
  ): Promise<AudienceTeam> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/teams/${id}?event_id=${eventId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) throw new Error("Failed to update Audience Team");
    return response.json();
  },
  deleteTeam: async (eventId: number, id: number): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/teams/${id}?event_id=${eventId}`,
      { method: "DELETE" },
    );
    if (!response.ok) throw new Error("Failed to delete Audience Team");
  },
  reorderTeams: async (
    eventId: number,
    items: Array<{ id: number; sort_order: number }>,
  ): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/teams/reorder?event_id=${eventId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      },
    );
    if (!response.ok) throw new Error("Failed to reorder Audience Teams");
  },
  getScheduleViews: async (eventId: number): Promise<ScheduleView[]> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/schedule-views?event_id=${eventId}`,
    );
    if (!response.ok) throw new Error("Failed to fetch Schedule Views");
    return response.json();
  },
  createScheduleView: async (
    eventId: number,
    data: Partial<ScheduleView> & { name: string },
  ): Promise<ScheduleView> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/schedule-views?event_id=${eventId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) throw new Error("Failed to create Schedule View");
    return response.json();
  },
  updateScheduleView: async (
    eventId: number,
    id: number,
    data: Partial<ScheduleView>,
  ): Promise<ScheduleView> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/schedule-views/${id}?event_id=${eventId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) throw new Error("Failed to update Schedule View");
    return response.json();
  },
  deleteScheduleView: async (eventId: number, id: number): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/schedule-views/${id}?event_id=${eventId}`,
      { method: "DELETE" },
    );
    if (!response.ok) throw new Error("Failed to delete Schedule View");
  },
  getElements: async (eventId: number): Promise<SessionElement[]> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/session-elements?event_id=${eventId}`,
    );
    if (!response.ok) throw new Error("Failed to fetch Session Elements");
    return response.json();
  },
  createElement: async (
    eventId: number,
    data: Omit<Partial<SessionElement>, "id" | "event_id"> & {
      title: string;
      date: string;
      start_time: string;
      end_time: string;
      attendee_team_ids?: number[];
      schedule_view_ids?: number[];
    },
  ): Promise<SessionElement> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/session-elements?event_id=${eventId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) {
      const err = await response.json().catch(() => null);
      throw new Error(err?.detail || "Failed to create Session Element");
    }
    return response.json();
  },
  /** Create a collection of schedule items in one validated transaction. */
  bulkCreateElements: async (
    eventId: number,
    items: Array<
      Omit<Partial<SessionElement>, "id" | "event_id"> & {
        title: string;
        date: string;
        start_time: string;
        end_time: string;
      }
    >,
  ): Promise<SessionElement[]> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/session-elements/bulk-create?event_id=${eventId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      },
    );
    if (!response.ok) {
      const err = await response.json().catch(() => null);
      throw new Error(err?.detail || "Failed to create schedule items");
    }
    return response.json();
  },
  updateElement: async (
    eventId: number,
    id: number,
    data: Partial<SessionElement>,
  ): Promise<SessionElement> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/session-elements/${id}?event_id=${eventId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) {
      const err = await response.json().catch(() => null);
      throw new Error(err?.detail || "Failed to update Session Element");
    }
    return response.json();
  },
  deleteElement: async (eventId: number, id: number): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/session-elements/${id}?event_id=${eventId}`,
      { method: "DELETE" },
    );
    if (!response.ok) throw new Error("Failed to delete Session Element");
  },
  duplicateElement: async (
    eventId: number,
    id: number,
  ): Promise<SessionElement> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/session-elements/${id}/duplicate?event_id=${eventId}`,
      { method: "POST" },
    );
    if (!response.ok) throw new Error("Failed to duplicate Session Element");
    return response.json();
  },
  copyElements: async (
    eventId: number,
    elementIds: number[],
    targetDates: string[],
  ): Promise<SessionElement[]> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/session-elements/copy?event_id=${eventId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ element_ids: elementIds, target_dates: targetDates }),
      },
    );
    if (!response.ok) throw new Error("Failed to copy Session Elements");
    return response.json();
  },
  /** Replace Public Schedule views or audiences on a selected element set. */
  bulkUpdateElements: async (
    eventId: number,
    elementIds: number[],
    changes: BulkSessionElementChanges,
  ): Promise<SessionElement[]> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/session-elements/bulk?event_id=${eventId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ element_ids: elementIds, ...changes }),
      },
    );
    if (!response.ok) {
      const err = await response.json().catch(() => null);
      throw new Error(err?.detail || "Failed to update Session Elements");
    }
    return response.json();
  },
  getPublishState: async (
    eventId: number,
  ): Promise<GeneralSchedulePublishState> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/general-schedule/publish-state/${eventId}`,
    );
    if (!response.ok) throw new Error("Failed to fetch General Schedule publish state");
    return response.json();
  },
};

// Custom Field interface (display-only metadata)
export interface CustomField {
  id: string;
  label: string;
  type: "text" | "number" | "boolean" | "date" | "time" | "select";
  order: number;
  show_in_schedule: boolean;
  value?: any; // Instance-specific value
  options?: string[]; // For select type
}

// Task Template Capability relationship
export interface TaskTemplateCapability {
  id: number;
  task_template_id: number;
  capability_id: number;
  quantity: number;
}

// Task Template Person relationship
export interface TaskTemplatePerson {
  id: number;
  task_template_id: number;
  person_id: number;
}

// Task Template interface (with hardcoded optimisation fields)
export interface TaskTemplate {
  id: number;
  machine_name: string;
  name: string;
  description?: string;
  task_type_id: number;

  // Task classification
  is_floating: boolean;
  is_transfer: boolean;

  // HARDCODED OPTIMIZATION FIELDS
  // Location fields (-1 = Anywhere)
  location_id?: number | null;
  start_location_id?: number | null; // For transfers
  end_location_id?: number | null; // For transfers

  // Time fields (HH:MM format)
  start_time?: string | null; // For static tasks
  end_time?: string | null; // For static tasks
  time_range_start?: string | null; // For floating tasks
  time_range_end?: string | null; // For floating tasks
  duration_minutes?: number | null; // For floating tasks

  // Transfer-specific
  dynamic_allocation_limit?: number | null; // Required for transfers

  // RELATIONSHIPS
  template_capabilities?: TaskTemplateCapability[];
  template_persons?: TaskTemplatePerson[];

  // FLEXIBLE CUSTOM FIELDS (display/metadata)
  custom_fields: CustomField[];

  // Legacy fields (preserved for backward compatibility)
  fields?: any[];

  // Metadata
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

// Task Template Create/Update payload
export interface TaskTemplatePayload {
  machine_name: string;
  name: string;
  description?: string | null;
  task_type_id: number;
  is_floating: boolean;
  is_transfer: boolean;

  // Hardcoded fields
  location_id?: number | null;
  start_location_id?: number | null;
  end_location_id?: number | null;
  start_time?: string | null;
  end_time?: string | null;
  time_range_start?: string | null;
  time_range_end?: string | null;
  duration_minutes?: number | null;
  dynamic_allocation_limit?: number | null;

  // Relationships
  capability_ids?: number[];
  person_ids?: number[];

  // Custom fields
  custom_fields: CustomField[];
}

// Task Templates API
/** Client wrapper for reusable task templates and custom fields. */
export const taskTemplatesApi = {
  /** Fetch all reusable task templates. */
  getAll: async (): Promise<TaskTemplate[]> => {
    const response = await apiFetch(`${API_BASE}/api/v1/task-templates/`);
    if (!response.ok) {
      throw new Error(`Failed to fetch task templates: ${response.statusText}`);
    }
    return response.json();
  },

  /** Fetch one reusable task template. */
  getById: async (id: number): Promise<TaskTemplate> => {
    const response = await apiFetch(`${API_BASE}/api/v1/task-templates/${id}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch task template: ${response.statusText}`);
    }
    return response.json();
  },

  /** Create a reusable task template. */
  create: async (data: TaskTemplatePayload): Promise<TaskTemplate> => {
    const response = await apiFetch(`${API_BASE}/api/v1/task-templates/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(
        `Failed to create task template: ${error.detail || response.statusText}`,
      );
    }
    return response.json();
  },

  /** Update a reusable task template. */
  update: async (
    id: number,
    data: Partial<TaskTemplatePayload>,
  ): Promise<TaskTemplate> => {
    const response = await apiFetch(`${API_BASE}/api/v1/task-templates/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(
        `Failed to update task template: ${error.detail || response.statusText}`,
      );
    }
    return response.json();
  },

  /** Delete a reusable task template. */
  delete: async (id: number): Promise<void> => {
    const response = await apiFetch(`${API_BASE}/api/v1/task-templates/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(
        `Failed to delete task template: ${error.detail || response.statusText}`,
      );
    }
  },
};

// Task Type interface
export interface TaskType {
  id: number;
  name: string;
  description?: string;
  color?: string;
  sort_order?: number;
  is_active: boolean;
  fatigue_score?: number;
  /** Missing on legacy records and treated as true by clients. */
  counts_towards_work_time?: boolean;
  created_at?: string;
  updated_at?: string;
}

// Capability interface
export interface Capability {
  id: number;
  machine_name: string;
  name: string;
  description?: string;
  capability_type_id?: number;
  created_at?: string;
  updated_at?: string;
}

// Capability Type interface
export interface CapabilityType {
  id: number;
  name: string;
  description?: string;
  color?: string;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export type ShortcutOverrides = Record<string, string>;

// Capability Types API
/** Client wrapper for global capability type taxonomy. */
export const capabilityTypesApi = {
  /** Fetch all capability type groups. */
  getAll: async (): Promise<CapabilityType[]> => {
    const response = await apiFetch(`${API_BASE}/api/v1/capability-types/`);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch capability types: ${response.statusText}`,
      );
    }
    return response.json();
  },

  /** Create a capability type group. */
  create: async (
    data: Omit<CapabilityType, "id" | "created_at" | "updated_at">,
  ): Promise<CapabilityType> => {
    const response = await apiFetch(`${API_BASE}/api/v1/capability-types/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || response.statusText);
    }
    return response.json();
  },

  /** Update a capability type group. */
  update: async (
    id: number,
    data: Partial<CapabilityType>,
  ): Promise<CapabilityType> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/capability-types/${id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || response.statusText);
    }
    return response.json();
  },

  /** Delete a capability type group. */
  delete: async (id: number): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/capability-types/${id}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || response.statusText);
    }
  },
};

// Task Types API
/** Client wrapper for global task type definitions. */
export const taskTypesApi = {
  /** Fetch all task type definitions. */
  getAll: async (): Promise<TaskType[]> => {
    const response = await apiFetch(`${API_BASE}/api/v1/task-types/`);
    if (!response.ok) {
      throw new Error(`Failed to fetch task types: ${response.statusText}`);
    }
    return response.json();
  },

  /** Create a task type definition. */
  create: async (
    data: Omit<TaskType, "id" | "created_at" | "updated_at">,
  ): Promise<TaskType> => {
    const response = await apiFetch(`${API_BASE}/api/v1/task-types/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || response.statusText);
    }
    return response.json();
  },

  /** Update a task type definition. */
  update: async (id: number, data: Partial<TaskType>): Promise<TaskType> => {
    const response = await apiFetch(`${API_BASE}/api/v1/task-types/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || response.statusText);
    }
    return response.json();
  },

  /** Delete a task type definition. */
  delete: async (id: number): Promise<void> => {
    const response = await apiFetch(`${API_BASE}/api/v1/task-types/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || response.statusText);
    }
  },
};

// ── Calendar Export Format API ────────────────────────────────────────
export interface CalendarExportFormat {
  id: number;
  task_type_id: number;
  title_template: string;
  description_template: string;
  color_id: string | null;
}

export interface TemplateVariable {
  name: string;
  label: string;
  source: "built-in" | "template-field" | "person";
}

/** Client wrapper for Google Calendar export template formats. */
export const exportFormatsApi = {
  /** Fetch all calendar export format templates. */
  getAll: async (): Promise<CalendarExportFormat[]> => {
    const response = await apiFetch(`${API_BASE}/api/v1/export-formats/`);
    if (!response.ok) throw new Error("Failed to fetch export formats");
    return response.json();
  },
  /** Fetch the calendar export format for one task type. */
  get: async (taskTypeId: number): Promise<CalendarExportFormat> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/export-formats/${taskTypeId}`,
    );
    if (!response.ok) throw new Error("Export format not found");
    return response.json();
  },
  /** Create or replace a calendar export format for one task type. */
  upsert: async (
    taskTypeId: number,
    data: {
      title_template: string;
      description_template: string;
      color_id: string | null;
    },
  ): Promise<CalendarExportFormat> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/export-formats/${taskTypeId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_type_id: taskTypeId, ...data }),
      },
    );
    if (!response.ok) throw new Error("Failed to save export format");
    return response.json();
  },
  /** Fetch template variables available for one task type. */
  getVariables: async (
    taskTypeId: number,
    eventId?: number,
  ): Promise<TemplateVariable[]> => {
    let url = `${API_BASE}/api/v1/export-formats/${taskTypeId}/variables`;
    if (eventId) url += `?event_id=${eventId}`;
    const response = await apiFetch(url);
    if (!response.ok) throw new Error("Failed to fetch variables");
    return response.json();
  },
};

// Capabilities API
/** Client wrapper for global and event-filtered capability catalogue data. */
export const capabilitiesApi = {
  /** Fetch global capabilities or event-filtered capabilities. */
  getAll: async (eventId?: number): Promise<Capability[]> => {
    const url = eventId
      ? `${API_BASE}/api/v1/capabilities?event_id=${eventId}`
      : `${API_BASE}/api/v1/capabilities`;
    const response = await apiFetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch capabilities: ${response.statusText}`);
    }
    return response.json();
  },

  /** Create a global capability. */
  create: async (
    data: Omit<Capability, "id" | "created_at" | "updated_at">,
  ): Promise<Capability> => {
    const response = await apiFetch(`${API_BASE}/api/v1/capabilities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || response.statusText);
    }
    return response.json();
  },

  /** Update a global capability. */
  update: async (
    id: number,
    data: Partial<Capability>,
  ): Promise<Capability> => {
    const response = await apiFetch(`${API_BASE}/api/v1/capabilities/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || response.statusText);
    }
    return response.json();
  },

  /** Delete a global capability. */
  delete: async (id: number): Promise<void> => {
    const response = await apiFetch(`${API_BASE}/api/v1/capabilities/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || response.statusText);
    }
  },
};

// Flow Validation API
/** Client wrapper for flow feasibility checks. */
export const flowApi = {
  /** Run a flow feasibility check for an event and selected date. */
  check: async (
    data: {
      tasks: any[];
      persons: any[];
      locations: any[];
      capabilities: any[];
      working_day_date?: string;
      working_day_boundary_offset_hour?: number;
    },
    signal?: AbortSignal,
    skipFloating?: boolean,
  ): Promise<{
    errors: string[];
    feasible: boolean;
    diagnostics: import("@/types/optimization").FeasibilityDiagnostics;
  }> => {
    const params = skipFloating ? "?skip_floating=true" : "";
    const response = await apiFetch(`${API_BASE}/api/v1/flow/check${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal,
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      console.warn("Flow check request failed:", response.status, errorData);
      // Extract human-readable validation error from Pydantic detail
      let errorMsg = `Flow check failed: ${response.statusText}`;
      if (errorData?.detail && Array.isArray(errorData.detail)) {
        const details = errorData.detail
          .map((d: any) => `${(d.loc || []).join(".")}: ${d.msg || "invalid"}`)
          .join("; ");
        errorMsg = `Flow check validation error: ${details}`;
      } else if (errorData?.detail && typeof errorData.detail === "string") {
        errorMsg = errorData.detail.startsWith("Flow check failed:")
          ? errorData.detail
          : `Flow check failed: ${errorData.detail}`;
      }
      throw new Error(errorMsg);
    }
    return response.json();
  },
};

// =============================================================================
// Masterplan API (finalise, layouts, descriptions)
// =============================================================================

// Masterplan Layout API (cosmetic overrides)
/** Client wrapper for per-event masterplan layout persistence. */
export const masterplanLayoutApi = {
  /** Fetch all visual layout overrides for an event. */
  getAll: async (eventId: number): Promise<MasterplanLayout[]> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/masterplan-layouts/?event_id=${eventId}`,
    );
    if (!response.ok)
      throw new Error(`Failed to fetch layouts: ${response.statusText}`);
    return response.json();
  },

  /** Create or update one visual layout override. */
  upsert: async (
    taskId: number,
    eventId: number,
    data: MasterplanLayoutUpdate,
  ): Promise<MasterplanLayout> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/masterplan-layouts/${taskId}?event_id=${eventId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok)
      throw new Error(`Failed to upsert layout: ${response.statusText}`);
    return response.json();
  },

  /** Create or update multiple visual layout overrides. */
  bulkUpsert: async (
    eventId: number,
    layouts: Array<MasterplanLayoutUpdate & { task_id: number }>,
  ): Promise<{ status: string; created: number; updated: number }> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/masterplan-layouts/bulk/upsert`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: eventId, layouts }),
      },
    );
    if (!response.ok)
      throw new Error(`Failed to bulk upsert layouts: ${response.statusText}`);
    return response.json();
  },

  /** Delete one visual layout override. */
  delete: async (
    taskId: number,
    eventId: number,
  ): Promise<{ status: string; message: string }> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/masterplan-layouts/${taskId}?event_id=${eventId}`,
      { method: "DELETE" },
    );
    if (!response.ok)
      throw new Error(`Failed to delete layout: ${response.statusText}`);
    return response.json();
  },

  /** Delete all visual layout overrides for an event. */
  deleteAllForEvent: async (
    eventId: number,
  ): Promise<{ status: string; deleted: number }> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/masterplan-layouts/event/${eventId}`,
      { method: "DELETE" },
    );
    if (!response.ok)
      throw new Error(`Failed to reset layouts: ${response.statusText}`);
    return response.json();
  },
};

// -------------------------------------------------------------------
// Task Instances - pre-finalization working copies
// -------------------------------------------------------------------

export interface TaskInstance {
  id: number;
  name: string;
  event_id: number;
  template_id?: number | null;
  task_type_id?: number | null;
  date: string; // "YYYY-MM-DD"
  day_index?: number | null;
  is_floating: boolean;
  is_transfer: boolean;
  field_values?: Record<string, any> | null;
  optimised?: Record<string, any> | null;
  final?: Record<string, any> | null;
  constraints?: Record<string, any> | null;
  additional?: Record<string, any> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface TaskInstanceCreate {
  name?: string;
  event_id: number;
  template_id?: number | null;
  task_type_id?: number | null;
  date: string;
  day_index?: number | null;
  is_floating?: boolean;
  is_transfer?: boolean;
  field_values?: Record<string, any> | null;
  optimised?: Record<string, any> | null;
  final?: Record<string, any> | null;
  constraints?: Record<string, any> | null;
  additional?: Record<string, any> | null;
}

export interface TaskInstanceUpdate {
  name?: string;
  template_id?: number | null;
  task_type_id?: number | null;
  date?: string;
  day_index?: number | null;
  is_floating?: boolean;
  is_transfer?: boolean;
  field_values?: Record<string, any> | null;
  optimised?: Record<string, any> | null;
  final?: Record<string, any> | null;
  constraints?: Record<string, any> | null;
  additional?: Record<string, any> | null;
}

/** Client wrapper for task instance CRUD and optimisation result writes. */
export const taskInstancesApi = {
  /** List all task instances for an event, optionally filtered by date. */
  getAll: async (eventId: number, date?: string): Promise<TaskInstance[]> => {
    let url = `${API_BASE}/api/v1/task-instances?event_id=${eventId}`;
    if (date) url += `&date=${encodeURIComponent(date)}`;
    const response = await apiFetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch task instances: ${response.statusText}`);
    }
    return response.json();
  },

  /** Get a single task instance by ID. */
  getById: async (id: number, eventId: number): Promise<TaskInstance> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/task-instances/${id}?event_id=${eventId}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch task instance: ${response.statusText}`);
    }
    return response.json();
  },

  /** Create a single task instance. */
  create: async (data: TaskInstanceCreate): Promise<TaskInstance> => {
    const response = await apiFetch(`${API_BASE}/api/v1/task-instances`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error(`Failed to create task instance: ${response.statusText}`);
    }
    return response.json();
  },

  /** Create multiple task instances in one call. */
  createBulk: async (items: TaskInstanceCreate[]): Promise<TaskInstance[]> => {
    const response = await apiFetch(`${API_BASE}/api/v1/task-instances/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to create task instances: ${response.statusText}`,
      );
    }
    return response.json();
  },

  /** Update a task instance (partial). */
  update: async (
    id: number,
    eventId: number,
    data: TaskInstanceUpdate,
  ): Promise<TaskInstance> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/task-instances/${id}?event_id=${eventId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to update task instance: ${response.statusText}`);
    }
    return response.json();
  },

  /** Write optimisation results to multiple task instances at once. */
  bulkSetOptimised: async (
    eventId: number,
    items: {
      id: number;
      optimised: Record<string, any>;
      final?: Record<string, any>;
    }[],
  ): Promise<TaskInstance[]> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/task-instances/bulk-optimised?event_id=${eventId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to set optimised data: ${response.statusText}`);
    }
    return response.json();
  },

  /** Delete a single task instance. */
  delete: async (id: number, eventId: number): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/task-instances/${id}?event_id=${eventId}`,
      {
        method: "DELETE",
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to delete task instance: ${response.statusText}`);
    }
  },

  /** Delete all task instances for an event. */
  deleteAll: async (eventId: number): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/task-instances?event_id=${eventId}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      throw new Error(
        `Failed to delete task instances: ${response.statusText}`,
      );
    }
  },

  /** Restore task instances from Tasks table when instances were lost. */
  restore: async (eventId: number): Promise<TaskInstance[]> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/task-instances/restore?event_id=${eventId}`,
      { method: "POST" },
    );
    if (!response.ok) {
      throw new Error(
        `Failed to restore task instances: ${response.statusText}`,
      );
    }
    return response.json();
  },
};

// ── Event Status API ──────────────────────────────────────────────────
/** Client wrapper for updating event workflow status. */
export const eventStatusApi = {
  /** Update an event's workflow status. */
  update: async (
    eventId: number,
    status: EventStatus,
  ): Promise<{ id: number; name: string; status: string }> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/events/${eventId}/status`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
    if (!response.ok)
      throw new Error(`Failed to update event status: ${response.statusText}`);
    return response.json();
  },
};

// ── Google Calendar API ───────────────────────────────────────────────
export type PublishScheduleScope = "all" | "partial" | "none";

export interface PublishedDayRecordDto {
  fingerprint?: string | null;
  publishedAt?: string | null;
  failedAt?: string | null;
  failureMessage?: string | null;
}

export interface EventPublishState {
  event_id: number;
  published_schedule_fingerprint?: string | null;
  published_schedule_scope: PublishScheduleScope;
  published_at?: string | null;
  publish_failed_at?: string | null;
  day_records: Record<string, PublishedDayRecordDto>;
  last_publish_targets?: PublishDestination[];
  last_publish_result_summary?: string | null;
}

export interface EventPublishStateSavePayload {
  published_schedule_fingerprint?: string | null;
  published_schedule_scope?: PublishScheduleScope;
  published_at?: string | null;
  publish_failed_at?: string | null;
  day_records?: Record<string, PublishedDayRecordDto>;
  last_publish_targets?: PublishDestination[];
  last_publish_result_summary?: string | null;
}

export interface EventPublishFailurePayload {
  day_ids: string[];
  failed_at: string;
  failure_message?: string;
  last_publish_targets?: PublishDestination[];
  last_publish_result_summary?: string | null;
}

/** Client wrapper for persisted, non-sensitive event publish state. */
export const publishStateApi = {
  /** Fetch one event's publish confidence metadata from the backend database. */
  get: async (eventId: number): Promise<EventPublishState> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/publish-state/${eventId}`,
    );
    if (!response.ok)
      throw new Error(`Failed to fetch publish state: ${response.statusText}`);
    return response.json();
  },

  /** Save the full publish state after a successful publish action. */
  save: async (
    eventId: number,
    payload: EventPublishStateSavePayload,
  ): Promise<EventPublishState> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/publish-state/${eventId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok)
      throw new Error(`Failed to save publish state: ${response.statusText}`);
    return response.json();
  },

  /** Record a failed publish attempt for the affected days. */
  recordFailure: async (
    eventId: number,
    payload: EventPublishFailurePayload,
  ): Promise<EventPublishState> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/publish-state/${eventId}/failure`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok)
      throw new Error(`Failed to record publish failure: ${response.statusText}`);
    return response.json();
  },

  /** Clear one event's publish state, for resets or destructive data workflows. */
  clear: async (eventId: number): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/publish-state/${eventId}`,
      { method: "DELETE" },
    );
    if (!response.ok)
      throw new Error(`Failed to clear publish state: ${response.statusText}`);
  },
};

export interface GoogleCalendarConnection {
  id: number;
  account_email: string;
  calendar_id?: string | null;
  calendar_name?: string | null;
  created_at?: string;
}

export interface GoogleCalendar {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
}

export interface CalendarMember {
  email: string;
  displayName?: string;
  role?: string;
}

export interface GooglePublishDayResult {
  date: string;
  deleted: number;
  created: number;
  errors: string[];
}

export interface GooglePublishResponse {
  status: string;
  results: GooglePublishDayResult[];
  events_created: number;
}

/** Client wrapper for Google OAuth, calendar selection, and publishing. */
export const googleCalendarApi = {
  /** Get all saved connections. */
  getConnections: async (): Promise<GoogleCalendarConnection[]> => {
    const response = await apiFetch(`${API_BASE}/api/v1/google/connections`);
    if (!response.ok)
      throw new Error(`Failed to fetch connections: ${response.statusText}`);
    return response.json();
  },

  /** Start OAuth2 connect flow - returns { auth_url, state }. */
  connect: async (): Promise<{ auth_url: string; state: string }> => {
    const response = await apiFetch(`${API_BASE}/api/v1/google/connect`, {
      method: "POST",
    });
    if (!response.ok)
      throw new Error(`Failed to start connect: ${response.statusText}`);
    return response.json();
  },

  /** Exchange OAuth2 callback code. */
  handleCallback: async (
    code: string,
    state: string,
  ): Promise<GoogleCalendarConnection> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/google/oauth2callback`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state }),
      },
    );
    if (!response.ok)
      throw new Error(`OAuth2 callback failed: ${response.statusText}`);
    return response.json();
  },

  /** Delete a connection. */
  deleteConnection: async (connectionId: number): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/google/connections/${connectionId}`,
      { method: "DELETE" },
    );
    if (!response.ok)
      throw new Error(`Failed to delete connection: ${response.statusText}`);
  },

  /** List calendars for a connection. */
  listCalendars: async (connectionId: number): Promise<GoogleCalendar[]> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/google/calendars?connection_id=${connectionId}`,
    );
    if (!response.ok)
      throw new Error(`Failed to list calendars: ${response.statusText}`);
    return response.json();
  },

  /** List calendar members for a connection + calendar. */
  listMembers: async (
    connectionId: number,
    calendarId?: string,
  ): Promise<CalendarMember[]> => {
    let url = `${API_BASE}/api/v1/google/calendar-members?connection_id=${connectionId}`;
    if (calendarId) url += `&calendar_id=${encodeURIComponent(calendarId)}`;
    const response = await apiFetch(url);
    if (!response.ok)
      throw new Error(`Failed to list members: ${response.statusText}`);
    return response.json();
  },

  /** Set the calendar for a connection. */
  setCalendar: async (
    connectionId: number,
    calendarId: string,
    calendarName: string,
  ): Promise<GoogleCalendarConnection> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/google/connections/${connectionId}/calendar`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calendar_id: calendarId,
          calendar_name: calendarName,
        }),
      },
    );
    if (!response.ok)
      throw new Error(`Failed to set calendar: ${response.statusText}`);
    return response.json();
  },

  /** Publish tasks to Google Calendar. */
  publish: async (
    eventId: number,
    dates?: string[],
  ): Promise<GooglePublishResponse> => {
    const response = await apiFetch(`${API_BASE}/api/v1/google/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: eventId, dates }),
    });
    if (!response.ok)
      throw new Error(`Failed to publish: ${response.statusText}`);
    return response.json();
  },

  /** Fetch available event colours from Google Calendar API. */
  getEventColors: async (): Promise<
    { id: string; background: string; foreground: string }[]
  > => {
    const response = await apiFetch(`${API_BASE}/api/v1/google/colors`);
    if (!response.ok)
      throw new Error(`Failed to fetch colours: ${response.statusText}`);
    return response.json();
  },
};

// Data Management API
function importApiErrorMessage(err: any, fallback: string) {
  const detail = err?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail.message === "string") return detail.message;
  if (typeof err?.message === "string") return err.message;
  return fallback;
}

/** One task skeleton whose copied date can be reviewed or repaired. */
export interface CopiedTaskDateRepairCandidate {
  task_instance_id: number;
  name: string;
  current_date: string;
  proposed_date?: string | null;
  proposed_day_index?: number | null;
  repairable: boolean;
  reason?: string | null;
}

/** Read-only repair preview for copied task dates between two projects. */
export interface CopiedTaskDateRepairPreview {
  source_event_id: number;
  target_event_id: number;
  candidates: CopiedTaskDateRepairCandidate[];
  repairable_count: number;
}

/** Result returned after selected copied task dates are repaired. */
export interface CopiedTaskDateRepairResult {
  status: string;
  repaired_count: number;
  task_instance_ids: number[];
}

/** Client wrapper for backups, imports, copy-from-event, and destructive resets. */
export const dataManagementApi = {
  /** Export global data, selected events, or the full local database backup. */
  exportData: async (
    scope: "full" | "global" | "event" | "shareable",
    eventIds?: number[],
  ): Promise<Record<string, any>> => {
    const response = await apiFetch(`${API_BASE}/api/v1/data/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope,
        event_ids: eventIds,
      }),
    });
    if (!response.ok) {
      const err = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(importApiErrorMessage(err, response.statusText));
    }
    return response.json();
  },

  /** Validate an import payload and return its preview without applying changes. */
  previewImport: async (
    data: Record<string, any>,
  ): Promise<ImportValidationResult> => {
    const response = await apiFetch(`${API_BASE}/api/v1/data/import/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });
    if (!response.ok) {
      const err = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(importApiErrorMessage(err, response.statusText));
    }
    return response.json();
  },

  /** Import a previously exported backup payload. */
  importData: async (
    data: Record<string, any>,
  ): Promise<{
    status: string;
    message: string;
    imported_event_ids?: number[];
  }> => {
    const response = await apiFetch(`${API_BASE}/api/v1/data/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });
    if (!response.ok) {
      const err = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(importApiErrorMessage(err, response.statusText));
    }
    return response.json();
  },

  /** Copy selected setup areas from a source event to a target event. */
  copyFromEvent: async (
    sourceEventId: number,
    targetEventId: number,
    include: string[],
  ): Promise<{ status: string; summary: Record<string, number> }> => {
    const response = await apiFetch(`${API_BASE}/api/v1/data/copy-from-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_event_id: sourceEventId,
        target_event_id: targetEventId,
        include,
      }),
    });
    if (!response.ok) {
      const err = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(err.detail || response.statusText);
    }
    return response.json();
  },

  /** Preview task skeletons whose copied dates can be shifted into the target event. */
  previewCopiedTaskDateRepair: async (
    sourceEventId: number,
    targetEventId: number,
  ): Promise<CopiedTaskDateRepairPreview> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/data/copy-from-event/repair-preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_event_id: sourceEventId,
          target_event_id: targetEventId,
        }),
      },
    );
    if (!response.ok) {
      const err = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(importApiErrorMessage(err, response.statusText));
    }
    return response.json();
  },

  /** Apply selected copied task-date repairs after server-side revalidation. */
  repairCopiedTaskDates: async (
    sourceEventId: number,
    targetEventId: number,
    taskInstanceIds: number[],
  ): Promise<CopiedTaskDateRepairResult> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/data/copy-from-event/repair`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_event_id: sourceEventId,
          target_event_id: targetEventId,
          task_instance_ids: taskInstanceIds,
        }),
      },
    );
    if (!response.ok) {
      const err = await response
        .json()
        .catch(() => ({ detail: response.statusText }));
      throw new Error(importApiErrorMessage(err, response.statusText));
    }
    return response.json();
  },

  /** Delete one event through the data-management API. */
  deleteEvent: async (eventId: number): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/data/event/${eventId}`,
      { method: "DELETE" },
    );
    if (!response.ok)
      throw new Error(`Failed to delete event: ${response.statusText}`);
  },

  /** Reset all local app data after server-side confirmation. */
  factoryReset: async (): Promise<void> => {
    const response = await apiFetch(`${API_BASE}/api/v1/data/factory-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "RESET" }),
    });
    if (!response.ok)
      throw new Error(`Factory reset failed: ${response.statusText}`);
  },
};

// App Settings API
/** Client wrapper for local app settings such as OAuth, solver, publish, and shortcuts. */
export const appSettingsApi = {
  /** Get whether Google OAuth credentials are configured. */
  getGoogleOAuth: async (): Promise<{
    configured: boolean;
    client_id_preview: string | null;
    credential_storage_available?: boolean;
    client_secret_available?: boolean;
  }> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/app-settings/google-oauth`,
    );
    if (!response.ok)
      throw new Error(`Failed to fetch OAuth status: ${response.statusText}`);
    return response.json();
  },

  /** Save Google OAuth client credentials in local app settings. */
  setGoogleOAuth: async (
    clientId: string,
    clientSecret: string,
  ): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/app-settings/google-oauth`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
        }),
      },
    );
    if (!response.ok)
      throw new Error(
        `Failed to save OAuth credentials: ${response.statusText}`,
      );
  },

  /** Delete Google OAuth client credentials from local app settings. */
  deleteGoogleOAuth: async (): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/app-settings/google-oauth`,
      { method: "DELETE" },
    );
    if (!response.ok)
      throw new Error(
        `Failed to remove OAuth credentials: ${response.statusText}`,
      );
  },

  /** Fetch solver tuning settings used by optimisation jobs. */
  getSolverSettings: async (): Promise<{
    max_time_seconds: number;
    break_threshold_min: number;
    break_recovery_bonus: number;
    fatigue_scale: number;
  }> => {
    const response = await apiFetch(`${API_BASE}/api/v1/app-settings/solver`);
    if (!response.ok)
      throw new Error(
        `Failed to fetch solver settings: ${response.statusText}`,
      );
    return response.json();
  },

  /** Save solver tuning settings used by optimisation jobs. */
  setSolverSettings: async (settings: {
    max_time_seconds: number;
    break_threshold_min: number;
    break_recovery_bonus: number;
    fatigue_scale: number;
  }): Promise<{
    max_time_seconds: number;
    break_threshold_min: number;
    break_recovery_bonus: number;
    fatigue_scale: number;
  }> => {
    const response = await apiFetch(`${API_BASE}/api/v1/app-settings/solver`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    if (!response.ok)
      throw new Error(`Failed to save solver settings: ${response.statusText}`);
    return response.json();
  },

  /** Reset solver tuning settings to backend defaults. */
  resetSolverSettings: async (): Promise<void> => {
    const response = await apiFetch(`${API_BASE}/api/v1/app-settings/solver`, {
      method: "DELETE",
    });
    if (!response.ok)
      throw new Error(
        `Failed to reset solver settings: ${response.statusText}`,
      );
  },

  /** Fetch the configured publish target. */
  getPublishTarget: async (): Promise<{ targets: PublishTarget }> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/app-settings/publish-target`,
    );
    if (!response.ok)
      throw new Error(`Failed to fetch publish target: ${response.statusText}`);
    return response.json();
  },

  /** Save the configured publish target. */
  setPublishTarget: async (
    targets: PublishTarget,
  ): Promise<{ targets: PublishTarget }> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/app-settings/publish-target`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      },
    );
    if (!response.ok)
      throw new Error(`Failed to save publish target: ${response.statusText}`);
    return response.json();
  },

  /** Fetch persisted keyboard shortcut overrides. */
  getShortcuts: async (): Promise<{ shortcuts: ShortcutOverrides }> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/app-settings/shortcuts`,
    );
    if (!response.ok)
      throw new Error(`Failed to fetch shortcuts: ${response.statusText}`);
    return response.json();
  },

  /** Save persisted keyboard shortcut overrides. */
  setShortcuts: async (
    shortcuts: ShortcutOverrides,
  ): Promise<{ shortcuts: ShortcutOverrides }> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/app-settings/shortcuts`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortcuts }),
      },
    );
    if (!response.ok)
      throw new Error(`Failed to save shortcuts: ${response.statusText}`);
    return response.json();
  },

  /** Clear all persisted keyboard shortcut overrides. */
  resetShortcuts: async (): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/app-settings/shortcuts`,
      { method: "DELETE" },
    );
    if (!response.ok)
      throw new Error(`Failed to reset shortcuts: ${response.statusText}`);
  },
};

// ── MP-Backend API ────────────────────────────────────────────────────
export interface MpBackendSettings {
  configured: boolean;
  server_url: string | null;
  secret_preview: string | null;
  credential_storage_available?: boolean;
  secret_available?: boolean;
}

export interface MpBackendPingResult {
  status: string;
  event_name: string | null;
  event_id: number | null;
  event_ref?: string | null;
  supports_scoped_publish?: boolean;
  supports_deletion_work_orders?: boolean;
}

export interface DeletionWorkOrderSyncResult {
  applied: number;
  reports_sent: number;
  reports_pending: number;
  event_deleted: boolean;
}

export interface DeletionWorkOrderStatusResult {
  pending: number;
}

export interface MpBackendPublishResult {
  status: string;
  tasks_created: number;
  persons_created: number;
  edits_cleared: number;
}

export interface MpBackendDataPolicy {
  configured: boolean;
  policy_version: number;
  policy_sha256: string;
  controller_identity: string | null;
  purpose: string | null;
  allowed: string[];
  unsupported: string[];
  policy_url: string;
  privacy_url: string;
  retention_days: number | null;
  enabled_optional_features: string[];
  incident_contact: string | null;
  acknowledged: boolean;
  operator_subject: string | null;
}

export interface GeneralSchedulePublishResult {
  status: string;
  items_published: number;
  fingerprint?: string | null;
  published_at?: string | null;
}

export interface ExportSetupPerson {
  username: string;
  display_name: string;
  email: string | null;
}

export interface ExportSetupEvent {
  name: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface ExportSetupData {
  event: ExportSetupEvent;
  users: ExportSetupPerson[];
}

/** Client wrapper for MP-Backend publish settings and export operations. */
export const mpBackendApi = {
  /** Fetch the exact Server policy and this installation's acknowledgement state. */
  getDataPolicy: async (eventId: number): Promise<MpBackendDataPolicy> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/mp-backend/data-policy/${eventId}`,
    );
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(
        formatApiErrorMessage(
          error,
          apiStatusFallback(response, "Failed to load the Server permitted-data policy"),
        ),
      );
    }
    return response.json();
  },

  /** Record an explicit pseudonymous local acknowledgement of an exact policy. */
  acknowledgeDataPolicy: async (
    eventId: number,
    policyVersion: number,
    policySha256: string,
  ): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/mp-backend/data-policy/${eventId}/acknowledge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policy_version: policyVersion,
          policy_sha256: policySha256,
        }),
      },
    );
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(
        formatApiErrorMessage(
          error,
          apiStatusFallback(response, "Failed to acknowledge the Server permitted-data policy"),
        ),
      );
    }
  },

  /** Fetch MP-Backend publish settings for an event. */
  getSettings: async (eventId: number): Promise<MpBackendSettings> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/mp-backend/?event_id=${eventId}`,
    );
    if (!response.ok)
      throw new Error(
        `Failed to fetch MP-Backend settings: ${response.statusText}`,
      );
    return response.json();
  },

  /** Save MP-Backend publish settings for an event. */
  saveSettings: async (
    eventId: number,
    serverUrl: string,
    publishSecret: string,
  ): Promise<MpBackendSettings> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/mp-backend/?event_id=${eventId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_url: serverUrl,
          publish_secret: publishSecret,
        }),
      },
    );
    if (!response.ok)
      throw new Error(
        `Failed to save MP-Backend settings: ${response.statusText}`,
      );
    return response.json();
  },

  /** Delete MP-Backend publish settings for an event. */
  deleteSettings: async (eventId: number): Promise<void> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/mp-backend/?event_id=${eventId}`,
      {
        method: "DELETE",
      },
    );
    if (!response.ok)
      throw new Error(
        `Failed to remove MP-Backend settings: ${response.statusText}`,
      );
  },

  /** Check whether the configured MP-Backend endpoint is reachable. */
  ping: async (eventId: number): Promise<MpBackendPingResult> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/mp-backend/ping?event_id=${eventId}`,
      {
        method: "POST",
      },
    );
    if (!response.ok)
      throw new Error(`Failed to ping MP-Backend: ${response.statusText}`);
    return response.json();
  },

  /** Apply deletion work orders locally and send privacy-safe reports. */
  syncDeletionWorkOrders: async (
    eventId: number,
  ): Promise<DeletionWorkOrderSyncResult> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/mp-backend/deletion-work-orders/${eventId}/sync`,
      { method: "POST" },
    );
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(
        error?.detail ||
          `Failed to process deletion requests: ${response.statusText}`,
      );
    }
    return response.json();
  },

  /** Check for pending work orders without claiming or applying them. */
  getDeletionWorkOrderStatus: async (
    eventId: number,
  ): Promise<DeletionWorkOrderStatusResult> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/mp-backend/deletion-work-orders/${eventId}/status`,
    );
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(
        error?.detail ||
          `Failed to check deletion requests: ${response.statusText}`,
      );
    }
    return response.json();
  },

  /** Retry durable privacy reports after their local event has been erased. */
  retryDeletionReports: async (): Promise<DeletionWorkOrderSyncResult> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/mp-backend/deletion-work-orders/retry-reports`,
      { method: "POST" },
    );
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(
        error?.detail ||
          `Failed to retry deletion reports: ${response.statusText}`,
      );
    }
    return response.json();
  },

  /** Publish one event's final schedule, optionally limited to specific days, to MP-Backend. */
  publish: async (
    eventId: number,
    dates?: string[],
  ): Promise<MpBackendPublishResult> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/mp-backend/publish/${eventId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dates }),
      },
    );
    if (!response.ok) {
      const err = await response.json().catch(() => null);
      throw apiRequestError(err, response, "Failed to publish");
    }
    return response.json();
  },

  /** Publish all or selected working days of an event's Public Schedule. */
  publishGeneralSchedule: async (
    eventId: number,
    dates?: string[],
  ): Promise<GeneralSchedulePublishResult> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/mp-backend/publish-general-schedule/${eventId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dates }),
      },
    );
    if (!response.ok) {
      const err = await response.json().catch(() => null);
      throw new Error(
        formatApiErrorMessage(
          err,
          apiStatusFallback(response, "Failed to publish General Schedule"),
        ),
      );
    }
    return response.json();
  },

  /** Export event setup data in the MP-Backend bootstrap format. */
  exportSetup: async (eventId: number): Promise<ExportSetupData> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/mp-backend/export-setup/${eventId}`,
    );
    if (!response.ok)
      throw new Error(`Failed to export setup: ${response.statusText}`);
    return response.json();
  },
};

/** Public metadata for a processor Ed25519 key held by the Desktop OS keyring. */
export interface ProcessorEvidenceKey {
  key_id: string;
  public_key: string;
  public_key_sha256: string;
  processor_id: string;
  local_event_id?: number | null;
  event_evidence_id: string;
  display_label?: string | null;
  server_instance_id?: string | null;
  role: "processor";
  algorithm: "Ed25519";
  state: "pending_root_approval" | "active" | "revoked" | "retired" | "private_key_missing";
  supersedes_key_id?: string | null;
  created_at: string;
  retired_at?: string | null;
}

/** Detached signature envelope compatible with the Server evidence verifier. */
export interface ProcessorEvidenceProof {
  format: "mp-opt-ed25519-signature-v1";
  key_id: string;
  namespace: "mp-opt-role-trust-v1";
  signature: string;
}

/** Local-only processor-key generation and signing operations. */
export const processorEvidenceApi = {
  /** List public metadata without reading or returning private key material. */
  listKeys: async (eventId?: number, includeStale = false): Promise<ProcessorEvidenceKey[]> => {
    const query = eventId === undefined
      ? ""
      : `?event_id=${encodeURIComponent(eventId)}&include_stale=${includeStale ? "true" : "false"}`;
    const response = await apiFetch(`${API_BASE}/api/v1/processor-evidence/keys${query}`);
    if (!response.ok) throw new Error("Failed to load local processor keys");
    return response.json();
  },

  /** Generate an Ed25519 key directly in the operating-system credential store. */
  generateKey: async (
    eventId: number,
    displayLabel?: string,
    supersedesKeyId?: string,
  ): Promise<{ key: ProcessorEvidenceKey; registration: Record<string, unknown> }> => {
    const response = await apiFetch(`${API_BASE}/api/v1/processor-evidence/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: eventId,
        processor_id: null,
        display_label: displayLabel || null,
        supersedes_key_id: supersedesKeyId || null,
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.detail?.message || "Failed to generate processor key");
    }
    return response.json();
  },

  importKey: async (
    eventId: number,
    keyPackage: Record<string, unknown>,
    passphrase: string,
    displayLabel?: string,
  ): Promise<{ key: ProcessorEvidenceKey; registration: Record<string, unknown> }> => {
    const response = await apiFetch(`${API_BASE}/api/v1/processor-evidence/keys/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: eventId, package: keyPackage, passphrase, display_label: displayLabel || null }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.detail?.message || "Failed to import the encrypted processor key");
    }
    return response.json();
  },

  enrolKey: async (eventId: number, keyId: string) => {
    const response = await apiFetch(`${API_BASE}/api/v1/processor-evidence/keys/enrol`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: eventId, key_id: keyId }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.detail?.message || "Failed to enrol the processor key");
    }
    return response.json();
  },

  refreshEventStatus: async (eventId: number) => {
    const response = await apiFetch(`${API_BASE}/api/v1/processor-evidence/events/${eventId}/refresh-status`, { method: "POST" });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.detail?.message || "Failed to refresh processor-key status");
    }
    return response.json();
  },

  /** Permanently erase every local processor key for an event and allow fresh enrolment. */
  eraseEventKeys: async (eventId: number): Promise<{ status: string; erased_key_count: number }> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/processor-evidence/events/${eventId}/keys`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "ERASE LOCAL PROCESSOR KEYS" }),
      },
    );
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.detail?.message || "Failed to erase the local processor keys");
    }
    return response.json();
  },

  /** Sign an exact, short-lived Server registration challenge locally. */
  signRegistration: async (
    keyId: string,
    document: Record<string, unknown>,
  ): Promise<{ document: Record<string, unknown>; proof: ProcessorEvidenceProof }> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/processor-evidence/keys/${encodeURIComponent(keyId)}/sign-registration`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document }),
      },
    );
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.detail?.message || "Failed to sign registration challenge");
    }
    return response.json();
  },

  /** Disable future local signing only after the public key was revoked on the Server. */
  retireKey: async (keyId: string): Promise<ProcessorEvidenceKey> => {
    const response = await apiFetch(
      `${API_BASE}/api/v1/processor-evidence/keys/${encodeURIComponent(keyId)}/retire`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "REVOKED ON SERVER" }),
      },
    );
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.detail?.message || "Failed to retire local evidence key");
    }
    return response.json();
  },
};
