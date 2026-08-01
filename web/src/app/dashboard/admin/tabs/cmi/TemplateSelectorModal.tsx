"use client";

import { TaskType, TaskTemplate } from "@/lib/api";

interface TemplateSelectorModalProps {
  isOpen: boolean;
  templates: TaskTemplate[];
  taskTypes: TaskType[];
  onSelect: (template: TaskTemplate) => void;
  onClose: () => void;
}

export function TemplateSelectorModal({
  isOpen,
  templates,
  taskTypes,
  onSelect,
  onClose,
}: TemplateSelectorModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Select a Template</h3>
          <button
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground-secondary"
          >
            ✕
          </button>
        </div>
        <div className="space-y-2">
          {templates.length === 0 ? (
            <p className="text-foreground-muted text-center py-8">
              No templates available. Create templates in Settings.
            </p>
          ) : (
            templates
              .filter((t) => t.is_active)
              .sort((a, b) => {
                // Get task types for both templates
                const typeA = taskTypes.find((tt) => tt.id === a.task_type_id);
                const typeB = taskTypes.find((tt) => tt.id === b.task_type_id);

                // Sort by task type sort_order first
                const sortOrderA = typeA?.sort_order ?? 999;
                const sortOrderB = typeB?.sort_order ?? 999;

                if (sortOrderA !== sortOrderB) {
                  return sortOrderA - sortOrderB;
                }

                // If same task type or no task type, sort by template name
                return a.name.localeCompare(b.name);
              })
              .map((template) => {
                const taskType = taskTypes.find(
                  (tt) => tt.id === template.task_type_id,
                );
                return (
                  <button
                    key={template.id}
                    onClick={() => onSelect(template)}
                    className="w-full text-left p-4 border border-bordercl rounded-lg hover:bg-surface-hover transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {taskType && (
                        <div
                          className="w-4 h-4 rounded"
                          style={{ backgroundColor: taskType.color }}
                        />
                      )}
                      <div>
                        <div className="font-medium">{template.name}</div>
                        {template.description && (
                          <div className="text-sm text-foreground-muted">
                            {template.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
          )}
        </div>
      </div>
    </div>
  );
}
