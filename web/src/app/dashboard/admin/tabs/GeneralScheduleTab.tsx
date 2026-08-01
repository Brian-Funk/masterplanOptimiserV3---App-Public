"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  Filter,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Search,
  Send,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button, Modal, Spinner, Tooltip } from "@/components/ui";
import {
  generalScheduleApi,
  locationsApi,
  mpBackendApi,
  personsApi,
  type AudienceTeam,
  type BulkScheduleAssignmentChange,
  type GeneralSchedulePublishState,
  type MpBackendSettings,
  type Location as EventLocation,
  type Person,
  type ScheduleView,
  type SessionElement,
  type SessionElementType,
} from "@/lib/api";
import { formatDateWithWeekday } from "@/lib/dateFormat";
import {
  buildGeneralSchedulePublicFingerprint,
  getSessionElementColour,
  getSessionElementType,
  getSessionElementLocation,
  getSessionElementTeamNames,
  isPublicSessionElementPublished,
  renderSessionElementsTemplateHtml,
  renderSessionElementsTemplateText,
  sanitizeGeneralScheduleHtml,
  sortSessionElements,
} from "@/lib/generalSchedule";
import {
  getActualDateForWorkingSlot,
  getScheduleDayBoundaryFromRange,
  getWorkingDayForDateTime,
} from "@/lib/workingDayBoundary";
import { useToast } from "@/contexts/ToastContext";
import { useShortcuts } from "@/contexts/ShortcutContext";
import { confidenceClasses, type ConfidenceLevel } from "@/lib/confidence";
import { isEditableTarget } from "@/lib/shortcuts";
import {
  GENERAL_SCHEDULE_IMPORT_HEADER,
  parseGeneralScheduleSpreadsheet,
} from "@/lib/generalScheduleImport";
import { PermittedDataInputNotice } from "@/components/PermittedDataInputNotice";

type GeneralScheduleTabProps = {
  selectedEvent: any;
  initialSelectedDate?: string;
  onManageAudienceTeams?: () => void;
};

type ElementFormState = {
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  session_element_type_id: string;
  location_id: string;
  responsible_person_id: string;
  responsible_text: string;
  attendee_team_ids: number[];
  schedule_view_ids: number[];
  description: string;
};

const blankForm = (date: string): ElementFormState => ({
  title: "",
  date,
  start_time: "09:00",
  end_time: "10:00",
  location_id: "",
  responsible_person_id: "",
  responsible_text: "",
  attendee_team_ids: [],
  schedule_view_ids: [],
  session_element_type_id: "",
  description: "",
});

function eventDates(event: any): string[] {
  if (!event?.start_date || !event?.end_date) return [];
  const [startYear, startMonth, startDay] = event.start_date.split("-").map(Number);
  const [endYear, endMonth, endDay] = event.end_date.split("-").map(Number);
  const start = new Date(startYear, startMonth - 1, startDay);
  const end = new Date(endYear, endMonth - 1, endDay);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const result: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    const day = String(cursor.getDate()).padStart(2, "0");
    result.push(`${year}-${month}-${day}`);
  }
  return result;
}

function teamLabel(team: AudienceTeam): string {
  return team.short_name || team.name;
}

function personLabel(person: Person): string {
  return `${person.first_name} ${person.last_name}`.trim();
}

/** Manage and publish the event's public programme without exposing task data. */
export function GeneralScheduleTab({
  selectedEvent,
  initialSelectedDate = "",
  onManageAudienceTeams,
}: GeneralScheduleTabProps) {
  const { addToast } = useToast();
  const { matchesShortcut } = useShortcuts();
  const [teams, setTeams] = useState<AudienceTeam[]>([]);
  const [scheduleViews, setScheduleViews] = useState<ScheduleView[]>([]);
  const [types, setTypes] = useState<SessionElementType[]>([]);
  const [elements, setElements] = useState<SessionElement[]>([]);
  const [locations, setLocations] = useState<EventLocation[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [publishState, setPublishState] =
    useState<GeneralSchedulePublishState | null>(null);
  const [dayFingerprints, setDayFingerprints] = useState<Record<string, string>>({});
  const [mpBackendSettings, setMpBackendSettings] = useState<MpBackendSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [copyTargetDates, setCopyTargetDates] = useState<string[]>([]);
  const [editingElement, setEditingElement] = useState<SessionElement | null>(null);
  const [form, setForm] = useState<ElementFormState>(blankForm(""));
  const [modalOpen, setModalOpen] = useState(false);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copyScope, setCopyScope] = useState<"current" | "all">("current");
  const [copyTypeIds, setCopyTypeIds] = useState<number[]>([]);
  const [copyFallbackText, setCopyFallbackText] = useState("");
  const [copyFallbackHtml, setCopyFallbackHtml] = useState("");
  const [showPublishDropdown, setShowPublishDropdown] = useState(false);
  const [publishPreviewScope, setPublishPreviewScope] = useState<"selected" | "all" | null>(null);
  const [bulkEditorOpen, setBulkEditorOpen] = useState(false);
  const [bulkViewIds, setBulkViewIds] = useState<number[]>([]);
  const [bulkTeamIds, setBulkTeamIds] = useState<number[]>([]);
  const [bulkViewEnabled, setBulkViewEnabled] = useState(false);
  const [bulkTeamEnabled, setBulkTeamEnabled] = useState(false);
  const [bulkViewOperation, setBulkViewOperation] = useState<BulkScheduleAssignmentChange["operation"]>("add");
  const [bulkTeamOperation, setBulkTeamOperation] = useState<BulkScheduleAssignmentChange["operation"]>("add");
  const [bulkTypeEnabled, setBulkTypeEnabled] = useState(false);
  const [bulkTypeId, setBulkTypeId] = useState("");
  const [bulkLocationEnabled, setBulkLocationEnabled] = useState(false);
  const [bulkLocationId, setBulkLocationId] = useState("");
  const [bulkDateEnabled, setBulkDateEnabled] = useState(false);
  const [bulkWorkingDate, setBulkWorkingDate] = useState("");
  const [bulkShiftEnabled, setBulkShiftEnabled] = useState(false);
  const [bulkShiftMinutes, setBulkShiftMinutes] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTypeId, setFilterTypeId] = useState("");
  const [filterViewId, setFilterViewId] = useState("");
  const [filterTeamId, setFilterTeamId] = useState("");
  const [duplicateDayOpen, setDuplicateDayOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [includeImportDuplicates, setIncludeImportDuplicates] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [initialForm, setInitialForm] = useState<ElementFormState | null>(null);

  const dates = useMemo(() => eventDates(selectedEvent), [selectedEvent]);
  const scheduleDayBoundary = useMemo(
    () => getScheduleDayBoundaryFromRange(selectedEvent?.meta_data?.schedule_day_range),
    [
      selectedEvent?.meta_data?.schedule_day_range?.startHour,
      selectedEvent?.meta_data?.schedule_day_range?.endHour,
    ],
  );

  const load = useCallback(async () => {
    if (!selectedEvent?.id) return;
    setLoading(true);
    try {
      const [typeRows, teamRows, viewRows, elementRows, locationRows, personRows, state, backendSettings] = await Promise.all([
        generalScheduleApi.getSessionElementTypes(selectedEvent.id),
        generalScheduleApi.getTeams(selectedEvent.id),
        generalScheduleApi.getScheduleViews(selectedEvent.id),
        generalScheduleApi.getElements(selectedEvent.id),
        locationsApi.getAll(selectedEvent.id),
        personsApi.getAll(selectedEvent.id),
        generalScheduleApi.getPublishState(selectedEvent.id),
        mpBackendApi.getSettings(selectedEvent.id),
      ]);
      setTypes(typeRows);
      setTeams(teamRows);
      setScheduleViews(viewRows);
      setElements(elementRows);
      setLocations(locationRows);
      setPersons(personRows);
      setPublishState(state);
      setMpBackendSettings(backendSettings);
      const requestedDate =
        initialSelectedDate && dates.includes(initialSelectedDate)
          ? initialSelectedDate
          : "";
      const firstDate = requestedDate || dates[0] || selectedEvent.start_date || "";
      setSelectedDate((current) => (current && dates.includes(current) ? current : firstDate));
      setCopyTargetDates((current) =>
        current.length > 0
          ? current.filter((date) => dates.includes(date) && date !== firstDate)
          : [],
      );
      setCopyTypeIds((current) => {
        if (current.length === 0) return typeRows.map((type) => type.id);
        return current.filter((id) => typeRows.some((type) => type.id === id));
      });
    } catch (error) {
      addToast(
        error instanceof Error ? error.message : "Could not load General Schedule",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [addToast, dates, initialSelectedDate, selectedEvent]);

  const refreshElements = useCallback(async () => {
    if (!selectedEvent?.id) return;
    const rows = await generalScheduleApi.getElements(selectedEvent.id);
    setElements(rows);
  }, [selectedEvent?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setModalOpen(false);
    setEditingElement(null);
    setInitialForm(null);
    setSelectedIds([]);
    setSearchQuery("");
    setFilterTypeId("");
    setFilterViewId("");
    setFilterTeamId("");
  }, [selectedEvent?.id]);

  useEffect(() => {
    if (!initialSelectedDate || !dates.includes(initialSelectedDate)) return;
    setSelectedDate(initialSelectedDate);
    setSelectedIds([]);
  }, [dates, initialSelectedDate]);

  useEffect(() => {
    setCopyTargetDates((current) =>
      current.filter((date) => date !== selectedDate),
    );
  }, [selectedDate]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      dates.map(async (dayId) => {
        const dayElements = elements.filter(
          (element) =>
            getWorkingDayForDateTime(
              element.date,
              element.start_time,
              scheduleDayBoundary,
            ) === dayId,
        );
        return [
          dayId,
          await buildGeneralSchedulePublicFingerprint(
            dayElements,
            teams,
            locations,
            persons,
            types,
            scheduleViews,
          ),
        ] as const;
      }),
    ).then((dayEntries) => {
      if (!cancelled) {
        setDayFingerprints(Object.fromEntries(dayEntries));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dates, elements, locations, persons, scheduleDayBoundary, scheduleViews, teams, types]);

  const dayElements = useMemo(() => {
    return sortSessionElements(elements).filter((element) => {
      const workingDate = getWorkingDayForDateTime(
        element.date,
        element.start_time,
        scheduleDayBoundary,
      );
      if (selectedDate && workingDate !== selectedDate) return false;
      return true;
    });
  }, [elements, scheduleDayBoundary, selectedDate]);

  const filteredElements = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    const typeId = filterTypeId ? Number(filterTypeId) : null;
    const viewId = filterViewId ? Number(filterViewId) : null;
    const teamId = filterTeamId ? Number(filterTeamId) : null;
    return dayElements.filter((element) => {
      if (typeId && element.session_element_type_id !== typeId) return false;
      if (viewId && !(element.schedule_view_ids || []).includes(viewId)) return false;
      if (teamId && !(element.attendee_team_ids || []).includes(teamId)) return false;
      if (!query) return true;
      const typeName = getSessionElementType(element, types)?.name || "";
      const locationName = getSessionElementLocation(element, locations) || "";
      return [element.title, typeName, locationName, element.description || ""]
        .some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [
    dayElements,
    filterTeamId,
    filterTypeId,
    filterViewId,
    locations,
    searchQuery,
    types,
  ]);

  const getDayInfo = useCallback(
    (date: string) => {
      if (!selectedEvent || !date) return null;
      const startIndex = dates.indexOf(selectedEvent.start_date);
      const currentIndex = dates.indexOf(date);
      const dayNumber =
        startIndex >= 0 && currentIndex >= 0
          ? currentIndex - startIndex + 1
          : currentIndex + 1;
      const alias = selectedEvent.meta_data?.day_aliases?.[date] || null;
      const formattedDate = formatDateWithWeekday(date);
      return { dayNumber, alias, formattedDate };
    },
    [dates, selectedEvent],
  );

  const selectedDayInfo = getDayInfo(selectedDate);
  const selectedDayLabel = selectedDayInfo?.alias
    ? `${selectedDayInfo.alias} (Day ${selectedDayInfo.dayNumber}) - ${selectedDayInfo.formattedDate}`
    : selectedDayInfo?.formattedDate || selectedDate;

  const publicCount = useMemo(
    () => elements.filter(isPublicSessionElementPublished).length,
    [elements],
  );
  const selectedPublicCount = useMemo(
    () => dayElements.filter(isPublicSessionElementPublished).length,
    [dayElements],
  );
  const selectedExcludedCount = dayElements.length - selectedPublicCount;
  const excludedCount = elements.length - publicCount;

  const publishStatus = useMemo<{
    level: ConfidenceLevel;
    label: string;
    description: string;
  }>(() => {
    if (!mpBackendSettings?.configured) {
      return {
        level: "blocked",
        label: "MP-Backend unavailable",
        description: "Configure MP-Backend in Settings before publishing.",
      };
    }
    const record = publishState?.day_records?.[selectedDate];
    if (record?.publish_failed_at) {
      return {
        level: "review",
        label: "Previous publish failed",
        description: record.failure_message
          ? `${record.failure_message} Retrying is allowed.`
          : "Retrying is allowed.",
      };
    }
    if (!record?.fingerprint) {
      return {
        level: "unknown",
        label: "Unpublished",
        description: "This working day has not been published yet.",
      };
    }
    if (dayFingerprints[selectedDate] === record.fingerprint) {
      return {
        level: "ready",
        label: "Up to date",
        description: record.published_at
          ? `Published ${new Date(record.published_at).toLocaleString()}.`
          : "The published day matches the current programme.",
      };
    }
    return {
      level: "review",
      label: "Changes pending",
      description: "The selected day has changed since it was last published.",
    };
  }, [dayFingerprints, mpBackendSettings?.configured, publishState, selectedDate]);
  const publishButtonLevel: ConfidenceLevel = mpBackendSettings?.configured
    ? "ready"
    : "blocked";

  const copyElements = useMemo(() => {
    const source = copyScope === "current" ? filteredElements : sortSessionElements(elements);
    const typeSet = new Set(copyTypeIds);
    return source.filter((element) => {
      if (typeSet.size === 0) return true;
      return element.session_element_type_id
        ? typeSet.has(element.session_element_type_id)
        : true;
    });
  }, [copyScope, copyTypeIds, elements, filteredElements]);

  const importPreview = useMemo(
    () => parseGeneralScheduleSpreadsheet(importText, {
      eventStart: selectedEvent?.start_date || "",
      eventEnd: selectedEvent?.end_date || "",
      boundary: scheduleDayBoundary,
      types,
      locations,
      views: scheduleViews,
      teams,
      existing: elements,
    }),
    [
      elements,
      importText,
      locations,
      scheduleDayBoundary,
      scheduleViews,
      selectedEvent?.end_date,
      selectedEvent?.start_date,
      teams,
      types,
    ],
  );
  const importableRows = useMemo(
    () => importPreview.rows.filter(
      (row) => row.payload && row.errors.length === 0 && (includeImportDuplicates || !row.duplicate),
    ),
    [importPreview.rows, includeImportDuplicates],
  );

  const importSpreadsheet = async () => {
    if (!selectedEvent?.id || importableRows.length === 0) return;
    setSaving(true);
    try {
      const created = await generalScheduleApi.bulkCreateElements(
        selectedEvent.id,
        importableRows.map((row) => row.payload!),
      );
      setElements((current) => [...current, ...created]);
      setImportOpen(false);
      setImportText("");
      setIncludeImportDuplicates(false);
      addToast(`Imported ${created.length} schedule item(s).`, "success");
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Could not import schedule items", "error");
    } finally {
      setSaving(false);
    }
  };

  const editorDirty = Boolean(
    initialForm && JSON.stringify(initialForm) !== JSON.stringify(form),
  );

  const confirmDiscardEditor = (): boolean =>
    !editorDirty || window.confirm("Discard unsaved schedule item changes?");

  const closeEditor = () => {
    if (!confirmDiscardEditor()) return;
    setModalOpen(false);
    setEditingElement(null);
    setInitialForm(null);
  };

  const openScheduleSettings = () => {
    if (!confirmDiscardEditor()) return;
    window.location.assign("/dashboard/settings?section=session-element-types");
  };

  const openAudienceManagement = () => {
    if (!confirmDiscardEditor()) return;
    onManageAudienceTeams?.();
  };

  const createFormAfter = useCallback((date: string, predecessor?: SessionElement | null) => {
    const lastEnd = predecessor?.end_time || "09:00";
    const [hour, minute] = lastEnd.split(":").map(Number);
    const startMinutes = Number.isFinite(hour * 60 + minute) ? hour * 60 + minute : 9 * 60;
    const safeStart = startMinutes <= 22 * 60 + 59 ? startMinutes : 9 * 60;
    const endMinutes = safeStart + 60;
    const startTime = `${String(Math.floor(safeStart / 60)).padStart(2, "0")}:${String(safeStart % 60).padStart(2, "0")}`;
    const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
    return {
      ...blankForm(date),
      start_time: startTime,
      end_time: endTime,
      session_element_type_id: predecessor?.session_element_type_id
        ? String(predecessor.session_element_type_id)
        : (types[0]?.id ? String(types[0].id) : ""),
      location_id: predecessor?.location_id ? String(predecessor.location_id) : "",
      schedule_view_ids: [...(predecessor?.schedule_view_ids || [])],
      attendee_team_ids: [...(predecessor?.attendee_team_ids || [])],
    };
  }, [types]);

  const openCreate = (predecessor?: SessionElement | null) => {
    if (!confirmDiscardEditor()) return;
    const date = selectedDate || dates[0] || selectedEvent?.start_date || "";
    const nextForm = createFormAfter(date, predecessor || dayElements.at(-1));
    setEditingElement(null);
    setEditorError("");
    setForm(nextForm);
    setInitialForm(nextForm);
    setModalOpen(true);
  };

  const openEdit = (element: SessionElement) => {
    if (!confirmDiscardEditor()) return;
    const workingDate =
      getWorkingDayForDateTime(
        element.date,
        element.start_time,
        scheduleDayBoundary,
      ) || element.date;
    const nextForm = {
      title: element.title,
      date: workingDate,
      start_time: element.start_time,
      end_time: element.end_time,
      session_element_type_id: element.session_element_type_id ? String(element.session_element_type_id) : (types[0]?.id ? String(types[0].id) : ""),
      location_id: element.location_id ? String(element.location_id) : "",
      responsible_person_id: element.responsible_person_id ? String(element.responsible_person_id) : "",
      responsible_text: element.responsible_text || "",
      attendee_team_ids: element.attendee_team_ids || [],
      schedule_view_ids: element.schedule_view_ids || [],
      description: element.description || "",
    };
    setEditingElement(element);
    setEditorError("");
    setForm(nextForm);
    setInitialForm(nextForm);
    setModalOpen(true);
  };

  const saveElement = async (addAnother = false) => {
    if (!selectedEvent?.id) return;
    if (form.end_time <= form.start_time) {
      setEditorError("End time must be after start time.");
      return;
    }
    setEditorError("");
    setSaving(true);
    try {
      const actualDate = getActualDateForWorkingSlot(
        form.date,
        form.start_time,
        scheduleDayBoundary,
      );
      const payload = {
        ...form,
        date: actualDate,
        session_element_type_id: form.session_element_type_id ? Number(form.session_element_type_id) : null,
        location_id: form.location_id ? Number(form.location_id) : null,
        responsible_person_id: form.responsible_person_id ? Number(form.responsible_person_id) : null,
        responsible_text: form.responsible_text || null,
        description: form.description || null,
        schedule_view_ids: form.schedule_view_ids,
        attendee_team_ids: form.attendee_team_ids,
        visibility: "public" as const,
      };
      const saved = editingElement
        ? await generalScheduleApi.updateElement(selectedEvent.id, editingElement.id, payload)
        : await generalScheduleApi.createElement(selectedEvent.id, payload);
      setElements((current) => {
        const exists = current.some((element) => element.id === saved.id);
        return exists
          ? current.map((element) => element.id === saved.id ? saved : element)
          : [...current, saved];
      });
      if (addAnother) {
        const workingDate = getWorkingDayForDateTime(
          saved.date,
          saved.start_time,
          scheduleDayBoundary,
        ) || form.date;
        const nextForm = createFormAfter(workingDate, saved);
        setEditingElement(null);
        setForm(nextForm);
        setInitialForm(nextForm);
        setModalOpen(true);
      } else {
        setModalOpen(false);
        setEditingElement(null);
        setInitialForm(null);
      }
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Could not save schedule item");
      addToast(
        error instanceof Error ? error.message : "Could not save schedule item",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!selectedEvent?.id || selectedIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedIds.length} schedule item(s)?`)) return;
    try {
      await Promise.all(
        selectedIds.map((id) => generalScheduleApi.deleteElement(selectedEvent.id, id)),
      );
      const deleted = new Set(selectedIds);
      setElements((current) => current.filter((element) => !deleted.has(element.id)));
      setSelectedIds([]);
      addToast(`Deleted ${deleted.size} schedule item(s).`, "success");
    } catch (error) {
      await refreshElements();
      addToast(error instanceof Error ? error.message : "Could not delete schedule items", "error");
    }
  };

  const copySelected = async () => {
    const targetDates = copyTargetDates;
    if (!selectedEvent?.id || selectedIds.length === 0 || targetDates.length === 0) return;
    const copiedCount = selectedIds.length * targetDates.length;
    try {
      const copied = await generalScheduleApi.copyElements(selectedEvent.id, selectedIds, targetDates);
      setElements((current) => [...current, ...copied]);
      setSelectedIds([]);
      setCopyTargetDates([]);
      addToast(`Copied ${copiedCount} schedule item(s).`, "success");
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Could not copy schedule items", "error");
    }
  };

  const duplicateSelectedDay = async () => {
    if (!selectedEvent?.id || dayElements.length === 0 || copyTargetDates.length === 0) return;
    setSaving(true);
    try {
      const copied = await generalScheduleApi.copyElements(
        selectedEvent.id,
        dayElements.map((element) => element.id),
        copyTargetDates,
      );
      setElements((current) => [...current, ...copied]);
      addToast(`Copied ${copied.length} schedule item(s) to ${copyTargetDates.length} day(s).`, "success");
      setCopyTargetDates([]);
      setDuplicateDayOpen(false);
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Could not duplicate this day", "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteElement = async (element: SessionElement) => {
    if (!selectedEvent?.id) return;
    if (!window.confirm(`Delete "${element.title}"?`)) return;
    if (editingElement?.id === element.id) {
      setModalOpen(false);
      setEditingElement(null);
      setInitialForm(null);
    }
    try {
      await generalScheduleApi.deleteElement(selectedEvent.id, element.id);
      setElements((current) => current.filter((candidate) => candidate.id !== element.id));
      addToast(`Deleted ${element.title}.`, "success");
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Could not delete schedule item", "error");
    }
  };

  const duplicateElement = async (element: SessionElement) => {
    if (!selectedEvent?.id) return;
    try {
      const duplicate = await generalScheduleApi.duplicateElement(
        selectedEvent.id,
        element.id,
      );
      setElements((current) => [...current, duplicate]);
      addToast(`Duplicated ${element.title}.`, "success");
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Could not duplicate schedule item", "error");
    }
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (modalOpen && matchesShortcut(event, "generalSchedule.saveAndAdd")) {
        event.preventDefault();
        if (!saving && form.title.trim() && form.start_time && form.end_time) {
          void saveElement(true);
        }
        return;
      }
      if (modalOpen && matchesShortcut(event, "generalSchedule.saveItem")) {
        event.preventDefault();
        if (!saving && form.title.trim() && form.start_time && form.end_time) {
          void saveElement(false);
        }
        return;
      }
      if (!modalOpen && !isEditableTarget(event.target) && selectedIds.length === 1 && matchesShortcut(event, "generalSchedule.duplicateSelected")) {
        event.preventDefault();
        const selected = elements.find((element) => element.id === selectedIds[0]);
        if (selected) void duplicateElement(selected);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [elements, form, matchesShortcut, modalOpen, saving, selectedIds]);

  const openBulkEditor = () => {
    const selectedElements = elements.filter((element) =>
      selectedIds.includes(element.id),
    );
    const commonIds = (key: "schedule_view_ids" | "attendee_team_ids") => {
      const [first, ...rest] = selectedElements;
      if (!first) return [];
      return (first[key] || []).filter((id) =>
        rest.every((element) => (element[key] || []).includes(id)),
      );
    };
    setBulkViewIds(commonIds("schedule_view_ids"));
    setBulkTeamIds(commonIds("attendee_team_ids"));
    setBulkViewEnabled(false);
    setBulkTeamEnabled(false);
    setBulkViewOperation("add");
    setBulkTeamOperation("add");
    setBulkTypeEnabled(false);
    setBulkTypeId("");
    setBulkLocationEnabled(false);
    setBulkLocationId("");
    setBulkDateEnabled(false);
    setBulkWorkingDate(selectedDate);
    setBulkShiftEnabled(false);
    setBulkShiftMinutes(0);
    setBulkEditorOpen(true);
  };

  const toggleCopyTargetDate = (date: string) => {
    setCopyTargetDates((current) =>
      current.includes(date)
        ? current.filter((candidate) => candidate !== date)
        : [...current, date],
    );
  };

  const applyBulkChanges = async () => {
    if (!selectedEvent?.id || selectedIds.length === 0) return;
    if (!bulkViewEnabled && !bulkTeamEnabled && !bulkTypeEnabled && !bulkLocationEnabled && !bulkDateEnabled && !bulkShiftEnabled) {
      addToast("Choose at least one field to change.", "info");
      return;
    }
    if (bulkTypeEnabled && !bulkTypeId) {
      addToast("Choose the schedule item type to apply.", "info");
      return;
    }
    setSaving(true);
    try {
      const updated = await generalScheduleApi.bulkUpdateElements(selectedEvent.id, selectedIds, {
        ...(bulkViewEnabled ? { schedule_view_change: { operation: bulkViewOperation, ids: bulkViewIds } } : {}),
        ...(bulkTeamEnabled ? { attendee_team_change: { operation: bulkTeamOperation, ids: bulkTeamIds } } : {}),
        ...(bulkTypeEnabled && bulkTypeId ? { session_element_type_id: Number(bulkTypeId) } : {}),
        ...(bulkLocationEnabled ? { location_id: bulkLocationId ? Number(bulkLocationId) : null } : {}),
        ...(bulkDateEnabled && bulkWorkingDate ? { working_date: bulkWorkingDate } : {}),
        ...(bulkShiftEnabled ? { shift_minutes: bulkShiftMinutes } : {}),
      });
      const updatedById = new Map(updated.map((element) => [element.id, element]));
      setElements((current) => current.map((element) => updatedById.get(element.id) || element));
      setBulkEditorOpen(false);
      setSelectedIds([]);
      addToast("Selected schedule items updated.", "success");
    } catch (error) {
      addToast(
        error instanceof Error ? error.message : "Could not update schedule items",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const publish = async (scope: "selected" | "all") => {
    if (!selectedEvent?.id || (scope === "selected" && !selectedDate)) return;
    setPublishing(true);
    try {
      const publishDates = scope === "selected" ? [selectedDate] : undefined;
      const result = await mpBackendApi.publishGeneralSchedule(
        selectedEvent.id,
        publishDates,
      );
      setPublishState(await generalScheduleApi.getPublishState(selectedEvent.id));
      setPublishPreviewScope(null);
      addToast(
        `${result.items_published} public item(s) published to MP-Backend.`,
        "success",
      );
    } catch (error) {
      setPublishState(await generalScheduleApi.getPublishState(selectedEvent.id).catch(() => publishState));
      addToast(
        error instanceof Error ? error.message : "Could not publish General Schedule",
        "error",
      );
    } finally {
      setPublishing(false);
    }
  };

  const copyExport = async () => {
    const html = renderSessionElementsTemplateHtml(
      copyElements,
      teams,
      locations,
      persons,
      types,
    );
    const output = renderSessionElementsTemplateText(
      copyElements,
      teams,
      locations,
      persons,
      types,
    );
    try {
      if ("ClipboardItem" in window && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([output], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(output);
      }
      addToast("Public General Schedule copied.", "success");
      setCopyModalOpen(false);
    } catch {
      setCopyFallbackText(output);
      setCopyFallbackHtml(html);
      addToast("Clipboard permission was denied. Use the copy text box instead.", "info");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-foreground">General Schedule</h3>
            <Tooltip content={publishStatus.description} side="bottom">
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-medium ${confidenceClasses(
                  publishStatus.level,
                  "text",
                )}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${confidenceClasses(
                    publishStatus.level,
                    "dot",
                  )}`}
                />
                {publishStatus.label}
              </span>
            </Tooltip>
          </div>
          <p className="mt-0.5 text-xs text-foreground-muted">
            {selectedDayLabel} / {dayElements.length} item(s) / {selectedPublicCount} assigned to a public view
          </p>
        </div>

        <div className="flex items-center gap-2">
          <details className="relative">
            <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-bordercl px-2.5 text-sm font-medium text-foreground-secondary hover:bg-surface-hover">
              <MoreHorizontal className="h-4 w-4" /> More
            </summary>
            <div className="absolute right-0 z-30 mt-1 min-w-60 rounded-md border border-bordercl bg-surface py-1 shadow-lg">
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground-secondary hover:bg-surface-hover"
                onClick={() => setCopyModalOpen(true)}
              >
                <Copy className="h-4 w-4" /> Copy public programme
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground-secondary hover:bg-surface-hover"
                onClick={() => {
                  setImportText((current) => current || `${GENERAL_SCHEDULE_IMPORT_HEADER}\n`);
                  setImportOpen(true);
                }}
              >
                <Upload className="h-4 w-4" /> Paste from spreadsheet
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground-secondary hover:bg-surface-hover"
                onClick={openScheduleSettings}
              >
                <Settings2 className="h-4 w-4" /> Manage item types and public views
              </button>
              {onManageAudienceTeams && (
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground-secondary hover:bg-surface-hover"
                  onClick={openAudienceManagement}
                >
                  <Settings2 className="h-4 w-4" /> Manage audiences
                </button>
              )}
            </div>
          </details>
          <div className="relative">
            <div className="flex">
              <Tooltip content={`Review and publish ${selectedDayLabel}`} side="bottom">
                <button
                  onClick={() => setPublishPreviewScope("selected")}
                  disabled={!mpBackendSettings?.configured || !selectedDate || publishing}
                  className={`flex items-center gap-1 rounded-l-md px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${confidenceClasses(
                    publishButtonLevel,
                    "button",
                  )}`}
                >
                  <Send className="h-3.5 w-3.5" />
                  {publishing ? "Publishing..." : "Publish"}
                </button>
              </Tooltip>
              <Tooltip content="More publish options" side="bottom">
                <button
                  onClick={() => setShowPublishDropdown((current) => !current)}
                  disabled={!mpBackendSettings?.configured || publishing}
                  className={`rounded-r-md border-l border-white/30 px-1.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${confidenceClasses(
                    publishButtonLevel,
                    "button",
                  )}`}
                  aria-label="More publish options"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>
            {showPublishDropdown && (
              <>
                <button
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setShowPublishDropdown(false)}
                  aria-label="Close publish options"
                />
                <div className="absolute right-0 z-20 mt-1 min-w-48 rounded-md border border-bordercl bg-surface py-1 shadow-lg">
                  <button
                    onClick={() => {
                      setShowPublishDropdown(false);
                      setPublishPreviewScope("selected");
                    }}
                    disabled={!selectedDate}
                    className="w-full px-3 py-2 text-left text-sm text-foreground-secondary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Publish selected day
                  </button>
                  <button
                    onClick={() => {
                      setShowPublishDropdown(false);
                      setPublishPreviewScope("all");
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-foreground-secondary hover:bg-surface-hover"
                  >
                    Publish all days
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <section className="overflow-hidden rounded-md border border-bordercl bg-surface">
        <div className="overflow-x-auto border-b border-bordercl bg-surface-subtle px-3 pt-2">
          <div className="flex min-w-max gap-1" role="tablist" aria-label="Event working days">
            {dates.map((date) => {
              const info = getDayInfo(date);
              const count = elements.filter((element) =>
                getWorkingDayForDateTime(element.date, element.start_time, scheduleDayBoundary) === date,
              ).length;
              const record = publishState?.day_records?.[date];
              const isCurrent = selectedDate === date;
              const statusLabel = record?.publish_failed_at
                ? "previous publish failed"
                : record?.fingerprint && dayFingerprints[date] === record.fingerprint
                  ? "up to date"
                  : record?.fingerprint
                    ? "changes pending"
                    : "unpublished";
              const statusClass = record?.publish_failed_at
                ? "bg-red-500"
                : statusLabel === "up to date"
                  ? "bg-green-500"
                  : statusLabel === "changes pending"
                    ? "bg-amber-500"
                    : "bg-gray-400";
              return (
                <button
                  key={date}
                  role="tab"
                  aria-selected={isCurrent}
                  aria-label={`${formatDateWithWeekday(date)}: ${count} item(s), ${statusLabel}`}
                  title={`${count} item(s), ${statusLabel}`}
                  onClick={() => {
                    if (!confirmDiscardEditor()) return;
                    setModalOpen(false);
                    setEditingElement(null);
                    setInitialForm(null);
                    setSelectedDate(date);
                    setSelectedIds([]);
                  }}
                  className={`flex items-center gap-2 rounded-t-md border border-b-0 px-3 py-2 text-left text-xs ${
                    isCurrent
                      ? "border-bordercl bg-surface font-medium text-foreground"
                      : "border-transparent text-foreground-muted hover:bg-surface-hover"
                  }`}
                >
                  <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${statusClass}`} />
                  <span>{info?.alias || `Day ${info?.dayNumber || ""}`}</span>
                  <span className="rounded-full bg-surface-hover px-1.5 py-0.5 text-[10px]">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bordercl px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-foreground-muted" />
              <input
                className="w-52 rounded-md border border-bordercl bg-surface py-1.5 pl-8 pr-2 text-xs"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Find schedule items"
                aria-label="Find schedule items"
              />
            </div>
            <Filter className="h-3.5 w-3.5 text-foreground-muted" />
            <select className="rounded-md border border-bordercl bg-surface px-2 py-1.5 text-xs" value={filterTypeId} onChange={(event) => setFilterTypeId(event.target.value)} aria-label="Filter by item type">
              <option value="">All types</option>
              {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
            <select className="rounded-md border border-bordercl bg-surface px-2 py-1.5 text-xs" value={filterViewId} onChange={(event) => setFilterViewId(event.target.value)} aria-label="Filter by public view">
              <option value="">All public views</option>
              {scheduleViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
            </select>
            <select className="rounded-md border border-bordercl bg-surface px-2 py-1.5 text-xs" value={filterTeamId} onChange={(event) => setFilterTeamId(event.target.value)} aria-label="Filter by audience">
              <option value="">All audiences</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{teamLabel(team)}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setDuplicateDayOpen(true)} disabled={dayElements.length === 0}>
              <CalendarDays className="h-3.5 w-3.5" /> Duplicate day
            </Button>
            <Button size="sm" onClick={() => openCreate()}>
              <Plus className="h-3.5 w-3.5" /> Add schedule item
            </Button>
          </div>
        </div>

        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-bordercl bg-surface-subtle px-3 py-2 text-xs">
            <span className="font-medium text-foreground-secondary">
              {selectedIds.length} selected
            </span>
            <Button variant="outline" size="sm" onClick={openBulkEditor}>
              <Settings2 className="h-3.5 w-3.5" /> Edit selected
            </Button>
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-md border border-bordercl px-3 py-1.5 text-sm font-medium text-foreground-secondary hover:bg-surface-hover">
                <span className="inline-flex items-center gap-1.5">
                  <Copy className="h-3.5 w-3.5" /> Copy to days
                </span>
              </summary>
              <div className="absolute left-0 z-20 mt-1 w-72 rounded-md border border-bordercl bg-surface p-3 shadow-lg">
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {dates.filter((date) => date !== selectedDate).map((date) => (
                    <label key={date} className="flex items-center gap-2 text-sm text-foreground-secondary">
                      <input
                        type="checkbox"
                        checked={copyTargetDates.includes(date)}
                        onChange={() => toggleCopyTargetDate(date)}
                      />
                      {formatDateWithWeekday(date)}
                    </label>
                  ))}
                </div>
                <Button
                  className="mt-3"
                  size="sm"
                  fullWidth
                  onClick={copySelected}
                  disabled={copyTargetDates.length === 0}
                >
                  Copy selected
                </Button>
              </div>
            </details>
            <Button variant="danger" size="sm" onClick={deleteSelected}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        )}

        <div className={modalOpen ? "grid lg:grid-cols-[minmax(0,1fr)_22rem]" : ""}>
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-surface-subtle text-xs text-foreground-muted">
                <tr>
                  <th className="w-10 px-3 py-2 font-medium">
                    <input
                      type="checkbox"
                      aria-label="Select all schedule items for this day"
                      checked={
                        filteredElements.length > 0 &&
                        filteredElements.every((element) => selectedIds.includes(element.id))
                      }
                      onChange={(event) =>
                        setSelectedIds(
                          event.target.checked
                            ? filteredElements.map((element) => element.id)
                            : [],
                        )
                      }
                    />
                  </th>
                  <th className="w-48 px-2 py-2 font-medium">Time</th>
                  <th className="px-2 py-2 font-medium">Schedule item</th>
                  <th className="w-32 px-2 py-2 font-medium">Location</th>
                  <th className="w-36 px-2 py-2 font-medium">Views</th>
                  <th className="w-36 px-2 py-2 font-medium">Audience</th>
                  <th className="w-28 px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bordercl">
                {filteredElements.map((element) => {
                  const selected = selectedIds.includes(element.id);
                  const sessionType = getSessionElementType(element, types);
                  const location = getSessionElementLocation(element, locations);
                  const audience = getSessionElementTeamNames(element, teams).join(", ");
                  const assignedViews = (element.schedule_view_ids || [])
                    .map((viewId) => scheduleViews.find((view) => view.id === viewId)?.name)
                    .filter(Boolean)
                    .join(", ");
                  if (editingElement?.id === element.id && modalOpen) {
                    return (
                      <tr key={element.id} className="bg-blue-50/60 align-top dark:bg-blue-950/20">
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selected} disabled aria-label={`Select ${element.title}`} />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1">
                            <input type="time" aria-label="Start time" className="w-[5.6rem] rounded border border-bordercl bg-surface px-1.5 py-1 text-xs" value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })} />
                            <span className="text-foreground-muted">-</span>
                            <input type="time" aria-label="End time" className="w-[5.6rem] rounded border border-bordercl bg-surface px-1.5 py-1 text-xs" value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} />
                          </div>
                        </td>
                        <td className="space-y-1 px-2 py-2">
                          <input autoFocus aria-label="Public schedule item title" className="w-full rounded border border-bordercl bg-surface px-2 py-1 text-sm font-medium" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
                          <select aria-label="Schedule item type" className="w-full rounded border border-bordercl bg-surface px-2 py-1 text-xs" value={form.session_element_type_id} onChange={(event) => setForm({ ...form, session_element_type_id: event.target.value })}>
                            {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <select aria-label="Schedule item location" className="w-full rounded border border-bordercl bg-surface px-2 py-1 text-xs" value={form.location_id} onChange={(event) => setForm({ ...form, location_id: event.target.value })}>
                            <option value="">No location</option>
                            {locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2 text-xs text-foreground-secondary">
                          {form.schedule_view_ids.length > 0 ? `${form.schedule_view_ids.length} selected` : "Not assigned to a public view"}
                        </td>
                        <td className="px-2 py-2 text-xs text-foreground-secondary">
                          {form.attendee_team_ids.length > 0 ? `${form.attendee_team_ids.length} selected` : "All audiences"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Tooltip content="Save (Ctrl+Enter)" side="bottom">
                              <button onClick={() => void saveElement(false)} disabled={saving || !form.title.trim()} className="flex h-7 w-7 items-center justify-center rounded text-green-700 hover:bg-green-50 disabled:opacity-40" aria-label={`Save ${element.title}`}>
                                <Save className="h-3.5 w-3.5" />
                              </button>
                            </Tooltip>
                            <Tooltip content="Cancel" side="bottom">
                              <button onClick={closeEditor} className="flex h-7 w-7 items-center justify-center rounded text-foreground-muted hover:bg-surface-hover" aria-label="Cancel editing">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr
                      key={element.id}
                      className={editingElement?.id === element.id ? "bg-surface-hover" : "hover:bg-surface-subtle"}
                    >
                      <td className="px-3 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={selected}
                          aria-label={`Select ${element.title}`}
                          onChange={(event) =>
                            setSelectedIds((ids) =>
                              event.target.checked
                                ? [...ids, element.id]
                                : ids.filter((id) => id !== element.id),
                            )
                          }
                        />
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 align-top font-mono text-xs text-foreground-secondary">
                        {element.start_time}-{element.end_time}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <button
                          className="flex min-w-0 items-start gap-2 text-left"
                          onClick={() => openEdit(element)}
                        >
                          <span
                            className="mt-1 h-3 w-1 shrink-0 rounded-full"
                            style={{ backgroundColor: getSessionElementColour(sessionType?.colour) }}
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">
                              {element.title}
                            </span>
                            <span className="block truncate text-xs text-foreground-muted">
                              {sessionType?.name || "General"}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="px-2 py-2 align-top text-xs text-foreground-secondary">
                        {location || "-"}
                      </td>
                      <td className={`px-2 py-2 align-top text-xs ${assignedViews ? "text-foreground-secondary" : "text-foreground-muted"}`}>
                        {assignedViews || "Not assigned to a public view"}
                      </td>
                      <td className="px-2 py-2 align-top text-xs text-foreground-secondary">
                        {audience || "All audiences"}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex justify-end gap-1">
                          <Tooltip content="Edit" side="bottom">
                            <button
                              onClick={() => openEdit(element)}
                              className="flex h-7 w-7 items-center justify-center rounded text-foreground-muted hover:bg-surface-hover hover:text-foreground"
                              aria-label={`Edit ${element.title}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                          <Tooltip content="Duplicate" side="bottom">
                            <button
                              onClick={() => void duplicateElement(element)}
                              className="flex h-7 w-7 items-center justify-center rounded text-foreground-muted hover:bg-surface-hover hover:text-foreground"
                              aria-label={`Duplicate ${element.title}`}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                          <Tooltip content="Add after" side="bottom">
                            <button
                              onClick={() => openCreate(element)}
                              className="flex h-7 w-7 items-center justify-center rounded text-foreground-muted hover:bg-surface-hover hover:text-foreground"
                              aria-label={`Add schedule item after ${element.title}`}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                          <Tooltip content="Delete" side="bottom">
                            <button
                              onClick={() => void deleteElement(element)}
                              className="flex h-7 w-7 items-center justify-center rounded text-foreground-muted hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                              aria-label={`Delete ${element.title}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {modalOpen && !editingElement && (
                  <tr className="bg-blue-50/60 align-top dark:bg-blue-950/20">
                    <td className="px-3 py-2"><span className="sr-only">New schedule item</span></td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        <input type="time" aria-label="Start time" className="w-[5.6rem] rounded border border-bordercl bg-surface px-1.5 py-1 text-xs" value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })} />
                        <span className="text-foreground-muted">-</span>
                        <input type="time" aria-label="End time" className="w-[5.6rem] rounded border border-bordercl bg-surface px-1.5 py-1 text-xs" value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })} />
                      </div>
                    </td>
                    <td className="space-y-1 px-2 py-2">
                      <input autoFocus aria-label="Public schedule item title" className="w-full rounded border border-bordercl bg-surface px-2 py-1 text-sm font-medium" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Public schedule item title" />
                      <select aria-label="Schedule item type" className="w-full rounded border border-bordercl bg-surface px-2 py-1 text-xs" value={form.session_element_type_id} onChange={(event) => setForm({ ...form, session_element_type_id: event.target.value })}>
                        {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <select aria-label="Schedule item location" className="w-full rounded border border-bordercl bg-surface px-2 py-1 text-xs" value={form.location_id} onChange={(event) => setForm({ ...form, location_id: event.target.value })}>
                        <option value="">No location</option>
                        {locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2 text-xs text-foreground-secondary">{form.schedule_view_ids.length > 0 ? `${form.schedule_view_ids.length} selected` : "Not assigned to a public view"}</td>
                    <td className="px-2 py-2 text-xs text-foreground-secondary">{form.attendee_team_ids.length > 0 ? `${form.attendee_team_ids.length} selected` : "All audiences"}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Tooltip content="Save (Ctrl+Enter)" side="bottom">
                          <button onClick={() => void saveElement(false)} disabled={saving || !form.title.trim()} className="flex h-7 w-7 items-center justify-center rounded text-green-700 hover:bg-green-50 disabled:opacity-40" aria-label="Save new schedule item"><Save className="h-3.5 w-3.5" /></button>
                        </Tooltip>
                        <button onClick={closeEditor} className="flex h-7 w-7 items-center justify-center rounded text-foreground-muted hover:bg-surface-hover" aria-label="Cancel new schedule item"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {filteredElements.length === 0 && !modalOpen && (
              <div className="border-t border-dashed border-bordercl px-6 py-10 text-center">
                <p className="text-sm text-foreground-muted">
                  {dayElements.length > 0 ? "No schedule items match these filters." : "No schedule items for this day."}
                </p>
                <Button className="mt-3" variant="outline" size="sm" onClick={() => openCreate()}>
                  <Plus className="h-3.5 w-3.5" /> Add first item
                </Button>
              </div>
            )}
          </div>

          {modalOpen && (
            <aside className="border-t border-bordercl bg-surface-subtle p-4 lg:border-l lg:border-t-0">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-foreground">
                    {editingElement ? "Schedule item details" : "New schedule item details"}
                  </h4>
                  {editorDirty && <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">Unsaved changes</p>}
                </div>
                <Tooltip content="Close editor" side="bottom">
                  <button
                    onClick={closeEditor}
                    className="flex h-7 w-7 items-center justify-center rounded text-foreground-muted hover:bg-surface-hover"
                    aria-label="Close schedule item editor"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </Tooltip>
              </div>
              {editorError && (
                <div className="mb-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                  {editorError}
                </div>
              )}
              <div className="space-y-3">
                <p className="text-xs text-foreground-muted">
                  Edit the public title, time, type and location directly in the highlighted agenda row.
                </p>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-foreground-muted">Working day</span>
                  <select className="w-full rounded-md border border-bordercl bg-surface px-2.5 py-2 text-sm" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })}>
                    {dates.map((date) => <option key={date} value={date}>{formatDateWithWeekday(date)}</option>)}
                  </select>
                </label>
                <fieldset className="space-y-1">
                  <legend className="text-xs font-medium text-foreground-muted">Public views</legend>
                  <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-bordercl bg-surface p-2">
                    {scheduleViews.length === 0 ? (
                      <button type="button" className="text-left text-xs text-blue-600 hover:underline" onClick={openScheduleSettings}>Configure public views</button>
                    ) : scheduleViews.map((view) => (
                      <label key={view.id} className="flex items-center gap-2 text-sm text-foreground-secondary">
                        <input
                          type="checkbox"
                          checked={form.schedule_view_ids.includes(view.id)}
                          onChange={(event) => setForm((current) => ({
                            ...current,
                            schedule_view_ids: event.target.checked
                              ? [...current.schedule_view_ids, view.id]
                              : current.schedule_view_ids.filter((id) => id !== view.id),
                          }))}
                        />
                        {view.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="space-y-1">
                  <legend className="text-xs font-medium text-foreground-muted">Audience teams</legend>
                  <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-bordercl bg-surface p-2">
                    {teams.length === 0 ? (
                      <span className="flex items-center justify-between gap-2 text-xs text-foreground-muted">
                        Visible to all audiences.
                        {onManageAudienceTeams && <button type="button" className="text-blue-600 hover:underline" onClick={openAudienceManagement}>Manage</button>}
                      </span>
                    ) : teams.map((team) => (
                      <label key={team.id} className="flex items-center gap-2 text-sm text-foreground-secondary">
                        <input
                          type="checkbox"
                          checked={form.attendee_team_ids.includes(team.id)}
                          onChange={(event) => setForm((current) => ({
                            ...current,
                            attendee_team_ids: event.target.checked
                              ? [...current.attendee_team_ids, team.id]
                              : current.attendee_team_ids.filter((id) => id !== team.id),
                          }))}
                        />
                        {teamLabel(team)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-foreground-muted">Responsible person</span>
                  <select className="w-full rounded-md border border-bordercl bg-surface px-2.5 py-2 text-sm" value={form.responsible_person_id} onChange={(event) => setForm({ ...form, responsible_person_id: event.target.value })}>
                    <option value="">No person selected</option>
                    {persons.map((person) => <option key={person.id} value={person.id}>{personLabel(person)}</option>)}
                  </select>
                </label>
                <PermittedDataInputNotice eventId={selectedEvent?.id} />
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-foreground-muted">Public responsible role or contact label</span>
                  <input className="w-full rounded-md border border-bordercl bg-surface px-2.5 py-2 text-sm" value={form.responsible_text} onChange={(event) => setForm({ ...form, responsible_text: event.target.value })} />
                  <span className="text-xs text-foreground-muted">Published to the public schedule. Use a role or team name, not private contact details.</span>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-foreground-muted">Public schedule description</span>
                  <textarea className="min-h-20 w-full rounded-md border border-bordercl bg-surface px-2.5 py-2 text-sm" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
                  <span className="text-xs text-foreground-muted">Published verbatim to selected public programme views.</span>
                </label>
              </div>
              <div className="mt-4 flex justify-end gap-2 border-t border-bordercl pt-3">
                <Button variant="ghost" size="sm" onClick={closeEditor}>Cancel</Button>
                {!editingElement && (
                  <Button variant="outline" size="sm" onClick={() => void saveElement(true)} disabled={saving || !form.title.trim() || !form.start_time || !form.end_time}>
                    Save and add another
                  </Button>
                )}
                <Button size="sm" onClick={() => void saveElement(false)} disabled={saving || !form.title.trim() || !form.start_time || !form.end_time}>
                  <Save className="h-3.5 w-3.5" /> {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </aside>
          )}
        </div>
      </section>

      <Modal open={publishPreviewScope !== null} onClose={() => setPublishPreviewScope(null)} maxWidth="lg">
        <div className="space-y-4 p-6">
          <div>
            <h4 className="text-lg font-semibold text-foreground">Publish General Schedule</h4>
            <p className="mt-1 text-sm text-foreground-muted">
              {publishPreviewScope === "selected"
                ? `Publish ${selectedDayLabel}.`
                : `Publish all ${dates.length} working days.`}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="border-l-2 border-green-500 pl-3">
              <div className="text-lg font-semibold text-foreground">
                {publishPreviewScope === "selected" ? selectedPublicCount : publicCount}
              </div>
              <div className="text-xs text-foreground-muted">Public items included</div>
            </div>
            <div className="border-l-2 border-bordercl-strong pl-3">
              <div className="text-lg font-semibold text-foreground">
                {publishPreviewScope === "selected" ? selectedExcludedCount : excludedCount}
              </div>
              <div className="text-xs text-foreground-muted">Items without a public view excluded</div>
            </div>
          </div>
          {(publishPreviewScope === "selected" ? selectedPublicCount : publicCount) === 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              This publish contains no public items. Continuing will clear the published programme for {publishPreviewScope === "selected" ? "this working day" : "all days"}.
            </div>
          )}
          {publishStatus.label === "Previous publish failed" && publishPreviewScope === "selected" && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              Previous publish failed: {publishStatus.description}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPublishPreviewScope(null)}>Cancel</Button>
            <Button onClick={() => publishPreviewScope && void publish(publishPreviewScope)} disabled={publishing || !mpBackendSettings?.configured}>
              <Send className="h-4 w-4" /> {publishing ? "Publishing..." : publishPreviewScope === "selected" ? "Publish selected day" : "Publish all days"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={bulkEditorOpen} onClose={() => setBulkEditorOpen(false)} maxWidth="lg">
        <div className="space-y-4 p-6">
          <div>
            <h4 className="text-lg font-semibold text-foreground">Edit selected schedule items</h4>
            <p className="mt-1 text-sm text-foreground-muted">
              Only enabled fields will change for the {selectedIds.length} selected item(s).
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 rounded-md border border-bordercl p-3">
              <span className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={bulkTypeEnabled} onChange={(event) => setBulkTypeEnabled(event.target.checked)} /> Change type</span>
              <select aria-label="New schedule item type" className="w-full rounded border border-bordercl bg-surface px-2 py-1.5 text-sm disabled:opacity-50" disabled={!bulkTypeEnabled} value={bulkTypeId} onChange={(event) => setBulkTypeId(event.target.value)}>
                <option value="">Choose a type</option>
                {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 rounded-md border border-bordercl p-3">
              <span className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={bulkLocationEnabled} onChange={(event) => setBulkLocationEnabled(event.target.checked)} /> Change location</span>
              <select aria-label="New schedule item location" className="w-full rounded border border-bordercl bg-surface px-2 py-1.5 text-sm disabled:opacity-50" disabled={!bulkLocationEnabled} value={bulkLocationId} onChange={(event) => setBulkLocationId(event.target.value)}>
                <option value="">No location</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 rounded-md border border-bordercl p-3">
              <span className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={bulkDateEnabled} onChange={(event) => setBulkDateEnabled(event.target.checked)} /> Move to working day</span>
              <select aria-label="New working day" className="w-full rounded border border-bordercl bg-surface px-2 py-1.5 text-sm disabled:opacity-50" disabled={!bulkDateEnabled} value={bulkWorkingDate} onChange={(event) => setBulkWorkingDate(event.target.value)}>
                {dates.map((date) => <option key={date} value={date}>{formatDateWithWeekday(date)}</option>)}
              </select>
            </label>
            <label className="space-y-1 rounded-md border border-bordercl p-3">
              <span className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={bulkShiftEnabled} onChange={(event) => setBulkShiftEnabled(event.target.checked)} /> Shift times</span>
              <div className="flex items-center gap-2"><input aria-label="Time shift in minutes" type="number" step="5" className="w-28 rounded border border-bordercl bg-surface px-2 py-1.5 text-sm disabled:opacity-50" disabled={!bulkShiftEnabled} value={bulkShiftMinutes} onChange={(event) => setBulkShiftMinutes(Number(event.target.value) || 0)} /><span className="text-xs text-foreground-muted">minutes</span></div>
            </label>
          </div>
          <fieldset className="space-y-2 rounded-md border border-bordercl p-3">
            <legend className="px-1 text-sm font-medium"><label className="flex items-center gap-2"><input type="checkbox" checked={bulkViewEnabled} onChange={(event) => setBulkViewEnabled(event.target.checked)} /> Change public views</label></legend>
            <select aria-label="Public view change operation" className="rounded border border-bordercl bg-surface px-2 py-1 text-xs disabled:opacity-50" disabled={!bulkViewEnabled} value={bulkViewOperation} onChange={(event) => setBulkViewOperation(event.target.value as BulkScheduleAssignmentChange["operation"])}>
              <option value="add">Add selected views</option><option value="remove">Remove selected views</option><option value="replace">Replace all views</option>
            </select>
            <div className="grid gap-2 sm:grid-cols-2">
              {scheduleViews.map((view) => (
                <label key={view.id} className="flex items-center gap-2 text-sm text-foreground-secondary">
                  <input
                    type="checkbox"
                    disabled={!bulkViewEnabled}
                    checked={bulkViewIds.includes(view.id)}
                    onChange={(event) => setBulkViewIds((current) => event.target.checked ? [...current, view.id] : current.filter((id) => id !== view.id))}
                  />
                  {view.name}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2 rounded-md border border-bordercl p-3">
            <legend className="px-1 text-sm font-medium"><label className="flex items-center gap-2"><input type="checkbox" checked={bulkTeamEnabled} onChange={(event) => setBulkTeamEnabled(event.target.checked)} /> Change audiences</label></legend>
            <select aria-label="Audience change operation" className="rounded border border-bordercl bg-surface px-2 py-1 text-xs disabled:opacity-50" disabled={!bulkTeamEnabled} value={bulkTeamOperation} onChange={(event) => setBulkTeamOperation(event.target.value as BulkScheduleAssignmentChange["operation"])}>
              <option value="add">Add selected audiences</option><option value="remove">Remove selected audiences</option><option value="replace">Replace all audiences</option>
            </select>
            <div className="grid gap-2 sm:grid-cols-2">
              {teams.map((team) => (
                <label key={team.id} className="flex items-center gap-2 text-sm text-foreground-secondary">
                  <input
                    type="checkbox"
                    disabled={!bulkTeamEnabled}
                    checked={bulkTeamIds.includes(team.id)}
                    onChange={(event) => setBulkTeamIds((current) => event.target.checked ? [...current, team.id] : current.filter((id) => id !== team.id))}
                  />
                  {teamLabel(team)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setBulkEditorOpen(false)}>Cancel</Button>
            <Button onClick={applyBulkChanges} disabled={saving}>
              <Check className="h-4 w-4" /> Apply changes
            </Button>
          </div>
        </div>
      </Modal>
      <Modal open={duplicateDayOpen} onClose={() => setDuplicateDayOpen(false)} maxWidth="lg">
        <div className="space-y-4 p-6">
          <div>
            <h4 className="text-lg font-semibold text-foreground">Duplicate {selectedDayLabel}</h4>
            <p className="mt-1 text-sm text-foreground-muted">
              Copy all {dayElements.length} schedule item(s). Existing target-day items will remain.
            </p>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-bordercl p-3">
            {dates.filter((date) => date !== selectedDate).map((date) => (
              <label key={date} className="flex items-center gap-2 text-sm text-foreground-secondary">
                <input type="checkbox" checked={copyTargetDates.includes(date)} onChange={() => toggleCopyTargetDate(date)} />
                {formatDateWithWeekday(date)}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDuplicateDayOpen(false)}>Cancel</Button>
            <Button onClick={() => void duplicateSelectedDay()} disabled={saving || copyTargetDates.length === 0}>
              <Copy className="h-4 w-4" /> {saving ? "Copying..." : `Copy ${dayElements.length * copyTargetDates.length} item(s)`}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} maxWidth="2xl">
        <div className="space-y-4 p-6">
          <div>
            <h4 className="text-lg font-semibold text-foreground">Paste schedule items from a spreadsheet</h4>
            <p className="mt-1 text-sm text-foreground-muted">
              Paste tab-separated rows below. Use semicolons between multiple public views or audiences. Blank views remain unpublished and blank audiences mean all audiences.
            </p>
          </div>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(GENERAL_SCHEDULE_IMPORT_HEADER)}>
              <Copy className="h-3.5 w-3.5" /> Copy column headers
            </Button>
          </div>
          <PermittedDataInputNotice eventId={selectedEvent?.id} />
          <p className="text-xs text-foreground-muted">Imported descriptions and responsible labels may be published to selected public programme views.</p>
          <textarea
            className="min-h-44 w-full rounded-md border border-bordercl bg-surface px-3 py-2 font-mono text-xs"
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            aria-label="Spreadsheet schedule data"
            spellCheck={false}
          />
          {importPreview.headerErrors.length > 0 && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
              {importPreview.headerErrors.map((error) => <div key={error}>{error}</div>)}
            </div>
          )}
          {importPreview.rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{importableRows.length} ready, {importPreview.rows.filter((row) => row.errors.length > 0).length} invalid, {importPreview.rows.filter((row) => row.duplicate).length} duplicate</span>
                {importPreview.rows.some((row) => row.duplicate) && (
                  <label className="flex items-center gap-2 text-foreground-secondary"><input type="checkbox" checked={includeImportDuplicates} onChange={(event) => setIncludeImportDuplicates(event.target.checked)} /> Include exact duplicates</label>
                )}
              </div>
              <div className="max-h-64 overflow-auto rounded-md border border-bordercl">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-surface-subtle text-foreground-muted"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Title</th><th className="px-3 py-2">Time</th><th className="px-3 py-2">Status</th></tr></thead>
                  <tbody className="divide-y divide-bordercl">
                    {importPreview.rows.map((row) => (
                      <tr key={row.line}>
                        <td className="px-3 py-2">{row.line}</td>
                        <td className="px-3 py-2">{row.payload?.title || row.values[3] || "-"}</td>
                        <td className="px-3 py-2 font-mono">{row.payload ? `${row.payload.start_time}-${row.payload.end_time}` : "-"}</td>
                        <td className={`px-3 py-2 ${row.errors.length > 0 ? "text-red-700" : row.duplicate ? "text-amber-700" : "text-green-700"}`}>
                          {row.errors.length > 0 ? row.errors.join(" ") : row.duplicate ? "Exact duplicate" : "Ready"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button onClick={() => void importSpreadsheet()} disabled={saving || importableRows.length === 0 || importPreview.rows.some((row) => row.errors.length > 0)}>
              <Upload className="h-4 w-4" /> {saving ? "Importing..." : `Import ${importableRows.length} item(s)`}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={copyModalOpen} onClose={() => setCopyModalOpen(false)} maxWidth="2xl">
        <div className="space-y-4 p-6">
          <div>
            <h4 className="text-lg font-semibold text-foreground">Copy General Schedule</h4>
            <p className="text-sm text-foreground-muted">
              Choose which visible programme items are included. Formatting comes from each schedule item type.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-foreground-muted">Scope</span>
              <select
                className="w-full rounded-md border border-bordercl bg-surface px-3 py-2 text-sm"
                value={copyScope}
                onChange={(event) => setCopyScope(event.target.value as "current" | "all")}
              >
                <option value="current">Current filtered view</option>
                <option value="all">All schedule items</option>
              </select>
            </label>
            <div className="space-y-1">
              <span className="text-xs font-medium text-foreground-muted">Types</span>
              <div className="flex flex-wrap gap-2 rounded-md border border-bordercl bg-surface p-2">
                {types.map((type) => {
                  const checked = copyTypeIds.includes(type.id);
                  return (
                    <label key={type.id} className="inline-flex items-center gap-2 rounded-full bg-surface-subtle px-3 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setCopyTypeIds((ids) =>
                            event.target.checked
                              ? [...ids, type.id]
                              : ids.filter((id) => id !== type.id),
                          )
                        }
                      />
                      {type.name}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-bordercl bg-surface-subtle p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground-muted">
              Preview - {copyElements.length} item(s)
            </div>
            <div
              className="space-y-2 text-sm leading-relaxed text-foreground-secondary [&_a]:text-blue-600 [&_a]:underline"
              dangerouslySetInnerHTML={{
                __html: renderSessionElementsTemplateHtml(
                  copyElements,
                  teams,
                  locations,
                  persons,
                  types,
                ),
              }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCopyModalOpen(false)}>Cancel</Button>
            <Button onClick={copyExport} disabled={copyElements.length === 0}>
              <Copy className="h-4 w-4" /> Copy
            </Button>
          </div>
        </div>
      </Modal>
      <Modal open={Boolean(copyFallbackText)} onClose={() => { setCopyFallbackText(""); setCopyFallbackHtml(""); }} maxWidth="2xl">
        <div className="space-y-4 p-6">
          <div>
            <h4 className="text-lg font-semibold text-foreground">Copy General Schedule</h4>
            <p className="text-sm text-foreground-muted">
              Clipboard access was blocked. Select the text below and copy it manually.
            </p>
          </div>
          {copyFallbackHtml && (
            <div
              className="rounded-lg border border-bordercl bg-surface-subtle p-3 text-sm leading-relaxed text-foreground-secondary [&_a]:text-blue-600 [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: sanitizeGeneralScheduleHtml(copyFallbackHtml) }}
            />
          )}
          <textarea
            className="min-h-64 w-full rounded-md border border-bordercl bg-surface px-3 py-2 font-mono text-xs"
            readOnly
            value={copyFallbackText}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="flex justify-end">
            <Button onClick={() => { setCopyFallbackText(""); setCopyFallbackHtml(""); }}>Done</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
