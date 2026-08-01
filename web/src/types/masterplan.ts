/**
 * TypeScript types for Masterplan features:
 * - Task finalization
 * - Layout overrides
 * - Description templates
 * - Task descriptions
 * - Event status
 */

// =============================================================================
// Event Status
// =============================================================================

export type EventStatus = "draft" | "optimised" | "finalised" | "published";

// =============================================================================
// Finalization
// =============================================================================

export interface TaskInstancePayload {
  id?: number;
  name?: string;
  task_type_id?: number | null;
  event_id: number;
  date: string;
  day_index?: number;
  template_id?: number;
  is_floating?: boolean;
  is_transfer?: boolean;
  field_values?: Record<string, any>;
  optimised?: Record<string, any>;
  final?: Record<string, any>;
  constraints?: Record<string, any>;
  additional?: Record<string, any>;
}

export interface FinalizeRequest {
  event_id: number;
  task_instances: TaskInstancePayload[];
}

export interface FinalizeResponse {
  status: string;
  message: string;
  tasks_created: number;
  event_status: string;
}

// =============================================================================
// Masterplan Layout (cosmetic overrides)
// =============================================================================

export interface MasterplanLayout {
  id: number;
  event_id: number;
  task_id: number;
  visual_height?: number | null;
  visual_x_offset?: number | null;
  visual_width?: number | null;
  custom_color?: string | null;
  sort_order?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface MasterplanLayoutUpdate {
  visual_height?: number | null;
  visual_x_offset?: number | null;
  visual_width?: number | null;
  custom_color?: string | null;
  sort_order?: number | null;
}

// =============================================================================
// Person Swap
// =============================================================================

export interface PersonSwapRequest {
  old_person_id: number;
  new_person_id: number;
}

// =============================================================================
// Backend Task (from DB, post-finalization)
// =============================================================================

export interface BackendTask {
  id: number;
  event_id: number;
  task_template_id?: number;
  task_type_id: number;
  title: string;
  description?: string | null;
  constraints: Record<string, any>;
  optimised: Record<string, any>;
  final: Record<string, any>;
  additional: Record<string, any>;
  is_floating: boolean;
  is_transfer: boolean;
  created_at?: string;
  updated_at?: string;
}
