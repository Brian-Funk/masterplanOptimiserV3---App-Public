"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bold, Italic, Link2, Underline, X } from "lucide-react";
import { Button, Tooltip } from "@/components/ui";

export type RichTemplateVariable = {
  name: string;
  label: string;
};

function hasBoldStyle(el: HTMLElement): boolean {
  const weight = el.style.fontWeight;
  return weight === "bold" || Number(weight) >= 600;
}

function hasItalicStyle(el: HTMLElement): boolean {
  return el.style.fontStyle === "italic";
}

function hasUnderlineStyle(el: HTMLElement): boolean {
  return (
    el.style.textDecoration.includes("underline") ||
    el.style.textDecorationLine.includes("underline")
  );
}

function wrapInlineFormatting(el: HTMLElement, content: string): string {
  let result = content;
  if (hasUnderlineStyle(el)) result = `<u>${result}</u>`;
  if (hasItalicStyle(el)) result = `<i>${result}</i>`;
  if (hasBoldStyle(el)) result = `<b>${result}</b>`;
  return result;
}

function getTemplateHtml(el: HTMLElement): string {
  let html = "";
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      html += node.textContent || "";
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.classList.contains("variable-token")) {
      html += wrapInlineFormatting(node, node.textContent || "");
      return;
    }
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
      const content = getTemplateHtml(node);
      if (html.length > 0 && content) html += "\n";
      html += content;
    } else if (tag === "span") {
      html += wrapInlineFormatting(node, getTemplateHtml(node));
    } else {
      html += getTemplateHtml(node);
    }
  });
  return html;
}

function getPlainText(el: HTMLElement): string {
  let text = "";
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || "";
    } else if (node instanceof HTMLElement) {
      text += getPlainText(node);
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
    const nextPos = pos + node.length;
    if (nextPos >= offset) {
      const range = document.createRange();
      range.setStart(node, Math.max(0, offset - pos));
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return;
    }
    pos = nextPos;
  }
}

function findTextPosition(
  el: HTMLElement,
  offset: number,
): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const nextPos = pos + node.length;
    if (nextPos >= offset) {
      return { node, offset: Math.max(0, offset - pos) };
    }
    pos = nextPos;
  }
  return null;
}

function replacePlainTextRange(
  el: HTMLElement,
  startOffset: number,
  endOffset: number,
  replacement: string,
) {
  const start = findTextPosition(el, startOffset);
  const end = findTextPosition(el, endOffset);
  const textNode = document.createTextNode(replacement);

  if (!start || !end) {
    el.appendChild(textNode);
  } else {
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    range.deleteContents();
    range.insertNode(textNode);
  }
}

function LinkModal({
  open,
  onClose,
  onInsert,
  initialText,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (url: string, text: string) => void;
  initialText: string;
}) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState(initialText);

  useEffect(() => {
    if (!open) return;
    setUrl("");
    setText(initialText);
  }, [initialText, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">Insert link</h3>
          <button className="rounded p-1 hover:bg-surface-hover" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground-secondary">Display text</span>
            <input
              className="w-full rounded-lg border border-bordercl-strong px-3 py-2 text-sm"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground-secondary">URL</span>
            <input
              className="w-full rounded-lg border border-bordercl-strong px-3 py-2 text-sm"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://..."
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!url || !text} onClick={() => onInsert(url, text)}>
            <Link2 className="h-4 w-4" /> Insert link
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RichTemplateEditor({
  value,
  onChange,
  variables,
  primaryColor = "#2563eb",
  placeholder = "Type text or { to insert a variable",
}: {
  value: string;
  onChange: (value: string) => void;
  variables: RichTemplateVariable[];
  primaryColor?: string;
  placeholder?: string;
}) {
  const editableRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const lastEmittedValueRef = useRef<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [cursorBraceStart, setCursorBraceStart] = useState<number | null>(null);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkText, setLinkText] = useState("");

  const renderHtml = useCallback(
    (template: string) =>
      template.replace(/\{([^}]*)\}/g, (match, inner) => {
        if (!variables.some((variable) => variable.name === inner)) return match;
        return `<span class="variable-token" contenteditable="false" style="color:${primaryColor};font-weight:inherit;font-style:inherit;text-decoration:inherit;background:${primaryColor}18;border-radius:3px;padding:0 2px;">${match}</span>`;
      }),
    [primaryColor, variables],
  );

  useEffect(() => {
    const el = editableRef.current;
    if (!el) return;
    if (value === lastEmittedValueRef.current && document.activeElement === el) {
      return;
    }
    const html = renderHtml(value || "");
    if (el.innerHTML !== html) el.innerHTML = html;
  }, [renderHtml, value]);

  const handleInput = () => {
    const el = editableRef.current;
    if (!el) return;
    const html = getTemplateHtml(el);
    const plain = getPlainText(el);
    const caret = getCaretOffset(el);
    const textBefore = plain.slice(0, caret);
    const braceIdx = textBefore.lastIndexOf("{");
    const closeBraceIdx = textBefore.lastIndexOf("}");
    if (braceIdx !== -1 && braceIdx > closeBraceIdx) {
      setFilterText(textBefore.slice(braceIdx + 1));
      setCursorBraceStart(braceIdx);
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
      setCursorBraceStart(null);
    }
    lastEmittedValueRef.current = html;
    onChange(html);
  };

  const insertVariable = (name: string) => {
    const el = editableRef.current;
    if (!el || cursorBraceStart === null) return;
    const caret = getCaretOffset(el);
    replacePlainTextRange(el, cursorBraceStart, caret, `{${name}}`);
    const next = getTemplateHtml(el);
    lastEmittedValueRef.current = next;
    onChange(next);
    el.innerHTML = renderHtml(next);
    setCaretOffset(el, cursorBraceStart + name.length + 2);
    setShowDropdown(false);
    el.focus();
  };

  const applyFormat = (command: string) => {
    const el = editableRef.current;
    if (!el) return;
    el.focus();
    document.execCommand(command);
    requestAnimationFrame(() => {
      const next = getTemplateHtml(el);
      lastEmittedValueRef.current = next;
      onChange(next);
    });
  };

  const openLinkModal = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
      setLinkText(sel.toString());
    } else {
      savedRange.current = null;
      setLinkText("");
    }
    setLinkModalOpen(true);
  };

  const insertLink = (url: string, text: string) => {
    setLinkModalOpen(false);
    const el = editableRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel && savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.textContent = text;
      anchor.contentEditable = "false";
      anchor.style.color = primaryColor;
      anchor.style.textDecoration = "underline";
      range.insertNode(anchor);
      range.setStartAfter(anchor);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const next = getTemplateHtml(el);
    lastEmittedValueRef.current = next;
    onChange(next);
  };

  const filteredVariables = variables.filter(
    (variable) =>
      !filterText ||
      variable.name.toLowerCase().includes(filterText.toLowerCase()) ||
      variable.label.toLowerCase().includes(filterText.toLowerCase()),
  );

  return (
    <div className="relative">
      <div className="flex items-center gap-1 rounded-t-lg border border-bordercl bg-surface-alt px-1 py-1">
        <Tooltip content="Bold" side="top">
          <button type="button" className="rounded p-1.5 hover:bg-surface-hover" onMouseDown={(e) => { e.preventDefault(); applyFormat("bold"); }}>
            <Bold className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip content="Italic" side="top">
          <button type="button" className="rounded p-1.5 hover:bg-surface-hover" onMouseDown={(e) => { e.preventDefault(); applyFormat("italic"); }}>
            <Italic className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip content="Underline" side="top">
          <button type="button" className="rounded p-1.5 hover:bg-surface-hover" onMouseDown={(e) => { e.preventDefault(); applyFormat("underline"); }}>
            <Underline className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <div className="mx-1 h-4 w-px bg-bordercl" />
        <Tooltip content="Insert link" side="top">
          <button type="button" className="rounded p-1.5 hover:bg-surface-hover" onMouseDown={(e) => { e.preventDefault(); openLinkModal(); }}>
            <Link2 className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>
      <div
        ref={editableRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
        data-placeholder={placeholder}
        className="min-h-24 rounded-b-lg border border-t-0 border-bordercl bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 empty:before:content-[attr(data-placeholder)] empty:before:text-foreground-faint [&_.variable-token]:inline-block [&_a_.variable-token]:underline [&_b_.variable-token]:font-bold [&_em_.variable-token]:italic [&_i_.variable-token]:italic [&_strong_.variable-token]:font-bold [&_u_.variable-token]:underline"
      />
      {showDropdown && filteredVariables.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-48 min-w-[220px] overflow-y-auto rounded-lg border border-bordercl bg-surface shadow-lg">
          {filteredVariables.map((variable) => (
            <button
              key={variable.name}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                insertVariable(variable.name);
              }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-hover"
            >
              <span className="font-medium" style={{ color: primaryColor }}>{`{${variable.name}}`}</span>
              <span className="truncate text-xs text-foreground-muted">{variable.label}</span>
            </button>
          ))}
        </div>
      )}
      <p className="mt-1 text-xs text-foreground-muted">Type {"{"} to insert a variable.</p>
      <LinkModal open={linkModalOpen} onClose={() => setLinkModalOpen(false)} onInsert={insertLink} initialText={linkText} />
    </div>
  );
}
