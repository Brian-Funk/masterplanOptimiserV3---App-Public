"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { RichTemplateEditor } from "@/components/RichTemplateEditor";
import {
  generalScheduleApi,
  type ScheduleView,
  type SessionElementType,
} from "@/lib/api";
import {
  DEFAULT_SESSION_ELEMENT_COLOUR,
  DEFAULT_SESSION_ELEMENT_COPY_TEMPLATE,
  GENERAL_SCHEDULE_VARIABLES,
  SESSION_ELEMENT_COLOUR_OPTIONS,
  getSessionElementColour,
} from "@/lib/generalSchedule";

type TypeForm = {
  id?: number;
  name: string;
  description: string;
  colour: string;
  sort_order: number;
  copy_template_html: string;
};

const blankTypeForm = (): TypeForm => ({
  name: "",
  description: "",
  colour: DEFAULT_SESSION_ELEMENT_COLOUR,
  sort_order: 0,
  copy_template_html: DEFAULT_SESSION_ELEMENT_COPY_TEMPLATE,
});

export function SessionElementTypesSection({ eventId }: { eventId?: number }) {
  const [types, setTypes] = useState<SessionElementType[]>([]);
  const [scheduleViews, setScheduleViews] = useState<ScheduleView[]>([]);
  const [form, setForm] = useState<TypeForm>(blankTypeForm());
  const [scheduleViewName, setScheduleViewName] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const variables = useMemo(
    () => GENERAL_SCHEDULE_VARIABLES.map((variable) => ({ ...variable })),
    [],
  );
  const selectedType = useMemo(
    () => types.find((type) => type.id === form.id) ?? null,
    [form.id, types],
  );

  const load = async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const [typeRows, viewRows] = await Promise.all([
        generalScheduleApi.getSessionElementTypes(eventId),
        generalScheduleApi.getScheduleViews(eventId),
      ]);
      setTypes(typeRows);
      setScheduleViews(viewRows);
      if (!form.id && typeRows.length > 0 && !form.name) {
        const first = typeRows[0];
        setForm({
          id: first.id,
          name: first.name,
          description: first.description || "",
          colour: getSessionElementColour(first.colour),
          sort_order: first.sort_order || 0,
          copy_template_html:
            first.copy_template_html || DEFAULT_SESSION_ELEMENT_COPY_TEMPLATE,
        });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load schedule item types.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const editType = (type: SessionElementType) => {
    setForm({
      id: type.id,
      name: type.name,
      description: type.description || "",
      colour: getSessionElementColour(type.colour),
      sort_order: type.sort_order || 0,
      copy_template_html:
        type.copy_template_html || DEFAULT_SESSION_ELEMENT_COPY_TEMPLATE,
    });
    setMessage("");
  };

  const saveType = async () => {
    if (!eventId) return;
    if (!form.name.trim()) {
      setMessage("Error: Name is required.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description || null,
        colour: form.colour,
        sort_order: form.sort_order,
        copy_template_html:
          form.copy_template_html || DEFAULT_SESSION_ELEMENT_COPY_TEMPLATE,
      };
      if (form.id) {
        await generalScheduleApi.updateSessionElementType(eventId, form.id, payload);
      } else {
        await generalScheduleApi.createSessionElementType(eventId, payload);
      }
      setMessage("Schedule item type saved.");
      setForm(blankTypeForm());
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? `Error: ${error.message}` : "Error: Could not save type.");
    } finally {
      setSaving(false);
    }
  };

  const deleteType = async (type: SessionElementType) => {
    if (!eventId || !window.confirm(`Delete "${type.name}"? This is only possible if no schedule items use it.`)) return;
    try {
      await generalScheduleApi.deleteSessionElementType(eventId, type.id);
      setForm(blankTypeForm());
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? `Error: ${error.message}` : "Error: Could not delete type.");
    }
  };

  const createScheduleView = async () => {
    if (!eventId || !scheduleViewName.trim()) return;
    try {
      await generalScheduleApi.createScheduleView(eventId, {
        name: scheduleViewName.trim(),
        sort_order: scheduleViews.length,
      });
      setScheduleViewName("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? `Error: ${error.message}` : "Error: Could not create schedule view.");
    }
  };

  const deleteScheduleView = async (view: ScheduleView) => {
    if (!eventId || !window.confirm(`Delete "${view.name}"? Schedule items assigned to this view will no longer appear there.`)) return;
    try {
      await generalScheduleApi.deleteScheduleView(eventId, view.id);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? `Error: ${error.message}` : "Error: Could not delete schedule view.");
    }
  };

  if (!eventId) {
    return (
      <div className="rounded-lg border border-bordercl bg-surface p-6 text-sm text-foreground-muted">
        Select an event to configure schedule item types.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {message && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            message.startsWith("Error")
              ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
              : "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300"
          }`}
        >
          {message}
        </div>
      )}

      <section>
        <h3 className="text-lg font-semibold text-foreground">Schedule Item Types</h3>
        <p className="mt-1 text-sm text-foreground-muted">
          Configure programme element types, their muted colour, and copied text format.
        </p>

        <div className="mt-4 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="rounded-lg border border-bordercl bg-surface p-3">
            {loading ? (
              <p className="p-3 text-sm text-foreground-muted">Loading...</p>
            ) : (
              <div className="space-y-1">
                {types.map((type) => (
                  <button
                    key={type.id}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${
                      form.id === type.id ? "bg-blue-50 text-blue-700 dark:bg-blue-950/30" : "hover:bg-surface-hover"
                    }`}
                    onClick={() => editType(type)}
                  >
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: getSessionElementColour(type.colour) }}
                    />
                    <span className="min-w-0 flex-1 truncate">{type.name}</span>
                  </button>
                ))}
                <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setForm(blankTypeForm())}>
                  New type
                </Button>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-bordercl bg-surface p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm font-medium text-foreground-secondary">Name</span>
                <input
                  className="w-full rounded-lg border border-bordercl-strong px-3 py-2 text-sm"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-foreground-secondary">Sort order</span>
                <input
                  type="number"
                  className="w-full rounded-lg border border-bordercl-strong px-3 py-2 text-sm"
                  value={form.sort_order}
                  onChange={(event) => setForm({ ...form, sort_order: Number(event.target.value) || 0 })}
                />
              </label>
              <label className="space-y-1 md:col-span-2">
                <span className="text-sm font-medium text-foreground-secondary">Description</span>
                <input
                  className="w-full rounded-lg border border-bordercl-strong px-3 py-2 text-sm"
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </label>
              <div className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium text-foreground-secondary">Colour</span>
                <div className="grid grid-cols-6 gap-2 rounded-lg border border-bordercl bg-surface-subtle p-2 md:grid-cols-11">
                  {SESSION_ELEMENT_COLOUR_OPTIONS.map((option) => {
                    const selected = form.colour === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        title={option.label}
                        aria-label={option.label}
                        aria-pressed={selected}
                        className={`h-9 rounded-md border transition ${
                          selected ? "border-foreground ring-2 ring-blue-500/30" : "border-bordercl hover:scale-[1.03]"
                        }`}
                        style={{ backgroundColor: option.value }}
                        onClick={() => setForm({ ...form, colour: option.value })}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium text-foreground-secondary">Copy format</span>
                <RichTemplateEditor
                  value={form.copy_template_html}
                  onChange={(value) => setForm({ ...form, copy_template_html: value })}
                  variables={variables}
                  primaryColor={form.colour}
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              {form.id && (
                <Button
                  variant="danger"
                  onClick={() => selectedType && deleteType(selectedType)}
                  disabled={!selectedType}
                >
                  Delete
                </Button>
              )}
              <Button onClick={saveType} disabled={saving}>
                {saving ? "Saving..." : "Save type"}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-foreground">Schedule Views</h3>
        <p className="mt-1 text-sm text-foreground-muted">
          Create the public schedule views that schedule items can be published into.
        </p>
        <div className="mt-4 rounded-lg border border-bordercl bg-surface p-4">
          <div className="flex flex-wrap gap-2">
            {scheduleViews.map((view) => (
              <span key={view.id} className="inline-flex items-center gap-2 rounded-full border border-bordercl px-3 py-1 text-sm">
                {view.name}
                <button className="text-foreground-muted hover:text-red-600" onClick={() => deleteScheduleView(view)}>
                  x
                </button>
              </span>
            ))}
          </div>
          <div className="mt-4 flex max-w-md gap-2">
            <input
              className="flex-1 rounded-lg border border-bordercl-strong px-3 py-2 text-sm"
              value={scheduleViewName}
              onChange={(event) => setScheduleViewName(event.target.value)}
              placeholder="New view, e.g. Delegates"
            />
            <Button variant="outline" onClick={createScheduleView}>
              Add view
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
