"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button, Tooltip } from "@/components/ui";
import {
  taskTypesApi,
  TaskType,
  exportFormatsApi,
  CalendarExportFormat,
  TemplateVariable,
  googleCalendarApi,
} from "@/lib/api";
import { sanitiseRichTemplateHtml } from "@/lib/richTemplate";
import {
  Save,
  Clock,
  MapPin,
  Users,
  Eye,
  Bold,
  Italic,
  Underline,
  Link2,
  X,
} from "lucide-react";
import { GCalColor, sortedGcalColors, gcalColorLabel } from "@/lib/gcalColors";
import { useShortcuts } from "@/contexts/ShortcutContext";

// ── Link modal for inserting hyperlinks ───────────────────────────────
function LinkModal({
  open,
  onClose,
  onInsert,
  variables,
  primaryColor,
  initialText,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (url: string, text: string) => void;
  variables: TemplateVariable[];
  primaryColor: string;
  initialText: string;
}) {
  const [url, setUrl] = useState("");
  const [displayText, setDisplayText] = useState(initialText);
  const [showUrlVars, setShowUrlVars] = useState(false);
  const [urlFilter, setUrlFilter] = useState("");
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayText(initialText);
    setUrl("");
    setShowUrlVars(false);
    if (open) setTimeout(() => urlInputRef.current?.focus(), 50);
  }, [open, initialText]);

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setUrl(v);
    const braceIdx = v.lastIndexOf("{");
    const closeBrace = v.lastIndexOf("}");
    if (braceIdx !== -1 && braceIdx > closeBrace) {
      setUrlFilter(v.slice(braceIdx + 1));
      setShowUrlVars(true);
    } else {
      setShowUrlVars(false);
    }
  };

  const insertUrlVar = (varName: string) => {
    const braceIdx = url.lastIndexOf("{");
    const newUrl = url.slice(0, braceIdx) + `{${varName}}`;
    setUrl(newUrl);
    setShowUrlVars(false);
    urlInputRef.current?.focus();
  };

  const filteredVars = variables.filter(
    (v) =>
      urlFilter === "" ||
      v.name.toLowerCase().includes(urlFilter.toLowerCase()) ||
      v.label.toLowerCase().includes(urlFilter.toLowerCase()),
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div
        className="bg-surface rounded-lg shadow-xl w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">Insert Link</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-surface-hover text-foreground-faint hover:text-foreground-muted"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1">
            Display Text
          </label>
          <input
            type="text"
            value={displayText}
            onChange={(e) => setDisplayText(e.target.value)}
            className="w-full border border-bordercl-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Link text"
          />
        </div>

        <div className="relative">
          <label className="block text-sm font-medium text-foreground-secondary mb-1">
            URL
          </label>
          <input
            ref={urlInputRef}
            type="text"
            value={url}
            onChange={handleUrlChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url && displayText) {
                e.preventDefault();
                onInsert(url, displayText);
              }
              if (e.key === "Escape") {
                if (showUrlVars) setShowUrlVars(false);
                else onClose();
              }
            }}
            className="w-full border border-bordercl-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="https://... or type { for variables"
          />
          <p className="text-xs text-foreground-faint mt-1">
            Type{" "}
            <kbd className="px-1 bg-surface-inset rounded text-foreground-muted">
              {"{"}
            </kbd>{" "}
            to insert a variable (e.g. {"{field.link_name}"})
          </p>

          {showUrlVars && filteredVars.length > 0 && (
            <div className="absolute z-50 bg-surface border border-bordercl rounded-lg shadow-lg max-h-40 overflow-y-auto min-w-[200px] mt-1">
              {filteredVars.map((v) => (
                <button
                  key={v.name}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertUrlVar(v.name);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:bg-blue-950/30 dark:hover:bg-blue-950/30 flex items-center justify-between gap-2 transition-colors"
                >
                  <span className="font-medium" style={{ color: primaryColor }}>
                    {`{${v.name}}`}
                  </span>
                  <span className="text-xs text-foreground-faint truncate">
                    {v.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!url || !displayText}
            onClick={() => onInsert(url, displayText)}
          >
            <Link2 className="w-4 h-4 mr-1.5" />
            Insert Link
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Variable-aware template editor (rich text) ───────────────────────
function TemplateEditor({
  value,
  onChange,
  variables,
  placeholder,
  multiline,
  plainText,
  primaryColor,
}: {
  value: string;
  onChange: (v: string) => void;
  variables: TemplateVariable[];
  placeholder?: string;
  multiline?: boolean;
  plainText?: boolean;
  primaryColor: string;
}) {
  const { matchesShortcut } = useShortcuts();
  const editableRef = useRef<HTMLDivElement>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [filterText, setFilterText] = useState("");
  const [cursorBraceStart, setCursorBraceStart] = useState<number | null>(null);
  const isComposing = useRef(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkSelectionText, setLinkSelectionText] = useState("");
  const savedRange = useRef<Range | null>(null);

  // Render the value with variable tokens colored (preserving HTML formatting tags)
  // Only replace {var} in text positions, not inside HTML tag attributes (e.g. href)
  const renderHtml = useCallback(
    (text: string) => {
      // Split by HTML tags to avoid replacing variables inside attributes
      const parts = text.split(/(<[^>]*>)/);
      return parts
        .map((part) => {
          // If this part is an HTML tag (starts with <), leave it untouched
          if (part.startsWith("<")) return part;
          // Otherwise it's text content - replace variables
          return part.replace(/\{([^}]*)\}/g, (match, inner) => {
            const isValid = variables.some((v) => v.name === inner);
            if (isValid) {
              return `<span class="variable-token" contenteditable="false" style="color:${primaryColor};font-weight:600;background:${primaryColor}15;border-radius:3px;padding:0 2px;">${match}</span>`;
            }
            return match;
          });
        })
        .join("");
    },
    [variables, primaryColor],
  );

  // Sync rendered HTML when value or renderHtml changes
  useEffect(() => {
    const el = editableRef.current;
    if (!el) return;
    const newHtml = renderHtml(value);
    if (el.innerHTML !== newHtml) {
      el.innerHTML = newHtml;
    }
  }, [value, renderHtml]);

  /** Extract template HTML from contentEditable DOM, preserving formatting tags */
  function getTemplateHtml(el: HTMLElement): string {
    let html = "";
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        html += node.textContent || "";
      } else if (node instanceof HTMLElement) {
        if (node.classList.contains("variable-token")) {
          // Convert colored span back to {varName}
          html += node.textContent || "";
        } else {
          const tag = node.tagName.toLowerCase();
          if (tag === "b" || tag === "strong") {
            html += `<b>${getTemplateHtml(node)}</b>`;
          } else if (tag === "i" || tag === "em") {
            html += `<i>${getTemplateHtml(node)}</i>`;
          } else if (tag === "u") {
            html += `<u>${getTemplateHtml(node)}</u>`;
          } else if (tag === "a") {
            const href = node.getAttribute("href") || "";
            html += `<a href="${href}">${getTemplateHtml(node)}</a>`;
          } else if (tag === "br") {
            html += "\n";
          } else if (tag === "div" || tag === "p") {
            // ContentEditable wraps lines in divs/p
            const content = getTemplateHtml(node);
            if (html.length > 0 && content) html += "\n";
            html += content;
          } else {
            // Recurse for any other elements (spans with inline styles, etc.)
            const style = node.getAttribute("style") || "";
            if (
              style.includes("font-weight") &&
              (style.includes("bold") || style.includes("700"))
            ) {
              html += `<b>${getTemplateHtml(node)}</b>`;
            } else if (
              style.includes("font-style") &&
              style.includes("italic")
            ) {
              html += `<i>${getTemplateHtml(node)}</i>`;
            } else if (
              style.includes("text-decoration") &&
              style.includes("underline")
            ) {
              html += `<u>${getTemplateHtml(node)}</u>`;
            } else {
              html += getTemplateHtml(node);
            }
          }
        }
      }
    });
    return html;
  }

  /** Get text-only content for caret positioning */
  function getPlainTextContent(el: HTMLElement): string {
    let text = "";
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || "";
      } else if (node instanceof HTMLElement) {
        if (node.classList.contains("variable-token")) {
          text += node.textContent || "";
        } else {
          text += getPlainTextContent(node);
        }
      }
    });
    return text;
  }

  function getCaretOffset(el: HTMLElement): number {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    const range = sel.getRangeAt(0);
    const preRange = document.createRange();
    preRange.selectNodeContents(el);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString().length;
  }

  function setCaretOffset(el: HTMLElement, offset: number) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let pos = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const len = node.length;
      if (pos + len >= offset) {
        const range = document.createRange();
        range.setStart(node, offset - pos);
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        return;
      }
      pos += len;
    }
  }

  const handleInput = () => {
    if (isComposing.current) return;
    const el = editableRef.current;
    if (!el) return;

    // In plainText mode, use only plain text (strip any formatting)
    const templateContent = plainText
      ? getPlainTextContent(el)
      : getTemplateHtml(el);
    const plainTextContent = getPlainTextContent(el);
    const caretPos = getCaretOffset(el);

    // Check if user just typed { or is inside a {
    const textBefore = plainTextContent.slice(0, caretPos);
    const braceIdx = textBefore.lastIndexOf("{");
    const closeBrace = textBefore.lastIndexOf("}");

    if (braceIdx !== -1 && braceIdx > closeBrace) {
      const partial = textBefore.slice(braceIdx + 1);
      setFilterText(partial);
      setCursorBraceStart(braceIdx);

      // Position dropdown near caret
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        setDropdownPos({
          top: rect.bottom - elRect.top + 4,
          left: rect.left - elRect.left,
        });
      }
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
      setCursorBraceStart(null);
    }

    // Re-render with colored tokens and restore caret
    const newHtml = renderHtml(templateContent);
    if (el.innerHTML !== newHtml) {
      el.innerHTML = newHtml;
      setCaretOffset(el, caretPos);
    }

    onChange(templateContent);
  };

  const insertVariable = (varName: string) => {
    const el = editableRef.current;
    if (!el || cursorBraceStart === null) return;

    const templateHtml = getTemplateHtml(el);
    const plainText = getPlainTextContent(el);
    const caretPos = getCaretOffset(el);

    // Find the { in the template HTML that corresponds to the plain text brace position
    // Simple approach: replace in plain text, then re-construct
    const before = plainText.slice(0, cursorBraceStart);
    const after = plainText.slice(caretPos);

    // We need to find and replace in templateHtml too
    // Find the { character at the right position in the HTML
    let htmlPos = 0;
    let textPos = 0;
    let braceHtmlIdx = -1;
    const tempEl = document.createElement("div");
    tempEl.innerHTML = el.innerHTML;

    // Simpler approach: extract plain text, rebuild
    const newPlain = before + `{${varName}}` + after;
    // Strip formatting from the variable insertion point region and just use plain text
    // This keeps it simple - variables inserted via autocomplete are plain
    onChange(newPlain);
    el.innerHTML = renderHtml(newPlain);
    setCaretOffset(el, before.length + varName.length + 2);

    setShowDropdown(false);
    setCursorBraceStart(null);
    el.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showDropdown && e.key === "Escape") {
      setShowDropdown(false);
      e.preventDefault();
      return;
    }
    if (!multiline && e.key === "Enter") {
      e.preventDefault();
      return;
    }

    if (!plainText) {
      if (matchesShortcut(e, "exportEditor.bold")) {
        e.preventDefault();
        document.execCommand("bold");
        // Extract updated template HTML after format change
        requestAnimationFrame(() => {
          const el = editableRef.current;
          if (el) onChange(getTemplateHtml(el));
        });
      } else if (matchesShortcut(e, "exportEditor.italic")) {
        e.preventDefault();
        document.execCommand("italic");
        requestAnimationFrame(() => {
          const el = editableRef.current;
          if (el) onChange(getTemplateHtml(el));
        });
      } else if (matchesShortcut(e, "exportEditor.underline")) {
        e.preventDefault();
        document.execCommand("underline");
        requestAnimationFrame(() => {
          const el = editableRef.current;
          if (el) onChange(getTemplateHtml(el));
        });
      } else if (matchesShortcut(e, "exportEditor.insertLink")) {
        e.preventDefault();
        // Save current selection for link insertion
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          savedRange.current = sel.getRangeAt(0).cloneRange();
          setLinkSelectionText(sel.toString());
        } else {
          savedRange.current = null;
          setLinkSelectionText("");
        }
        setLinkModalOpen(true);
      }
    }
  };

  const handleInsertLink = (url: string, text: string) => {
    setLinkModalOpen(false);
    const el = editableRef.current;
    if (!el) return;

    el.focus();

    // Restore saved selection
    const sel = window.getSelection();
    if (sel && savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }

    // Delete selected content and insert link HTML
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.textContent = text;
      anchor.style.color = primaryColor;
      anchor.style.textDecoration = "underline";
      anchor.contentEditable = "false";
      range.insertNode(anchor);
      // Move caret after the link
      range.setStartAfter(anchor);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    // Extract and update
    onChange(getTemplateHtml(el));
    savedRange.current = null;
  };

  /** Apply formatting via toolbar button */
  const applyFormat = (command: string) => {
    const el = editableRef.current;
    if (!el) return;
    el.focus();
    document.execCommand(command);
    requestAnimationFrame(() => {
      if (el) onChange(getTemplateHtml(el));
    });
  };

  const filteredVars = variables.filter(
    (v) =>
      filterText === "" ||
      v.name.toLowerCase().includes(filterText.toLowerCase()) ||
      v.label.toLowerCase().includes(filterText.toLowerCase()),
  );

  return (
    <div className="relative">
      {/* Formatting Toolbar (hidden in plainText mode) */}
      {!plainText && (
        <div className="flex items-center gap-0.5 mb-1 border border-bordercl rounded-t-lg bg-surface-alt px-1 py-0.5">
          <Tooltip content="Bold (Ctrl+B)" side="top">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                applyFormat("bold");
              }}
              className="p-1.5 rounded hover:bg-surface-inset dark:bg-surface-hover text-foreground-muted hover:text-foreground transition-colors"
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="Italic (Ctrl+I)" side="top">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                applyFormat("italic");
              }}
              className="p-1.5 rounded hover:bg-surface-inset dark:bg-surface-hover text-foreground-muted hover:text-foreground transition-colors"
            >
              <Italic className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="Underline (Ctrl+U)" side="top">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                applyFormat("underline");
              }}
              className="p-1.5 rounded hover:bg-surface-inset dark:bg-surface-hover text-foreground-muted hover:text-foreground transition-colors"
            >
              <Underline className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <div className="w-px h-4 bg-bordercl-strong mx-1" />
          <Tooltip content="Insert Link (Ctrl+K)" side="top">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                const sel = window.getSelection();
                if (sel && sel.rangeCount > 0) {
                  savedRange.current = sel.getRangeAt(0).cloneRange();
                  setLinkSelectionText(sel.toString());
                } else {
                  savedRange.current = null;
                  setLinkSelectionText("");
                }
                setLinkModalOpen(true);
              }}
              className="p-1.5 rounded hover:bg-surface-inset dark:bg-surface-hover text-foreground-muted hover:text-foreground transition-colors"
            >
              <Link2 className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      )}

      <div
        ref={editableRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => (isComposing.current = true)}
        onCompositionEnd={() => {
          isComposing.current = false;
          handleInput();
        }}
        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        data-placeholder={placeholder}
        className={`border border-bordercl-strong ${!plainText ? "border-t-0 rounded-b-lg" : "rounded-lg"} px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
          multiline ? "min-h-[80px]" : "min-h-[36px]"
        } empty:before:content-[attr(data-placeholder)] empty:before:text-foreground-faint whitespace-pre-wrap break-words`}
        style={{ overflowWrap: "break-word", wordBreak: "break-word" }}
      />

      {showDropdown && filteredVars.length > 0 && (
        <div
          className="absolute z-50 bg-surface border border-bordercl rounded-lg shadow-lg max-h-48 overflow-y-auto min-w-[200px]"
          style={{ top: dropdownPos.top + 36, left: dropdownPos.left }}
        >
          {filteredVars.map((v) => (
            <button
              key={v.name}
              onMouseDown={(e) => {
                e.preventDefault();
                insertVariable(v.name);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:bg-blue-950/30 dark:hover:bg-blue-950/30 flex items-center justify-between gap-2 transition-colors"
            >
              <span className="font-medium" style={{ color: primaryColor }}>
                {`{${v.name}}`}
              </span>
              <span className="text-xs text-foreground-faint truncate">
                {v.label}
              </span>
            </button>
          ))}
        </div>
      )}

      {!plainText && (
        <LinkModal
          open={linkModalOpen}
          onClose={() => setLinkModalOpen(false)}
          onInsert={handleInsertLink}
          variables={variables}
          primaryColor={primaryColor}
          initialText={linkSelectionText}
        />
      )}
    </div>
  );
}

// ── Mock Google Calendar event preview ────────────────────────────────
function CalendarEventPreview({
  title,
  description,
  colorId,
  taskTypeName,
  gcalColors,
}: {
  title: string;
  description: string;
  colorId: string | null;
  taskTypeName: string;
  gcalColors: GCalColor[];
}) {
  const color = gcalColors.find((c) => c.id === colorId) || gcalColors[0];
  const bg = color?.background || "#039BE5";

  // Replace variables with sample values for preview
  const sampleVars: Record<string, string> = {
    title: "Workshop Session A",
    task_type: taskTypeName,
    description: "A sample task description",
    location: "Main Conference Hall",
    location_address: "123 Event Street",
    start_time: "09:00",
    end_time: "10:30",
    date: "2026-04-01",
    persons: "Alice Smith, Bob Jones",
  };

  const interpolate = (template: string) =>
    template.replace(/\{([^}]+)\}/g, (_, key) => sampleVars[key] || `{${key}}`);

  const previewTitle = interpolate(title || "{title}");
  const previewDesc = sanitiseRichTemplateHtml(interpolate(description || ""));

  return (
    <div className="rounded-lg overflow-hidden border border-bordercl shadow-sm">
      {/* Color stripe */}
      <div className="h-2" style={{ background: bg }} />
      <div className="p-4 bg-surface space-y-3">
        {/* Title row */}
        <div className="flex items-start gap-3">
          <div
            className="w-3 h-3 rounded-full mt-1 flex-shrink-0"
            style={{ background: bg }}
          />
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-foreground text-base">
              {previewTitle || "Untitled Event"}
            </h4>
          </div>
        </div>

        {/* Time */}
        <div className="flex items-center gap-2 text-sm text-foreground-muted ml-6">
          <Clock className="w-3.5 h-3.5" />
          <span>Wednesday, April 1 · 09:00 - 10:30</span>
        </div>

        {/* Location */}
        <div className="flex items-center gap-2 text-sm text-foreground-muted ml-6">
          <MapPin className="w-3.5 h-3.5" />
          <span>Main Conference Hall</span>
        </div>

        {/* People */}
        <div className="flex items-center gap-2 text-sm text-foreground-muted ml-6">
          <Users className="w-3.5 h-3.5" />
          <span>Alice Smith, Bob Jones</span>
        </div>

        {/* Description */}
        {previewDesc && (
          <div className="ml-6 mt-2 pt-2 border-t border-bordercl-subtle">
            <div
              className="text-sm text-foreground-muted whitespace-pre-wrap [&_b]:font-bold [&_i]:italic [&_u]:underline [&_a]:text-blue-600 [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: previewDesc }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Export Format Section ────────────────────────────────────────
export function ExportFormatSection({ eventId }: { eventId?: number }) {
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [variables, setVariables] = useState<TemplateVariable[]>([]);
  const [formats, setFormats] = useState<Record<number, CalendarExportFormat>>(
    {},
  );
  const [gcalColors, setGcalColors] = useState<GCalColor[]>([]);

  const [titleTemplate, setTitleTemplate] = useState("{title}");
  const [descTemplate, setDescTemplate] = useState("");
  const [colorId, setColorId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [types, allFormats] = await Promise.all([
        taskTypesApi.getAll(),
        exportFormatsApi.getAll(),
      ]);
      setTaskTypes(types);
      const fmtMap: Record<number, CalendarExportFormat> = {};
      allFormats.forEach((f) => (fmtMap[f.task_type_id] = f));
      setFormats(fmtMap);

      // Fetch Google Calendar event colors
      let colors: GCalColor[] = [];
      try {
        colors = await googleCalendarApi.getEventColors();
        setGcalColors(colors);
      } catch {
        // Fallback if not connected
        console.warn("Could not fetch Google Calendar colors");
      }

      if (types.length > 0) selectType(types[0].id, fmtMap, types, colors);
    } catch (e) {
      console.error("Failed to load export format data:", e);
    } finally {
      setLoading(false);
    }
  };

  /** Find the Google Calendar color ID whose background is closest to a hex color. */
  const findClosestGcalColorId = (
    hex: string,
    colors?: GCalColor[],
  ): string | null => {
    const palette = colors || gcalColors;
    if (!hex || palette.length === 0) return null;
    const parse = (h: string) => {
      const v = h.replace("#", "");
      return [
        parseInt(v.slice(0, 2), 16),
        parseInt(v.slice(2, 4), 16),
        parseInt(v.slice(4, 6), 16),
      ];
    };
    const [r, g, b] = parse(hex);
    let best = palette[0];
    let bestDist = Infinity;
    for (const c of palette) {
      const [cr, cg, cb] = parse(c.background);
      const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    return best.id;
  };

  const selectType = async (
    typeId: number,
    fmtMap?: Record<number, CalendarExportFormat>,
    types?: TaskType[],
    colors?: GCalColor[],
  ) => {
    setSelectedTypeId(typeId);
    setMessage("");
    const map = fmtMap || formats;
    const existing = map[typeId];
    setTitleTemplate(existing?.title_template || "{title}");
    setDescTemplate(existing?.description_template || "");

    // Default color: use saved format color, or fall back to the task type's color
    if (existing?.color_id) {
      setColorId(existing.color_id);
    } else {
      const tt = (types || taskTypes).find((t) => t.id === typeId);
      setColorId(tt?.color ? findClosestGcalColorId(tt.color, colors) : null);
    }

    try {
      const vars = await exportFormatsApi.getVariables(typeId, eventId);
      setVariables(vars);
    } catch {
      setVariables([]);
    }
  };

  const handleSave = async () => {
    if (!selectedTypeId) return;
    setSaving(true);
    setMessage("");
    try {
      const result = await exportFormatsApi.upsert(selectedTypeId, {
        title_template: titleTemplate,
        description_template: descTemplate,
        color_id: colorId,
      });
      setFormats((prev) => ({ ...prev, [selectedTypeId]: result }));
      setMessage("Export format saved!");
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const selectedType = taskTypes.find((t) => t.id === selectedTypeId);
  const primaryColor = selectedType?.color || "#3B82F6";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-foreground-faint">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-1">
          Export Format
        </h3>
        <p className="text-sm text-foreground-muted">
          Configure how each task type appears when published to Google
          Calendar. Use{" "}
          <code className="text-xs bg-surface-inset px-1 rounded">{"{ }"}</code>{" "}
          to insert dynamic variables from the task data.
        </p>
      </div>

      {/* Task type pills */}
      <div className="flex flex-wrap gap-2">
        {taskTypes.map((tt) => {
          const isSelected = tt.id === selectedTypeId;
          const hasFormat = !!formats[tt.id];
          return (
            <button
              key={tt.id}
              onClick={() => selectType(tt.id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${
                isSelected
                  ? "ring-2 ring-offset-1 shadow-sm"
                  : "opacity-80 hover:opacity-100"
              }`}
              style={{
                background: isSelected ? tt.color || "#3B82F6" : "transparent",
                color: isSelected ? "#fff" : tt.color || "#3B82F6",
                borderColor: tt.color || "#3B82F6",
                ...(isSelected
                  ? { ["--tw-ring-color" as string]: tt.color || "#3B82F6" }
                  : {}),
              }}
            >
              {tt.name}
              {hasFormat && (
                <span className="ml-1.5 text-xs opacity-70">✓</span>
              )}
            </button>
          );
        })}
      </div>

      {selectedTypeId && (
        <div className="grid grid-cols-2 gap-6">
          {/* ── Left: Editor ── */}
          <div className="space-y-5">
            {/* Title template */}
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1.5">
                Title Template
              </label>
              <TemplateEditor
                value={titleTemplate}
                onChange={setTitleTemplate}
                variables={variables}
                placeholder="Type { to insert a variable..."
                plainText
                primaryColor={primaryColor}
              />
              <p className="text-xs text-foreground-faint mt-1">
                Type{" "}
                <kbd className="px-1 bg-surface-inset rounded text-foreground-muted">
                  {"{"}
                </kbd>{" "}
                to see available variables
              </p>
            </div>

            {/* Description template */}
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1.5">
                Description Template
              </label>
              <TemplateEditor
                value={descTemplate}
                onChange={setDescTemplate}
                variables={variables}
                placeholder="Type { to insert a variable..."
                multiline
                primaryColor={primaryColor}
              />
            </div>

            {/* Save button */}
            <div className="flex items-center gap-3">
              <Button variant="primary" onClick={handleSave} disabled={saving}>
                <Save className="w-4 h-4 mr-1.5" />
                {saving ? "Saving..." : "Save Format"}
              </Button>
              {message && (
                <span
                  className={`text-sm ${message.startsWith("Error") ? "text-red-600" : "text-green-600"}`}
                >
                  {message}
                </span>
              )}
            </div>
          </div>

          {/* ── Right: Preview ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Eye className="w-4 h-4 text-foreground-faint" />
              <label className="text-sm font-medium text-foreground-secondary">
                Preview
              </label>
            </div>
            <CalendarEventPreview
              title={titleTemplate}
              description={descTemplate}
              colorId={colorId}
              taskTypeName={selectedType?.name || "Task"}
              gcalColors={gcalColors}
            />
            <p className="text-xs text-foreground-faint mt-3">
              Time, people, and location are determined by the task data and
              shown here with sample values.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
